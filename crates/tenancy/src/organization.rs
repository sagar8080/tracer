use serde::{Deserialize, Serialize};
use uuid::Uuid;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
    pub id: Uuid,
    pub name: String,
    pub timezone: String,
    pub currency: String,
    #[serde(default = "initial_version")]
    pub version: i32,
}

fn initial_version() -> i32 {
    1
}
