use chrono::NaiveDate;
use uuid::Uuid;
#[derive(sqlx::FromRow)]
pub(super) struct OrganizationRow {
    pub id: Uuid,
    pub name: String,
    pub timezone: String,
    pub currency: String,
    pub version: i32,
}
impl From<OrganizationRow> for kivo_tenancy::Organization {
    fn from(row: OrganizationRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            timezone: row.timezone,
            currency: row.currency,
            version: row.version,
        }
    }
}
#[derive(sqlx::FromRow)]
pub(super) struct PersonRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub role: String,
    pub team: String,
    pub daily_minutes: i32,
    pub cost_rate: i32,
    pub color: String,
    pub version: i32,
}
impl From<PersonRow> for kivo_planning::Person {
    fn from(row: PersonRow) -> Self {
        Self {
            id: row.id,
            org_id: row.org_id,
            name: row.name,
            role: row.role,
            team: row.team,
            daily_minutes: row.daily_minutes,
            cost_rate: Some(row.cost_rate),
            color: row.color,
            version: row.version,
        }
    }
}
#[derive(sqlx::FromRow)]
pub(super) struct ProjectRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub client: String,
    pub color: String,
    pub budget_minutes: i32,
    pub bill_rate: i32,
    pub status: String,
    pub version: i32,
}
impl From<ProjectRow> for kivo_planning::Project {
    fn from(row: ProjectRow) -> Self {
        Self {
            id: row.id,
            org_id: row.org_id,
            name: row.name,
            client: row.client,
            color: row.color,
            budget_minutes: row.budget_minutes,
            bill_rate: Some(row.bill_rate),
            status: row.status,
            version: row.version,
        }
    }
}
#[derive(sqlx::FromRow)]
pub(super) struct AssignmentRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub person_id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    #[sqlx(rename = "start_date")]
    pub start: NaiveDate,
    #[sqlx(rename = "end_date")]
    pub end: NaiveDate,
    pub daily_minutes: i32,
    pub status: String,
    pub version: i32,
}
impl From<AssignmentRow> for kivo_planning::Assignment {
    fn from(row: AssignmentRow) -> Self {
        Self {
            id: row.id,
            org_id: row.org_id,
            person_id: row.person_id,
            project_id: row.project_id,
            title: row.title,
            start: row.start,
            end: row.end,
            daily_minutes: row.daily_minutes,
            status: row.status,
            version: row.version,
        }
    }
}
#[derive(sqlx::FromRow)]
pub(super) struct WorkingCalendarRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub person_id: Uuid,
    pub effective_from: NaiveDate,
    pub weekly_minutes: Vec<i32>,
    pub version: i32,
}
impl From<WorkingCalendarRow> for kivo_planning::WorkingCalendar {
    fn from(row: WorkingCalendarRow) -> Self {
        Self {
            id: row.id,
            org_id: row.org_id,
            person_id: row.person_id,
            effective_from: row.effective_from,
            weekly_minutes: row.weekly_minutes,
            version: row.version,
        }
    }
}
#[derive(sqlx::FromRow)]
pub(super) struct AbsenceRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub person_id: Option<Uuid>,
    pub category: String,
    pub title: String,
    #[sqlx(rename = "start_date")]
    pub start: NaiveDate,
    #[sqlx(rename = "end_date")]
    pub end: NaiveDate,
    pub daily_minutes: Option<i32>,
    pub version: i32,
}
impl From<AbsenceRow> for kivo_planning::Absence {
    fn from(row: AbsenceRow) -> Self {
        Self {
            id: row.id,
            org_id: row.org_id,
            person_id: row.person_id,
            category: row.category,
            title: row.title,
            start: row.start,
            end: row.end,
            daily_minutes: row.daily_minutes,
            version: row.version,
        }
    }
}
