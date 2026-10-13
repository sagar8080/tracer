//! Agent registry and credential contracts. Authority is owned by tenancy.
use chrono::{DateTime, Utc};
use kivo_tenancy::{Actor, AgentScope, Principal};
use serde::{Deserialize, Serialize};
use std::future::Future;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Agent authentication required")]
    Unauthorized,
    #[error("You do not have permission for this action")]
    Forbidden,
    #[error("The plan or agent changed. Refresh and try again.")]
    Conflict,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("Agent services are unavailable")]
    Unavailable,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: Uuid,
    pub principal_id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub purpose: String,
    pub owner_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub scope: AgentScope,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    pub active: bool,
    pub version: i32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub agents: Vec<Agent>,
}
// Intentionally not Debug: returned secrets must not reach logs or receipts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issued {
    pub agent: Agent,
    pub credential: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Register {
        id: Uuid,
        name: String,
        purpose: String,
        scope: AgentScope,
        #[serde(rename = "expiresAt")]
        expires_at: DateTime<Utc>,
        #[serde(rename = "parentId")]
        parent_id: Option<Uuid>,
    },
    Rotate {
        id: Uuid,
        version: i32,
    },
    Revoke {
        id: Uuid,
        version: i32,
    },
}
impl Command {
    pub fn validate(&self, now: DateTime<Utc>) -> Result<(), Error> {
        match self {
            Self::Register {
                name,
                purpose,
                scope,
                expires_at,
                ..
            } => {
                if name.trim().is_empty()
                    || name.chars().count() > 100
                    || purpose.trim().is_empty()
                    || purpose.chars().count() > 500
                {
                    return Err(Error::Invalid(
                        "Enter a name of up to 100 characters and a purpose of up to 500",
                    ));
                }
                scope.validate().map_err(Error::Invalid)?;
                if *expires_at <= now || *expires_at > now + chrono::Duration::days(90) {
                    return Err(Error::Invalid("Delegations must expire within 90 days"));
                }
            }
            Self::Rotate { version, .. } | Self::Revoke { version, .. } => {
                if *version < 1 {
                    return Err(Error::Invalid("A current agent version is required"));
                }
            }
        }
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub access_token: String,
    pub token_type: &'static str,
    pub expires_at: DateTime<Utc>,
    pub agent_id: Uuid,
}
pub struct Verified {
    pub principal: Principal,
    pub org_id: Uuid,
    pub expires_at: DateTime<Utc>,
}
pub trait Repository: Send + Sync {
    fn agents(
        &self,
        actor: Actor,
        org: Uuid,
    ) -> impl Future<Output = Result<Registry, Error>> + Send;
    fn manage_agent(
        &self,
        actor: Actor,
        org: Uuid,
        command: Command,
        key: Uuid,
    ) -> impl Future<Output = Result<Issued, Error>> + Send;
    fn exchange_agent_credential(
        &self,
        credential: &str,
    ) -> impl Future<Output = Result<Session, Error>> + Send;
    fn verify_agent_session(
        &self,
        token: &str,
    ) -> impl Future<Output = Result<Verified, Error>> + Send;
}
