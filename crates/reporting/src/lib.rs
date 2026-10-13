//! Hour-based planned/actual reporting over an authorized consistent snapshot.
use chrono::NaiveDate;
use kivo_planning::{
    Absence, Assignment, Person, Project, WorkingCalendar, available_minutes_on, base_minutes_on,
};
use kivo_tenancy::Actor;
use kivo_time_tracking::SheetStatus;
use serde::Serialize;
use std::{collections::HashMap, future::Future};
use uuid::Uuid;
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("You do not have permission for this workspace")]
    Forbidden,
    #[error("This record changed. Refresh and try again.")]
    Conflict,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("Reporting is unavailable")]
    Unavailable,
}
pub fn validate_range(start: NaiveDate, end: NaiveDate) -> Result<(), Error> {
    if end < start || (end - start).num_days() > 365 {
        return Err(Error::Invalid(
            "Choose a reporting period of up to 366 days",
        ));
    }
    Ok(())
}
pub struct Actual {
    pub person_id: Uuid,
    pub project_id: Uuid,
    pub date: NaiveDate,
    pub minutes: i32,
    pub billable: bool,
    pub status: SheetStatus,
}
pub struct Source {
    pub people: Vec<Person>,
    pub projects: Vec<Project>,
    pub assignments: Vec<Assignment>,
    pub calendars: Vec<WorkingCalendar>,
    pub absences: Vec<Absence>,
    pub actuals: Vec<Actual>,
    pub approved_project_totals: HashMap<Uuid, i64>,
}
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub planned_minutes: i64,
    pub recorded_minutes: i64,
    pub approved_minutes: i64,
    pub billable_minutes: i64,
    pub capacity_minutes: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonReport {
    pub id: Uuid,
    pub name: String,
    #[serde(flatten)]
    pub totals: Totals,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectReport {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub budget_minutes: i32,
    pub lifetime_approved_minutes: i64,
    #[serde(flatten)]
    pub totals: Totals,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayReport {
    pub date: NaiveDate,
    #[serde(flatten)]
    pub totals: Totals,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub totals: Totals,
    pub people: Vec<PersonReport>,
    pub projects: Vec<ProjectReport>,
    pub days: Vec<DayReport>,
}
fn add(target: &mut Totals, other: &Totals) {
    target.planned_minutes += other.planned_minutes;
    target.recorded_minutes += other.recorded_minutes;
    target.approved_minutes += other.approved_minutes;
    target.billable_minutes += other.billable_minutes;
    target.capacity_minutes += other.capacity_minutes;
}
pub fn calculate(start: NaiveDate, end: NaiveDate, source: Source) -> Report {
    let mut people: Vec<_> = source
        .people
        .iter()
        .map(|p| PersonReport {
            id: p.id,
            name: p.name.clone(),
            totals: Totals::default(),
        })
        .collect();
    let mut projects: Vec<_> = source
        .projects
        .iter()
        .map(|p| ProjectReport {
            id: p.id,
            name: p.name.clone(),
            color: p.color.clone(),
            budget_minutes: p.budget_minutes,
            lifetime_approved_minutes: *source.approved_project_totals.get(&p.id).unwrap_or(&0),
            totals: Totals::default(),
        })
        .collect();
    let pi: HashMap<_, _> = people.iter().enumerate().map(|(i, p)| (p.id, i)).collect();
    let ji: HashMap<_, _> = projects
        .iter()
        .enumerate()
        .map(|(i, p)| (p.id, i))
        .collect();
    let mut days: Vec<_> = start
        .iter_days()
        .take(366)
        .take_while(|d| *d <= end)
        .map(|date| DayReport {
            date,
            totals: Totals::default(),
        })
        .collect();
    for (i, p) in source.people.iter().enumerate() {
        let calendars: Vec<_> = source
            .calendars
            .iter()
            .filter(|c| c.person_id == p.id)
            .cloned()
            .collect();
        let absences: Vec<_> = source
            .absences
            .iter()
            .filter(|a| a.person_id == Some(p.id) || a.category == "holiday")
            .cloned()
            .collect();
        for day in &mut days {
            let value = i64::from(available_minutes_on(p, day.date, &calendars, &absences));
            people[i].totals.capacity_minutes += value;
            day.totals.capacity_minutes += value;
        }
    }
    for a in &source.assignments {
        if a.status != "confirmed" {
            continue;
        }
        if let (Some(&person), Some(&project)) = (pi.get(&a.person_id), ji.get(&a.project_id)) {
            for day in &mut days {
                if a.start <= day.date
                    && a.end >= day.date
                    && base_minutes_on(&source.people[person], day.date, &source.calendars) > 0
                {
                    let value = i64::from(a.daily_minutes);
                    people[person].totals.planned_minutes += value;
                    projects[project].totals.planned_minutes += value;
                    day.totals.planned_minutes += value;
                }
            }
        }
    }
    for a in source.actuals {
        if a.date < start || a.date > end {
            continue;
        }
        let value = Totals {
            recorded_minutes: i64::from(a.minutes),
            approved_minutes: if a.status == SheetStatus::Approved {
                i64::from(a.minutes)
            } else {
                0
            },
            billable_minutes: if a.billable { i64::from(a.minutes) } else { 0 },
            ..Totals::default()
        };
        if let Some(&i) = pi.get(&a.person_id) {
            add(&mut people[i].totals, &value);
        }
        if let Some(&i) = ji.get(&a.project_id) {
            add(&mut projects[i].totals, &value);
        }
        if let Some(day) = days.get_mut((a.date - start).num_days() as usize) {
            add(&mut day.totals, &value);
        }
    }
    let mut totals = Totals::default();
    for day in &days {
        add(&mut totals, &day.totals);
    }
    Report {
        start,
        end,
        totals,
        people,
        projects,
        days,
    }
}
pub trait Repository: Send + Sync {
    fn report(
        &self,
        actor: Actor,
        org: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> impl Future<Output = Result<Report, Error>> + Send;
}
