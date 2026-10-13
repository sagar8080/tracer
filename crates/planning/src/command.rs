use crate::{Absence, Assignment, Person, Project, WorkingCalendar};
use kivo_tenancy::{Organization, Permission};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub access: Vec<kivo_tenancy::Access>,
    pub actor_id: Option<Uuid>,
    pub organizations: Vec<Organization>,
    pub people: Vec<Person>,
    pub projects: Vec<Project>,
    pub assignments: Vec<Assignment>,
    pub calendars: Vec<WorkingCalendar>,
    pub absences: Vec<Absence>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Command {
    Organization(Organization),
    Person(Person),
    Project(Project),
    Assignment(Assignment),
    Calendar(WorkingCalendar),
    Absence(Absence),
    DeleteCalendar {
        id: Uuid,
        #[serde(rename = "orgId")]
        org_id: Uuid,
        version: i32,
    },
    DeleteAbsence {
        id: Uuid,
        #[serde(rename = "orgId")]
        org_id: Uuid,
        version: i32,
    },
    DeleteAssignment {
        id: Uuid,
        #[serde(rename = "orgId")]
        org_id: Uuid,
        version: i32,
    },
}
impl Command {
    pub fn org_id(&self) -> Uuid {
        match self {
            Self::Organization(v) => v.id,
            Self::Person(v) => v.org_id,
            Self::Project(v) => v.org_id,
            Self::Assignment(v) => v.org_id,
            Self::Calendar(v) => v.org_id,
            Self::Absence(v) => v.org_id,
            Self::DeleteAssignment { org_id, .. }
            | Self::DeleteCalendar { org_id, .. }
            | Self::DeleteAbsence { org_id, .. } => *org_id,
        }
    }
    pub fn entity_id(&self) -> Uuid {
        match self {
            Self::Organization(v) => v.id,
            Self::Person(v) => v.id,
            Self::Project(v) => v.id,
            Self::Assignment(v) => v.id,
            Self::Calendar(v) => v.id,
            Self::Absence(v) => v.id,
            Self::DeleteAssignment { id, .. }
            | Self::DeleteCalendar { id, .. }
            | Self::DeleteAbsence { id, .. } => *id,
        }
    }
    pub fn action(&self) -> &'static str {
        match self {
            Self::Organization(_) => "organization.save",
            Self::Person(_) => "person.save",
            Self::Project(_) => "project.save",
            Self::Assignment(_) => "assignment.save",
            Self::DeleteAssignment { .. } => "assignment.delete",
            Self::Calendar(_) => "calendar.save",
            Self::Absence(_) => "absence.save",
            Self::DeleteCalendar { .. } => "calendar.delete",
            Self::DeleteAbsence { .. } => "absence.delete",
        }
    }
    pub fn permission(&self, stored_absence_category: Option<&str>) -> Permission {
        match self {
            Self::Organization(_)
            | Self::Person(_)
            | Self::Calendar(_)
            | Self::DeleteCalendar { .. } => Permission::Administer,
            Self::Absence(v) if v.category == "holiday" => Permission::Administer,
            Self::DeleteAbsence { .. } if stored_absence_category == Some("holiday") => {
                Permission::Administer
            }
            Self::Project(_)
            | Self::Assignment(_)
            | Self::DeleteAssignment { .. }
            | Self::Absence(_)
            | Self::DeleteAbsence { .. } => Permission::Plan,
        }
    }
    pub fn validate(&self) -> Result<(), &'static str> {
        let name = |s: &str| !s.trim().is_empty() && s.chars().count() <= 100;
        let color = |s: &str| matches!(s, "sage" | "lilac" | "blue" | "peach" | "rose");
        let valid = match self {
            Self::Organization(v) => {
                v.version > 0
                    && name(&v.name)
                    && v.currency == "USD"
                    && v.timezone.parse::<chrono_tz::Tz>().is_ok()
            }
            Self::Person(v) => {
                v.version > 0
                    && name(&v.name)
                    && name(&v.role)
                    && name(&v.team)
                    && (60..=1440).contains(&v.daily_minutes)
                    && v.cost_rate.is_none_or(|r| (0..=10_000_000).contains(&r))
                    && color(&v.color)
            }
            Self::Project(v) => {
                v.version > 0
                    && name(&v.name)
                    && name(&v.client)
                    && color(&v.color)
                    && (60..=100_000_000).contains(&v.budget_minutes)
                    && v.bill_rate.is_none_or(|r| (0..=10_000_000).contains(&r))
                    && matches!(v.status.as_str(), "confirmed" | "tentative" | "complete")
            }
            Self::Assignment(v) => {
                name(&v.title)
                    && (15..=1440).contains(&v.daily_minutes)
                    && v.daily_minutes % 15 == 0
                    && matches!(v.status.as_str(), "confirmed" | "tentative")
                    && v.version > 0
                    && v.end >= v.start
                    && (v.end - v.start).num_days() <= 366
            }
            Self::Calendar(v) => {
                v.version > 0
                    && v.weekly_minutes.len() == 7
                    && v.weekly_minutes
                        .iter()
                        .all(|m| (0..=1440).contains(m) && m % 15 == 0)
            }
            Self::Absence(v) => {
                name(&v.title)
                    && v.version > 0
                    && v.end >= v.start
                    && (v.end - v.start).num_days() <= 366
                    && v.daily_minutes
                        .is_none_or(|m| (15..=1440).contains(&m) && m % 15 == 0)
                    && match v.category.as_str() {
                        "holiday" => v.person_id.is_none() && v.daily_minutes.is_none(),
                        "timeOff" => v.person_id.is_some(),
                        _ => false,
                    }
            }
            Self::DeleteAssignment { version, .. }
            | Self::DeleteCalendar { version, .. }
            | Self::DeleteAbsence { version, .. } => *version > 0,
        };
        if valid {
            Ok(())
        } else {
            Err("Invalid fields, date range, or working-day allocation")
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::has_workday;
    use chrono::NaiveDate;
    #[test]
    fn weekend_only_is_invalid() {
        let start = NaiveDate::from_ymd_opt(2026, 10, 10).expect("fixture");
        assert!(!has_workday(start, start.succ_opt().expect("fixture"), &[]));
        assert!(has_workday(start, start + chrono::Duration::days(2), &[]));
    }
    #[test]
    fn reject_invalid_timezone() {
        let c = Command::Organization(Organization {
            id: Uuid::new_v4(),
            name: "Studio".into(),
            currency: "USD".into(),
            timezone: "Mars/Olympus".into(),
            version: 1,
        });
        assert!(c.validate().is_err());
    }
    #[test]
    fn reject_subquarter_and_reversed_allocation() {
        let d = NaiveDate::from_ymd_opt(2026, 10, 12).expect("fixture");
        let mut a = Assignment {
            id: Uuid::new_v4(),
            org_id: Uuid::new_v4(),
            person_id: Uuid::new_v4(),
            project_id: Uuid::new_v4(),
            title: "Design".into(),
            start: d,
            end: d,
            daily_minutes: 61,
            status: "confirmed".into(),
            version: 1,
        };
        assert!(Command::Assignment(a.clone()).validate().is_err());
        a.daily_minutes = 60;
        a.end = d - chrono::Duration::days(1);
        assert!(Command::Assignment(a).validate().is_err());
    }
}
