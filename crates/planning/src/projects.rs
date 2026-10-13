use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub client: String,
    pub color: String,
    pub budget_minutes: i32,
    pub bill_rate: Option<i32>,
    pub status: String,
    #[serde(default = "initial_version")]
    pub version: i32,
}

impl Project {
    /// Called with the current status read under the project's shared lock.
    pub fn validate_allocation_status(status: Option<&str>) -> Result<(), &'static str> {
        if status.is_none_or(|status| status == "complete") {
            return Err("Choose an active project in this workspace");
        }
        Ok(())
    }
}

fn initial_version() -> i32 {
    1
}
