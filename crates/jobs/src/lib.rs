//! Durable jobs: leases are fenced; provider work runs outside repository locks.
use serde::{Deserialize, Serialize};
use std::future::Future;
use uuid::Uuid;
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    WorkbookParse,
    WorkbookExport,
}
impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WorkbookParse => "workbookParse",
            Self::WorkbookExport => "workbookExport",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "workbookParse" => Some(Self::WorkbookParse),
            "workbookExport" => Some(Self::WorkbookExport),
            _ => None,
        }
    }
}
#[derive(Clone, Debug)]
pub struct Lease {
    pub id: Uuid,
    pub org_id: Uuid,
    pub actor_id: Uuid,
    pub entity_id: Uuid,
    pub kind: Kind,
    pub fence: i64,
    pub attempt: i32,
}
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Job lease is no longer current")]
    Conflict,
    #[error("Job queue unavailable")]
    Unavailable,
}
pub trait Repository: Send + Sync {
    /// One running job per tenant, fair tenant rotation; max three attempts.
    fn claim(&self) -> impl Future<Output = Result<Option<Lease>, Error>> + Send;
    /// Sanitized, fixed error codes only. Third failure is durable dead letter.
    fn fail(
        &self,
        lease: &Lease,
        code: &'static str,
    ) -> impl Future<Output = Result<(), Error>> + Send;
}
