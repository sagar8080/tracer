//! Non-authoritative request throttling. Configured outages fail explicitly.
pub mod upstash;
use std::future::Future;
use uuid::Uuid;
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny { retry_after_seconds: u64 },
}
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Unavailable(&'static str),
}
/// Implementations must atomically count and expire each window, use a server
/// clock, and never retry after ambiguous delivery. Bound I/O deadlines and expose
/// outages separately from denial. Disabled behavior is selected at composition.
pub trait RateLimiter: Send + Sync {
    fn check(&self, user: Uuid) -> impl Future<Output = Result<Decision, Error>> + Send;
    fn ping(&self) -> impl Future<Output = Result<(), Error>> + Send;
}
