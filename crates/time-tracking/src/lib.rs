//! Weekly time-entry ownership, validation and approval policy. Persistence is an atomic port.
use chrono::{Datelike, NaiveDate};
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
    #[error("Time tracking is unavailable")]
    Unavailable,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SheetStatus {
    Draft,
    Submitted,
    Approved,
}
impl SheetStatus {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "draft" => Some(Self::Draft),
            "submitted" => Some(Self::Submitted),
            "approved" => Some(Self::Approved),
            _ => None,
        }
    }
}
pub fn can_record(role: Role) -> bool {
    role != Role::Viewer
}
pub fn can_review(role: Role) -> bool {
    matches!(role, Role::Owner | Role::Admin)
}
pub fn week(date: NaiveDate) -> Result<NaiveDate, Error> {
    date.checked_sub_signed(chrono::Duration::days(
        date.weekday().num_days_from_monday() as i64,
    ))
    .ok_or(Error::Invalid("Choose a supported calendar date"))
}
pub fn validate_week(date: NaiveDate) -> Result<(), Error> {
    if week(date)? != date {
        return Err(Error::Invalid("Choose a week beginning on Monday"));
    }
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: Uuid,
    pub sheet_id: Uuid,
    pub project_id: Uuid,
    pub date: NaiveDate,
    pub minutes: i32,
    pub billable: bool,
    pub note: String,
    pub version: i32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub id: Uuid,
    pub user_id: Uuid,
    pub person_id: Uuid,
    pub person_name: String,
    pub week: NaiveDate,
    pub status: SheetStatus,
    pub version: i32,
    pub review_note: String,
    pub entries: Vec<Entry>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub person_id: Option<Uuid>,
    pub can_record: bool,
    pub can_review: bool,
    pub own: Option<Sheet>,
    pub reviews: Vec<Sheet>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Save {
        id: Uuid,
        date: NaiveDate,
        #[serde(rename = "projectId")]
        project_id: Uuid,
        minutes: i32,
        billable: bool,
        note: String,
        version: i32,
        #[serde(rename = "sheetVersion")]
        sheet_version: i32,
    },
    Delete {
        id: Uuid,
        week: NaiveDate,
        version: i32,
        #[serde(rename = "sheetVersion")]
        sheet_version: i32,
    },
    Submit {
        week: NaiveDate,
        version: i32,
    },
    Withdraw {
        week: NaiveDate,
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
    Return,
}
impl Command {
    pub fn validate(&self) -> Result<(), Error> {
        match self {
            Self::Save {
                date,
                minutes,
                note,
                version,
                sheet_version,
                ..
            } => {
                week(*date)?;
                if !(1..=1440).contains(minutes)
                    || note.chars().count() > 500
                    || *version < 1
                    || *sheet_version < 0
                {
                    return Err(Error::Invalid(
                        "Enter 1–1440 minutes, a note of up to 500 characters and valid versions",
                    ));
                }
            }
            Self::Delete {
                week,
                version,
                sheet_version,
                ..
            } => {
                validate_week(*week)?;
                if *version < 1 || *sheet_version < 1 {
                    return Err(Error::Invalid(
                        "Valid entry and timesheet versions are required",
                    ));
                }
            }
            Self::Submit { week, version } | Self::Withdraw { week, version } => {
                validate_week(*week)?;
                if *version < 1 {
                    return Err(Error::Invalid("A valid timesheet version is required"));
                }
            }
            Self::Review {
                version,
                decision,
                note,
                ..
            } => {
                if *version < 1
                    || note.chars().count() > 500
                    || matches!(decision, Decision::Return) && note.trim().is_empty()
                {
                    return Err(Error::Invalid(
                        "A valid version and a reason for returning time are required",
                    ));
                }
            }
        }
        Ok(())
    }
}
/// Authorization, sheet/entry versions, approval locks, daily limits, mutation, receipt and audit
/// commit together. Submitted sheets cannot be edited; approved sheets cannot be reopened.
pub trait Repository: Send + Sync {
    fn timesheets(
        &self,
        actor: Actor,
        org: Uuid,
        week: NaiveDate,
    ) -> impl Future<Output = Result<Snapshot, Error>> + Send;
    fn track_time(
        &self,
        actor: Actor,
        org: Uuid,
        command: Command,
        key: Uuid,
    ) -> impl Future<Output = Result<(), Error>> + Send;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn business_weeks_cross_years_and_handle_date_limits_without_panicking() {
        let friday = NaiveDate::from_ymd_opt(2027, 1, 1).expect("fixture");
        assert_eq!(
            week(friday).expect("supported date"),
            NaiveDate::from_ymd_opt(2026, 12, 28).expect("fixture")
        );
        assert!(validate_week(friday).is_err());
        assert!(week(NaiveDate::MIN).is_err());
    }
}
