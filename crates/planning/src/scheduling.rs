use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub id: Uuid,
    pub org_id: Uuid,
    pub person_id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub daily_minutes: i32,
    pub status: String,
    pub version: i32,
}

impl Assignment {
    /// Called with calendars read while the person's schedule lock is held.
    pub fn validate_calendar(
        &self,
        calendars: &[crate::WorkingCalendar],
    ) -> Result<(), &'static str> {
        if !crate::has_workday(self.start, self.end, calendars) {
            return Err("Include at least one working day in this person's calendar");
        }
        Ok(())
    }
}
