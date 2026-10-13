use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingCalendar {
    pub id: Uuid,
    pub org_id: Uuid,
    pub person_id: Uuid,
    pub effective_from: NaiveDate,
    pub weekly_minutes: Vec<i32>,
    pub version: i32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Absence {
    pub id: Uuid,
    pub org_id: Uuid,
    pub person_id: Option<Uuid>,
    pub category: String,
    pub title: String,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub daily_minutes: Option<i32>,
    pub version: i32,
}
use chrono::{Datelike, Weekday};
pub fn has_workday(start: NaiveDate, end: NaiveDate, calendars: &[WorkingCalendar]) -> bool {
    start
        .iter_days()
        .take(367)
        .take_while(|d| *d <= end)
        .any(|date| {
            calendars
                .iter()
                .filter(|c| c.effective_from <= date)
                .max_by_key(|c| c.effective_from)
                .map(|c| c.weekly_minutes[date.weekday().num_days_from_monday() as usize] > 0)
                .unwrap_or(!matches!(date.weekday(), Weekday::Sat | Weekday::Sun))
        })
}

/// Effective daily capacity shared by scheduling reports and member self-service.
/// Leave reductions overlap by maximum, and never erase scheduled effort.
pub fn base_minutes_on(
    person: &crate::Person,
    date: NaiveDate,
    calendars: &[WorkingCalendar],
) -> i32 {
    let day = date.weekday().num_days_from_monday() as usize;
    calendars
        .iter()
        .filter(|c| {
            c.org_id == person.org_id && c.person_id == person.id && c.effective_from <= date
        })
        .max_by_key(|c| c.effective_from)
        .and_then(|c| c.weekly_minutes.get(day))
        .copied()
        .unwrap_or(if day < 5 { person.daily_minutes } else { 0 })
}
pub fn available_minutes_on(
    person: &crate::Person,
    date: NaiveDate,
    calendars: &[WorkingCalendar],
    absences: &[Absence],
) -> i32 {
    let base = base_minutes_on(person, date, calendars);
    let removed = absences
        .iter()
        .filter(|a| {
            a.org_id == person.org_id
                && (a.person_id == Some(person.id) || a.category == "holiday")
                && a.start <= date
                && a.end >= date
        })
        .map(|a| a.daily_minutes.unwrap_or(base))
        .max()
        .unwrap_or(0)
        .min(base);
    base - removed
}
