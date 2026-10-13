//! Account setup and explicit membership-to-resource enrollment contracts.
//! No provider or transport types cross this boundary. Each write is one atomic use case.
use kivo_planning::{Command, Person};
use kivo_tenancy::{Actor, Organization, Role};
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
    #[error("Account setup is unavailable")]
    Unavailable,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub email: String,
    pub email_verified: bool,
    pub invitations: Vec<PendingInvitation>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInvitation {
    pub id: Uuid,
    pub organization_name: String,
    pub role: Role,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub name: String,
    pub daily_minutes: i32,
}
impl Profile {
    pub fn person(&self, org: Uuid, id: Uuid) -> Person {
        Person {
            id,
            org_id: org,
            name: self.name.trim().into(),
            role: "Team member".into(),
            team: "General".into(),
            daily_minutes: self.daily_minutes,
            cost_rate: Some(0),
            color: "sage".into(),
            version: 1,
        }
    }
    pub fn validate(&self) -> Result<(), Error> {
        Command::Person(self.person(Uuid::nil(), Uuid::nil()))
            .validate()
            .map_err(Error::Invalid)
    }
}
/// These are setup paths, not permanent workspace types. A solo workspace can grow into a team.
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Setup {
    Personal {
        organization: Organization,
        profile: Profile,
    },
    Team {
        organization: Organization,
    },
}
impl Setup {
    pub fn organization(&self) -> &Organization {
        match self {
            Self::Personal { organization, .. } | Self::Team { organization } => organization,
        }
    }
    pub fn validate(&self) -> Result<(), Error> {
        let org = self.organization();
        if org.version != 1 {
            return Err(Error::Invalid("Setup requires a new workspace"));
        }
        Command::Organization(org.clone())
            .validate()
            .map_err(Error::Invalid)?;
        if let Self::Personal { profile, .. } = self {
            profile.validate()?;
        }
        Ok(())
    }
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Enrollment {
    Create {
        profile: Profile,
    },
    Link {
        #[serde(rename = "personId")]
        person_id: Uuid,
    },
    Unlink,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Enroll {
    pub user_id: Uuid,
    pub membership_version: i32,
    pub enrollment: Enrollment,
}
impl Enroll {
    pub fn validate(&self) -> Result<(), Error> {
        if self.membership_version < 1 {
            return Err(Error::Invalid("A positive membership version is required"));
        }
        if let Enrollment::Create { profile } = &self.enrollment {
            profile.validate()?;
        }
        Ok(())
    }
}
/// Authorize before replay; lock organization then membership, and commit profile/link,
/// version, receipt, audit and invalidation together. Removing access preserves planning history.
pub trait Repository: Send + Sync {
    fn status(&self, actor: Actor) -> impl Future<Output = Result<Status, Error>> + Send;
    fn setup(
        &self,
        actor: Actor,
        input: Setup,
        key: Uuid,
    ) -> impl Future<Output = Result<Uuid, Error>> + Send;
    fn enroll(
        &self,
        actor: Actor,
        org: Uuid,
        input: Enroll,
        key: Uuid,
    ) -> impl Future<Output = Result<(), Error>> + Send;
}
