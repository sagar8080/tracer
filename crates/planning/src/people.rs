use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub role: String,
    pub team: String,
    pub daily_minutes: i32,
    pub cost_rate: Option<i32>,
    pub color: String,
    #[serde(default = "initial_version")]
    pub version: i32,
}

fn initial_version() -> i32 {
    1
}
