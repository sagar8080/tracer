use crate::{File, Upload};
use kivo_tenancy::{Actor, Permission};
use serde::Serialize;
use std::{collections::BTreeMap, future::Future};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("You do not have permission for this workspace")]
    Forbidden,
    #[error("This request key was already used for a different upload")]
    Conflict,
    #[error("File not found")]
    NotFound,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("{0}")]
    Unavailable(&'static str),
    #[error("Could not persist this change. Check related records and retry.")]
    Persistence { constraint: bool },
}
pub struct ObjectLocation {
    pub bucket: String,
    pub key: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedRequest {
    pub url: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub expires_in_seconds: u64,
}
/// Each operation rechecks locked membership in one transaction. Reserve and
/// finalize include their audit write. Finalize is idempotent, auditing once.
/// Reads are tenant scoped. Cancellation before commit rolls back; ambiguous
/// commit results can be retried with the same reservation id and metadata.
/// Reusing the id with different metadata must return Conflict; reauthorize first.
pub trait Repository: Send + Sync {
    fn reserve(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        upload: &Upload,
        location: &ObjectLocation,
    ) -> impl Future<Output = Result<(), Error>> + Send;
    fn read(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        permission: Permission,
    ) -> impl Future<Output = Result<File, Error>> + Send;
    fn finalize(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
    ) -> impl Future<Output = Result<(), Error>> + Send;
}
/// Server-owned keys and expiring private URLs. Uploads bind length, content type,
/// encryption and conditional no-overwrite headers; downloads are attachments
/// with private/no-store caching. Verify must check size/type, never just existence.
/// Bound network deadlines in the adapter. Signing failure leaves a reservation
/// pending; verification failure must not finalize it. No database locks are held.
pub trait ObjectStore: Send + Sync {
    fn location(&self, org: Uuid, id: Uuid) -> ObjectLocation;
    fn ping(&self) -> impl Future<Output = Result<(), Error>> + Send;
    fn upload(
        &self,
        key: &str,
        content_type: &str,
        size: i64,
    ) -> impl Future<Output = Result<SignedRequest, Error>> + Send;
    fn verify(
        &self,
        bucket: &str,
        key: &str,
        content_type: &str,
        size: i64,
    ) -> impl Future<Output = Result<(), Error>> + Send;
    fn download(
        &self,
        bucket: &str,
        key: &str,
        filename: &str,
    ) -> impl Future<Output = Result<SignedRequest, Error>> + Send;
}

/// Worker byte I/O is separate from browser signing. Enforce configured bucket,
/// expected metadata and bounded streaming; writes are immutable and retry-safe.
pub trait ObjectBytes: Send + Sync {
    fn read_bytes(&self, file: &File) -> impl Future<Output = Result<Vec<u8>, Error>> + Send;
    fn write_bytes(
        &self,
        org: Uuid,
        id: Uuid,
        filename: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> impl Future<Output = Result<File, Error>> + Send;
}
