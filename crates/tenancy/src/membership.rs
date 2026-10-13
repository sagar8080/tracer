use crate::{Actor, Role};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::future::Future;
use uuid::Uuid;
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("You do not have permission for this workspace")]
    Forbidden,
    #[error("This record changed. Refresh and try again.")]
    Conflict,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("Workspace service unavailable")]
    Unavailable,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    pub org_id: Uuid,
    pub role: Role,
    pub revision: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub user_id: Uuid,
    pub email: String,
    pub role: Role,
    pub version: i32,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    pub id: Uuid,
    pub email: String,
    pub role: Role,
    pub expires_at: DateTime<Utc>,
}
#[derive(Serialize)]
pub struct Team {
    pub members: Vec<Member>,
    pub invitations: Vec<Invitation>,
}
#[derive(Serialize)]
pub struct Invited {
    pub invitation: Invitation,
    pub token: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TeamCommand {
    Invite {
        email: String,
        role: Role,
    },
    Revoke {
        id: Uuid,
    },
    ChangeRole {
        #[serde(rename = "userId")]
        user_id: Uuid,
        role: Role,
        version: i32,
    },
    Remove {
        #[serde(rename = "userId")]
        user_id: Uuid,
        version: i32,
    },
}
impl TeamCommand {
    pub fn validate(&self) -> Result<(), Error> {
        match self {
            Self::Invite { email, role }
                if email.len() > 254
                    || !email.contains('@')
                    || email.chars().any(char::is_whitespace)
                    || *role == Role::Owner =>
            {
                Err(Error::Invalid(
                    "Enter an email address and a non-owner role",
                ))
            }
            Self::ChangeRole { version, .. } | Self::Remove { version, .. } if *version < 1 => {
                Err(Error::Invalid("A positive membership version is required"))
            }
            _ => Ok(()),
        }
    }
}
/// Every write locks the organization before memberships and commits role policy,
/// last-owner protection, mutation, audit, receipt and change event together.
pub trait Repository: Send + Sync {
    fn team(&self, actor: Actor, org: Uuid) -> impl Future<Output = Result<Team, Error>> + Send;
    fn manage(
        &self,
        actor: Actor,
        org: Uuid,
        command: TeamCommand,
        request: Uuid,
    ) -> impl Future<Output = Result<Option<Invited>, Error>> + Send;
    fn accept(&self, actor: Actor, token: &str)
    -> impl Future<Output = Result<Uuid, Error>> + Send;
}
