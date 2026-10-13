use super::{AgentRow, chain};
use crate::{Postgres, error::Error, events, tenancy};
use kivo_agents::{Command, Issued, Registry, Repository};
use kivo_tenancy::{Actor, Permission};
use uuid::Uuid;

impl Repository for Postgres {
    async fn agents(&self, actor: Actor, org: Uuid) -> Result<Registry, kivo_agents::Error> {
        let mut tx = self.pool.begin().await.map_err(Error::from)?;
        tenancy::require(&mut tx, actor, org, Permission::Administer).await?;
        let rows: Vec<AgentRow> =
            sqlx::query_as("SELECT * FROM agents WHERE org_id=$1 ORDER BY created_at,id LIMIT 201")
                .bind(org)
                .fetch_all(&mut *tx)
                .await
                .map_err(Error::from)?;
        if rows.len() > 200 {
            return Err(kivo_agents::Error::Invalid(
                "The workspace agent limit is 200",
            ));
        }
        let mut agents = Vec::new();
        for row in rows {
            let mut agent = row.definition()?;
            agent.active = match chain(&mut tx, org, row.id).await {
                Ok(chain) => chain.iter().all(|a| !a.scope.project_ids.is_empty()),
                Err(Error::Unauthorized) => false,
                Err(e) => return Err(e.into()),
            };
            agents.push(agent);
        }
        tx.commit().await.map_err(Error::from)?;
        Ok(Registry { agents })
    }
    async fn manage_agent(
        &self,
        actor: Actor,
        org: Uuid,
        command: Command,
        key: Uuid,
    ) -> Result<Issued, kivo_agents::Error> {
        command.validate(chrono::Utc::now())?;
        let mut tx = self.pool.begin().await.map_err(Error::from)?;
        events::lock(&mut tx, org).await?;
        tenancy::require(&mut tx, actor, org, Permission::Administer).await?;
        let request = serde_json::json!({"capability":"agents", "command":command});
        if let Some(result) = events::replay(&mut tx, org, actor.user_id, key, &request).await? {
            let agent =
                serde_json::from_value(result).map_err(|_| Error::Invalid("Invalid receipt"))?;
            return Ok(Issued {
                agent,
                credential: None,
            });
        }
        let mut credential = None;
        let id = match command {
            Command::Register {
                id,
                name,
                purpose,
                scope,
                expires_at,
                parent_id,
            } => {
                let count: i64 = sqlx::query_scalar("SELECT count(*) FROM agents WHERE org_id=$1")
                    .bind(org)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(Error::from)?;
                if count >= 200 {
                    return Err(Error::Invalid("The workspace agent limit is 200").into());
                }
                for project in &scope.project_ids {
                    let exists: bool = sqlx::query_scalar(
                        "SELECT EXISTS(SELECT 1 FROM projects WHERE org_id=$1 AND id=$2)",
                    )
                    .bind(org)
                    .bind(project)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(Error::from)?;
                    if !exists {
                        return Err(Error::Forbidden.into());
                    }
                }
                if let Some(parent) = parent_id {
                    let ancestors = chain(&mut tx, org, parent).await?;
                    if ancestors.len() >= 4
                        || ancestors
                            .iter()
                            .any(|p| !scope.narrows(&p.scope) || expires_at > p.expires_at)
                    {
                        return Err(Error::Invalid(
                            "Child delegation must narrow every parent scope and expiry",
                        )
                        .into());
                    }
                }
                let principal = Uuid::new_v4();
                let secret = format!("kivo_agent_{}", events::secret());
                sqlx::query("INSERT INTO principals(id,kind,org_id) VALUES($1,'agent',$2)")
                    .bind(principal)
                    .bind(org)
                    .execute(&mut *tx)
                    .await
                    .map_err(Error::from)?;
                sqlx::query("INSERT INTO agents(id,org_id,principal_id,owner_id,parent_id,name,purpose,scope,expires_at,credential_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
                    .bind(id).bind(org).bind(principal).bind(actor.user_id).bind(parent_id).bind(name.trim()).bind(purpose.trim())
                    .bind(serde_json::to_value(&scope).map_err(|_| Error::Invalid("Invalid scope"))?).bind(expires_at).bind(events::hash(&secret)).execute(&mut *tx).await.map_err(Error::from)?;
                for project in scope.project_ids {
                    sqlx::query(
                        "INSERT INTO agent_projects(org_id,agent_id,project_id) VALUES($1,$2,$3)",
                    )
                    .bind(org)
                    .bind(id)
                    .bind(project)
                    .execute(&mut *tx)
                    .await
                    .map_err(Error::from)?;
                }
                credential = Some(secret);
                id
            }
            Command::Rotate { id, version } => {
                let secret = format!("kivo_agent_{}", events::secret());
                let n = sqlx::query("UPDATE agents SET credential_hash=$1,credential_epoch=credential_epoch+1,version=version+1 WHERE org_id=$2 AND id=$3 AND version=$4 AND revoked_at IS NULL AND expires_at>now()")
                    .bind(events::hash(&secret)).bind(org).bind(id).bind(version).execute(&mut *tx).await.map_err(Error::from)?.rows_affected();
                if n != 1 {
                    return Err(Error::Conflict.into());
                }
                credential = Some(secret);
                id
            }
            Command::Revoke { id, version } => {
                let n = sqlx::query("UPDATE agents SET revoked_at=now(),credential_epoch=credential_epoch+1,version=version+1 WHERE org_id=$1 AND id=$2 AND version=$3 AND revoked_at IS NULL")
                    .bind(org).bind(id).bind(version).execute(&mut *tx).await.map_err(Error::from)?.rows_affected();
                if n != 1 {
                    return Err(Error::Conflict.into());
                }
                id
            }
        };
        let agent = super::row(&mut tx, org, id).await?.definition()?;
        let value = serde_json::to_value(&agent).map_err(|_| Error::Invalid("Invalid agent"))?;
        sqlx::query(
            "INSERT INTO agent_definitions(org_id,agent_id,version,definition) VALUES($1,$2,$3,$4)",
        )
        .bind(org)
        .bind(id)
        .bind(agent.version)
        .bind(&value)
        .execute(&mut *tx)
        .await
        .map_err(Error::from)?;
        events::record(&mut tx, org, actor.user_id, id, "agent.manage").await?;
        events::receipt(&mut tx, org, actor.user_id, key, &request, &value).await?;
        tx.commit().await.map_err(Error::from)?;
        Ok(Issued { agent, credential })
    }
    async fn exchange_agent_credential(
        &self,
        credential: &str,
    ) -> Result<kivo_agents::Session, kivo_agents::Error> {
        super::sessions::exchange(self, credential)
            .await
            .map_err(Into::into)
    }
    async fn verify_agent_session(
        &self,
        token: &str,
    ) -> Result<kivo_agents::Verified, kivo_agents::Error> {
        super::sessions::verify(self, token)
            .await
            .map_err(Into::into)
    }
}
