//! Committed workspace changes and single-use subscription credentials.
use chrono::{DateTime, Utc};
use kivo_tenancy::{Actor, Role};
use serde::{Deserialize, Serialize};
use std::future::Future;
use uuid::Uuid;
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Subscription denied")]
    Forbidden,
    #[error("Change stream unavailable")]
    Unavailable,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub ticket: String,
    pub expires_at: DateTime<Utc>,
}
pub struct Subscription {
    pub actor: Actor,
    pub org_id: Uuid,
    pub valid_until: DateTime<Utc>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub revision: i64,
    pub kind: String,
    pub entity_id: Uuid,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub revision: i64,
    pub role: Role,
    pub reset: bool,
    pub changes: Vec<Change>,
}
/// Tickets expire in 30 seconds and can be consumed once. Snapshot cursors and
/// event revisions share a committed, monotonic per-organization sequence.
pub trait Repository: Send + Sync {
    fn issue_ticket(
        &self,
        actor: Actor,
        org: Uuid,
        valid_until: DateTime<Utc>,
    ) -> impl Future<Output = Result<Ticket, Error>> + Send;
    fn consume_ticket(
        &self,
        ticket: &str,
    ) -> impl Future<Output = Result<Subscription, Error>> + Send;
    fn changes(
        &self,
        actor: Actor,
        org: Uuid,
        after: i64,
    ) -> impl Future<Output = Result<Changes, Error>> + Send;
    fn revisions(
        &self,
        orgs: &[Uuid],
    ) -> impl Future<Output = Result<Vec<(Uuid, i64)>, Error>> + Send;
}
