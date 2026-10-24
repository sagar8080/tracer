use crate::*;
use kivo_files::File;
use kivo_jobs::Lease;
use kivo_tenancy::Actor;
use std::future::Future;
use uuid::Uuid;
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("You do not have permission for this workspace")]
    Forbidden,
    #[error("This import or schedule changed. Review it again before publishing.")]
    Conflict,
    #[error("Import not found")]
    NotFound,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("Import service unavailable")]
    Unavailable,
}
pub struct Work {
    pub import: Import,
    pub file: File,
}
pub trait Repository: Send + Sync {
    fn read(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
    ) -> impl Future<Output = Result<Import, Error>> + Send;
    fn list(
        &self,
        actor: Actor,
        org: Uuid,
    ) -> impl Future<Output = Result<Vec<Import>, Error>> + Send;
    fn start(
        &self,
        actor: Actor,
        org: Uuid,
        input: Start,
        key: Uuid,
    ) -> impl Future<Output = Result<Import, Error>> + Send;
    fn review(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        input: Review,
        key: Uuid,
    ) -> impl Future<Output = Result<Import, Error>> + Send;
    fn publish(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        version: i32,
        key: Uuid,
    ) -> impl Future<Output = Result<Import, Error>> + Send;
    fn cancel(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        version: i32,
        key: Uuid,
    ) -> impl Future<Output = Result<Import, Error>> + Send;
    fn export(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        version: i32,
        key: Uuid,
    ) -> impl Future<Output = Result<Import, Error>> + Send;
    /// Current authority, import status and unexpired lease fence before any I/O.
    fn work(&self, lease: &Lease) -> impl Future<Output = Result<Work, Error>> + Send;
    /// Atomic staged result + lease completion; reauthorize and fence again.
    fn parsed(
        &self,
        lease: &Lease,
        workbook: Workbook,
    ) -> impl Future<Output = Result<(), Error>> + Send;
    fn exported(
        &self,
        lease: &Lease,
        file: &File,
    ) -> impl Future<Output = Result<(), Error>> + Send;
}
pub trait MappingSuggestions: Send + Sync {
    fn providers(&self) -> Vec<Provider>;
    fn suggest(
        &self,
        provider: Provider,
        workbook: &Workbook,
    ) -> impl Future<Output = Result<MappingHint, Error>> + Send;
}
