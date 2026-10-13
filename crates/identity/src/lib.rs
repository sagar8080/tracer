//! Verified identity contracts, independent of OAuth provider and persistence.
use chrono::{DateTime, Utc};
use kivo_tenancy::Actor;
use std::future::Future;
#[derive(Clone)]
pub struct Identity {
    pub issuer: String,
    pub subject: String,
    pub email: Option<String>,
    pub email_verified: bool,
    pub expires_at: DateTime<Utc>,
}
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Authentication required")]
    Unauthorized,
    #[error("Identity service unavailable")]
    Unavailable,
}
pub trait Verifier: Send + Sync {
    fn verify(&self, token: &str) -> impl Future<Output = Result<Identity, Error>> + Send;
}
/// Resolve only by issuer and subject. Email must never link two accounts.
pub trait Directory: Send + Sync {
    fn resolve(&self, identity: &Identity) -> impl Future<Output = Result<Actor, Error>> + Send;
}
