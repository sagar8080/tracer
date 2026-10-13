//! Bounded planning tools and reviewable proposal lifecycle; no model/transport/SQL dependencies.
mod planning;
use chrono::NaiveDate;
pub use kivo_agents::Error;
use kivo_planning::Assignment;
use kivo_tenancy::Principal;
pub use planning::{CapacitySource, checked_move, day_series};
use serde::{Deserialize, Serialize};
use std::future::Future;
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Window {
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub cursor: Option<Uuid>,
}
impl Window {
    pub fn validate(&self) -> Result<(), Error> {
        let days = self.end.signed_duration_since(self.start).num_days();
        if !(0..93).contains(&days) {
            return Err(Error::Invalid("Choose a window of 1–93 days"));
        }
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub client: String,
    pub status: String,
    pub version: i32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: Uuid,
    pub name: String,
    pub role: String,
    pub team: String,
    pub version: i32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub revision: i64,
    pub timezone: String,
    pub projects: Vec<Project>,
    pub people: Vec<Person>,
    pub assignments: Vec<Assignment>,
    pub next_cursor: Option<Uuid>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: NaiveDate,
    pub capacity_minutes: i32,
    pub planned_minutes: i32,
    pub overload_minutes: i32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capacity {
    pub revision: i64,
    pub person_id: Uuid,
    pub days: Vec<Day>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Move {
    pub assignment_id: Uuid,
    pub expected_version: i32,
    pub source_revision: i64,
    pub person_id: Uuid,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub reason: String,
}
impl Move {
    pub fn validate(&self) -> Result<(), Error> {
        Window {
            start: self.start,
            end: self.end,
            cursor: None,
        }
        .validate()?;
        if self.expected_version < 1
            || self.source_revision < 0
            || self.reason.trim().is_empty()
            || self.reason.chars().count() > 1000
        {
            return Err(Error::Invalid(
                "Use current source versions and a reason of up to 1000 characters",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Impact {
    pub before: Vec<Day>,
    pub after: Vec<Day>,
    pub person_id: Uuid,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub original: Assignment,
    pub proposed: Assignment,
    pub impacts: Vec<Impact>,
    pub source_fingerprint: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: Uuid,
    pub org_id: Uuid,
    pub agent_id: Option<Uuid>,
    #[serde(default)]
    pub agent_name: Option<String>,
    pub principal_id: Uuid,
    pub status: Status,
    pub version: i32,
    pub content_hash: String,
    pub request: Move,
    pub preview: Preview,
    pub review_note: String,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Pending,
    Reviewed,
    Rejected,
    Cancelled,
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Propose {
        id: Uuid,
        request: Move,
    },
    Review {
        id: Uuid,
        version: i32,
        #[serde(rename = "contentHash")]
        content_hash: String,
        decision: ReviewDecision,
        note: String,
    },
    Cancel {
        id: Uuid,
        version: i32,
    },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewDecision {
    MarkReviewed,
    Reject,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposals {
    pub proposals: Vec<Proposal>,
    pub next_cursor: Option<Uuid>,
}
pub trait Repository: Send + Sync {
    fn capabilities(
        &self,
        caller: Principal,
        org: Uuid,
    ) -> impl Future<Output = Result<Vec<kivo_tenancy::AgentCapability>, Error>> + Send;
    fn schedule_window(
        &self,
        caller: Principal,
        org: Uuid,
        window: Window,
    ) -> impl Future<Output = Result<Schedule, Error>> + Send;
    fn capacity_window(
        &self,
        caller: Principal,
        org: Uuid,
        person: Uuid,
        window: Window,
    ) -> impl Future<Output = Result<Capacity, Error>> + Send;
    fn proposals(
        &self,
        caller: Principal,
        org: Uuid,
        cursor: Option<Uuid>,
    ) -> impl Future<Output = Result<Proposals, Error>> + Send;
    fn proposal(
        &self,
        caller: Principal,
        org: Uuid,
        id: Uuid,
    ) -> impl Future<Output = Result<Proposal, Error>> + Send;
    fn propose(
        &self,
        caller: Principal,
        org: Uuid,
        command: Command,
        key: Uuid,
    ) -> impl Future<Output = Result<Proposal, Error>> + Send;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_reject_reversed_and_unbounded_work() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 13).expect("fixture");
        assert!(
            Window {
                start: date,
                end: date + chrono::Duration::days(92),
                cursor: None
            }
            .validate()
            .is_ok()
        );
        assert!(
            Window {
                start: date,
                end: date + chrono::Duration::days(93),
                cursor: None
            }
            .validate()
            .is_err()
        );
        assert!(
            Window {
                start: date,
                end: date - chrono::Duration::days(1),
                cursor: None
            }
            .validate()
            .is_err()
        );
    }
}
