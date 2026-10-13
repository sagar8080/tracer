//! Member leave requests and approval policy. Approved requests materialize planning absences atomically.
use chrono::NaiveDate;
use kivo_planning::{Absence, Command as PlanningCommand};
use kivo_tenancy::{Actor, Role};
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
    #[error("Leave requests are unavailable")]
    Unavailable,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub id: Uuid,
    pub user_id: Uuid,
    pub person_id: Uuid,
    pub person_name: String,
    pub title: String,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub daily_minutes: Option<i32>,
    pub status: String,
    pub version: i32,
    pub review_note: String,
    pub absence_id: Option<Uuid>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub can_request: bool,
    pub can_review: bool,
    pub person_id: Option<Uuid>,
    pub requests: Vec<Request>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Request {
        id: Uuid,
        title: String,
        start: NaiveDate,
        end: NaiveDate,
        #[serde(rename = "dailyMinutes")]
        daily_minutes: Option<i32>,
    },
    Cancel {
        id: Uuid,
        version: i32,
    },
    Review {
        id: Uuid,
        version: i32,
        decision: Decision,
        note: String,
    },
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Decision {
    Approve,
    Reject,
}
pub fn can_request(role: Role) -> bool {
    role != Role::Viewer
}
pub fn can_review(role: Role) -> bool {
    matches!(role, Role::Owner | Role::Admin)
}
impl Command {
    pub fn validate(&self) -> Result<(), Error> {
        match self {
            Self::Request {
                id,
                title,
                start,
                end,
                daily_minutes,
            } => PlanningCommand::Absence(Absence {
                id: *id,
                org_id: Uuid::nil(),
                person_id: Some(Uuid::nil()),
                category: "timeOff".into(),
                title: title.trim().into(),
                start: *start,
                end: *end,
                daily_minutes: *daily_minutes,
                version: 1,
            })
            .validate()
            .map_err(Error::Invalid),
            Self::Cancel { version, .. } if *version < 1 => {
                Err(Error::Invalid("A valid request version is required"))
            }
            Self::Review {
                version,
                note,
                decision,
                ..
            } if *version < 1
                || note.chars().count() > 500
                || matches!(decision, Decision::Reject) && note.trim().is_empty() =>
            {
                Err(Error::Invalid(
                    "A valid version and a reason for rejection are required",
                ))
            }
            Self::Cancel { .. } | Self::Review { .. } => Ok(()),
        }
    }
}
pub trait Repository: Send + Sync {
    fn leave(
        &self,
        actor: Actor,
        org: Uuid,
    ) -> impl Future<Output = Result<Snapshot, Error>> + Send;
    fn request_leave(
        &self,
        actor: Actor,
        org: Uuid,
        command: Command,
        key: Uuid,
    ) -> impl Future<Output = Result<(), Error>> + Send;
}
