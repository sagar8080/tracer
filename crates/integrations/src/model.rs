use chrono::NaiveDate;
use kivo_planning::{Assignment, Person, Project};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    Manual,
    Openai,
    Claude,
    Gemini,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Layout {
    Tabular,
    Weekly,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Unit {
    HoursPerDay,
    TotalHours,
    MinutesPerDay,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DateOrder {
    Iso,
    Mdy,
    Dmy,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MappingHint {
    pub sheet: usize,
    pub layout: Layout,
    pub person: usize,
    pub project: usize,
    pub start: Option<usize>,
    pub end: Option<usize>,
    pub effort: Option<usize>,
    pub row_key: Option<usize>,
    pub weeks: Vec<usize>,
    pub unit: Unit,
    pub date_order: DateOrder,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mapping {
    pub columns: MappingHint,
    pub accept_cached_formulas: bool,
    pub accept_calendar_defaults: bool,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Block,
    Warning,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub severity: Severity,
    pub code: String,
    pub message: String,
    pub cell: Option<String>,
}
impl Finding {
    pub fn block(code: &str, message: &str, cell: Option<String>) -> Self {
        Self {
            severity: Severity::Block,
            code: code.into(),
            message: message.into(),
            cell,
        }
    }
    pub fn warning(code: &str, message: &str) -> Self {
        Self {
            severity: Severity::Warning,
            code: code.into(),
            message: message.into(),
            cell: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub reference: String,
    pub value: String,
    pub formula: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    #[serde(default)]
    pub merged: bool,
    pub name: String,
    pub headers: Vec<Cell>,
    pub rows: Vec<Vec<Cell>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workbook {
    pub sheets: Vec<Sheet>,
    pub findings: Vec<Finding>,
    pub suggestion: Option<MappingHint>,
    pub suggestion_provider: Provider,
    pub fingerprint: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonBinding {
    pub label: String,
    pub id: Option<Uuid>,
    pub weekly_minutes: Option<Vec<i32>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectBinding {
    pub label: String,
    pub id: Option<Uuid>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    pub version: i32,
    pub mapping: Mapping,
    pub people: Vec<PersonBinding>,
    pub projects: Vec<ProjectBinding>,
}
impl Review {
    pub fn validate(&self) -> Result<(), super::Error> {
        if self.version < 1
            || self.people.len() > crate::MAX_ROWS
            || self.projects.len() > crate::MAX_ROWS
            || self.mapping.columns.weeks.len() > crate::MAX_COLUMNS
            || self
                .people
                .iter()
                .map(|p| &p.label)
                .chain(self.projects.iter().map(|p| &p.label))
                .any(|s| s.trim().is_empty() || s.chars().count() > 100)
        {
            return Err(super::Error::Invalid(
                "Mapping exceeds supported identity or column limits",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRow {
    pub key: String,
    pub person: String,
    pub project: String,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub minutes: i32,
    pub total: bool,
    pub cells: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub person_name: String,
    pub project_name: String,
    pub key: String,
    pub assignment: Assignment,
    pub cells: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPerson {
    pub person: Person,
    pub weekly_minutes: Vec<i32>,
    pub effective_from: NaiveDate,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityImpact {
    pub person_id: Uuid,
    pub name: String,
    pub date: NaiveDate,
    pub available_minutes: i32,
    pub planned_minutes: i32,
    pub calendar_effective_from: Option<NaiveDate>,
    pub absence_ids: Vec<Uuid>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    #[serde(default)]
    pub capacity: Vec<CapacityImpact>,
    pub org_revision: i64,
    pub source_version: i32,
    pub people: Vec<NewPerson>,
    pub projects: Vec<Project>,
    pub additions: Vec<Assignment>,
    pub updates: Vec<Assignment>,
    pub removals: Vec<Assignment>,
    pub links: Vec<Link>,
    pub findings: Vec<Finding>,
    pub total_minutes: i64,
}
impl Preview {
    pub fn can_publish(&self) -> bool {
        !self.findings.iter().any(|f| f.severity == Severity::Block)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Import {
    pub id: Uuid,
    pub source_id: Uuid,
    pub file_id: Uuid,
    pub filename: String,
    pub version: i32,
    pub source_version: i32,
    pub status: String,
    pub provider: Provider,
    pub workbook: Option<Workbook>,
    pub review: Option<Review>,
    pub preview: Option<Preview>,
    pub export_file_id: Option<Uuid>,
    pub export_status: Option<String>,
    pub published_revision: Option<i64>,
    pub error_code: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    pub file_id: Uuid,
    pub source_id: Option<Uuid>,
    pub provider: Provider,
    pub consent: bool,
}
impl Start {
    pub fn validate(&self) -> Result<(), super::Error> {
        if self.provider != Provider::Manual && !self.consent {
            return Err(super::Error::Invalid(
                "Consent is required before sending headers and sample cells to a model provider",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub imports: Vec<Import>,
    pub providers: Vec<Provider>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Version {
    pub version: i32,
}
