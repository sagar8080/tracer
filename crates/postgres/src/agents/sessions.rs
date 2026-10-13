use super::{authorize, chain};
use crate::{Postgres, error::Error, events};
use chrono::{DateTime, Utc};
use kivo_agents::{Session, Verified};
use kivo_tenancy::{AgentCapability, Principal};
use uuid::Uuid;
fn valid_secret(secret: &str, prefix: &str) -> bool {
    secret
        .strip_prefix(prefix)
        .is_some_and(|tail| tail.len() == 64 && tail.bytes().all(|b| b.is_ascii_hexdigit()))
}
pub(super) async fn exchange(db: &Postgres, credential: &str) -> Result<Session, Error> {
    if !valid_secret(credential, "kivo_agent_") {
        return Err(Error::Unauthorized);
    }
    let hash = events::hash(credential);
    let mut tx = db.pool.begin().await?;
    let org: Uuid = sqlx::query_scalar("SELECT org_id FROM agents WHERE credential_hash=$1")
        .bind(&hash)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(Error::Unauthorized)?;
    events::lock(&mut tx, org).await?;
    let row: super::AgentRow =
        sqlx::query_as("SELECT * FROM agents WHERE org_id=$1 AND credential_hash=$2 FOR UPDATE")
            .bind(org)
            .bind(&hash)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(Error::Unauthorized)?;
    let ancestors = chain(&mut tx, org, row.id).await?;
    if ancestors.iter().any(|a| a.scope.project_ids.is_empty()) {
        return Err(Error::Unauthorized);
    }
    sqlx::query("DELETE FROM agent_sessions WHERE agent_id=$1 AND expires_at<=now()")
        .bind(row.id)
        .execute(&mut *tx)
        .await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM agent_sessions WHERE agent_id=$1 AND expires_at>now()",
    )
    .bind(row.id)
    .fetch_one(&mut *tx)
    .await?;
    if count >= 20 {
        return Err(Error::Invalid(
            "Too many active agent sessions; reuse an existing session",
        ));
    }
    let expiry = ancestors
        .iter()
        .map(|a| a.expires_at)
        .min()
        .ok_or(Error::Unauthorized)?
        .min(Utc::now() + chrono::Duration::minutes(5));
    let token = format!("kivo_session_{}", events::secret());
    sqlx::query("INSERT INTO agent_sessions(id,org_id,agent_id,principal_id,token_hash,credential_epoch,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(Uuid::new_v4()).bind(org).bind(row.id).bind(row.principal_id).bind(events::hash(&token)).bind(row.credential_epoch).bind(expiry).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Session {
        access_token: token,
        token_type: "Bearer",
        expires_at: expiry,
        agent_id: row.id,
    })
}
pub(super) async fn verify(db: &Postgres, token: &str) -> Result<Verified, Error> {
    if !valid_secret(token, "kivo_session_") {
        return Err(Error::Unauthorized);
    }
    let mut tx = db.pool.begin().await?;
    let record: Option<(Uuid,Uuid,Uuid,Uuid,DateTime<Utc>)> = sqlx::query_as("SELECT id,org_id,agent_id,principal_id,expires_at FROM agent_sessions WHERE token_hash=$1 AND expires_at>now()")
        .bind(events::hash(token)).fetch_optional(&mut *tx).await?;
    let (session_id, org_id, agent_id, id, expires_at) = record.ok_or(Error::Unauthorized)?;
    let principal = Principal::Agent {
        id,
        agent_id,
        session_id,
    };
    // Authentication checks the entire delegation, independently of which tool is called.
    let leaf = super::row(&mut tx, org_id, agent_id).await?;
    let scope: kivo_tenancy::AgentScope =
        serde_json::from_value(leaf.scope).map_err(|_| Error::Unauthorized)?;
    let capability = scope
        .capabilities
        .first()
        .copied()
        .unwrap_or(AgentCapability::ReadSchedule);
    authorize(&mut tx, principal, org_id, capability).await?;
    tx.commit().await?;
    Ok(Verified {
        principal,
        org_id,
        expires_at,
    })
}
