mod registry;
mod sessions;
use crate::{error::Error, tenancy};
use chrono::{DateTime, Utc};
use kivo_agents::Agent;
use kivo_tenancy::{AgentCapability, AgentMode, AgentScope, Permission, Principal};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
pub(super) struct AgentRow {
    pub id: Uuid,
    pub principal_id: Uuid,
    pub org_id: Uuid,
    pub owner_id: Uuid,
    pub name: String,
    pub purpose: String,
    pub parent_id: Option<Uuid>,
    pub scope: serde_json::Value,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub credential_epoch: i32,
}
impl AgentRow {
    pub(super) fn definition(&self) -> Result<Agent, Error> {
        Ok(Agent {
            id: self.id,
            principal_id: self.principal_id,
            org_id: self.org_id,
            owner_id: self.owner_id,
            name: self.name.clone(),
            purpose: self.purpose.clone(),
            parent_id: self.parent_id,
            scope: serde_json::from_value(self.scope.clone())
                .map_err(|_| Error::Invalid("Invalid stored agent scope"))?,
            expires_at: self.expires_at,
            revoked: self.revoked_at.is_some(),
            active: self.revoked_at.is_none() && self.expires_at > Utc::now(),
            version: self.version,
        })
    }
}
pub(super) async fn row(
    tx: &mut Transaction<'_, Postgres>,
    org: Uuid,
    id: Uuid,
) -> Result<AgentRow, Error> {
    sqlx::query_as("SELECT * FROM agents WHERE org_id=$1 AND id=$2 FOR SHARE")
        .bind(org)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(Error::Unauthorized)
}
pub(super) async fn chain(
    tx: &mut Transaction<'_, Postgres>,
    org: Uuid,
    id: Uuid,
) -> Result<Vec<Agent>, Error> {
    let mut current = Some(id);
    let mut result = Vec::new();
    while let Some(id) = current {
        if result.len() == 4 {
            return Err(Error::Unauthorized);
        }
        let r = row(tx, org, id).await?;
        if r.revoked_at.is_some() || r.expires_at <= Utc::now() {
            return Err(Error::Unauthorized);
        }
        tenancy::require(
            tx,
            kivo_tenancy::Actor {
                user_id: r.owner_id,
            },
            org,
            Permission::Administer,
        )
        .await
        .map_err(|e| match e {
            Error::Forbidden => Error::Unauthorized,
            other => other,
        })?;
        let mut agent = r.definition()?;
        agent.scope.project_ids = sqlx::query_scalar("SELECT project_id FROM agent_projects WHERE org_id=$1 AND agent_id=$2 ORDER BY project_id").bind(org).bind(id).fetch_all(&mut **tx).await?;
        current = agent.parent_id;
        result.push(agent);
    }
    Ok(result)
}
pub(super) struct Authorized {
    pub scope: Option<AgentScope>,
    pub agent_id: Option<Uuid>,
}
impl Authorized {
    pub fn permits_project(&self, id: Uuid) -> bool {
        self.scope
            .as_ref()
            .is_none_or(|s| s.project_ids.contains(&id))
    }
}
pub(super) async fn authorize(
    tx: &mut Transaction<'_, Postgres>,
    caller: Principal,
    org: Uuid,
    capability: AgentCapability,
) -> Result<Authorized, Error> {
    match caller {
        Principal::Human(actor) => {
            let permission = if matches!(
                capability,
                AgentCapability::ProposeMove | AgentCapability::ReadProposal
            ) {
                Permission::Plan
            } else {
                Permission::Read
            };
            tenancy::require(tx, actor, org, permission).await?;
            Ok(Authorized {
                scope: None,
                agent_id: None,
            })
        }
        Principal::Agent {
            id,
            agent_id,
            session_id,
        } => {
            let epoch: Option<i32> = sqlx::query_scalar("SELECT credential_epoch FROM agent_sessions WHERE id=$1 AND org_id=$2 AND agent_id=$3 AND principal_id=$4 AND expires_at>now() FOR SHARE")
                .bind(session_id).bind(org).bind(agent_id).bind(id).fetch_optional(&mut **tx).await?;
            let epoch = epoch.ok_or(Error::Unauthorized)?;
            let agent = row(tx, org, agent_id).await?;
            if agent.principal_id != id || agent.credential_epoch != epoch {
                return Err(Error::Unauthorized);
            }
            let ancestors = chain(tx, org, agent_id).await?;
            let mut scope = ancestors.first().ok_or(Error::Unauthorized)?.scope.clone();
            for parent in ancestors.iter().skip(1) {
                scope
                    .project_ids
                    .retain(|p| parent.scope.project_ids.contains(p));
                scope
                    .capabilities
                    .retain(|c| parent.scope.capabilities.contains(c));
                if parent.scope.mode == AgentMode::Observe {
                    scope.mode = AgentMode::Observe;
                }
            }
            if scope.project_ids.is_empty()
                || !scope.capabilities.contains(&capability)
                || (capability == AgentCapability::ProposeMove && scope.mode != AgentMode::Propose)
            {
                return Err(Error::Forbidden);
            }
            Ok(Authorized {
                scope: Some(scope),
                agent_id: Some(agent_id),
            })
        }
    }
}
