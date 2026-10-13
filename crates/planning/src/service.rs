use crate::{Command, Workspace};
use kivo_tenancy::Actor;
use std::future::Future;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("You do not have permission for this workspace")]
    Forbidden,
    #[error("This record changed or is unavailable. Reload before editing.")]
    Conflict,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("Could not persist this change. Check related records and retry.")]
    Persistence { constraint: bool },
}

/// Reads return one consistent, tenant-authorized snapshot. Writes must validate,
/// lock membership, check versions/related records, mutate and audit atomically.
/// A cancelled write rolls back unless commit already completed; callers reload
/// after ambiguous failures. A supplied request UUID atomically deduplicates
/// identical commands; reusing it for another payload is a conflict. Each retry
/// must reauthorize. No provider retries or cross-call transactions.
pub trait Repository: Send + Sync {
    fn read(&self, actor: Actor) -> impl Future<Output = Result<Workspace, Error>> + Send;
    fn execute(
        &self,
        actor: Actor,
        command: Command,
        request: Option<uuid::Uuid>,
    ) -> impl Future<Output = Result<(), Error>> + Send;
}
#[derive(Clone)]
pub struct Service<R> {
    repository: R,
}
impl<R: Repository> Service<R> {
    pub fn new(repository: R) -> Self {
        Self { repository }
    }
    pub async fn read(&self, actor: Actor) -> Result<Workspace, Error> {
        self.repository.read(actor).await
    }
    pub async fn execute(&self, actor: Actor, command: Command) -> Result<(), Error> {
        command.validate().map_err(Error::Invalid)?;
        self.repository.execute(actor, command, None).await
    }
    pub async fn execute_once(
        &self,
        actor: Actor,
        command: Command,
        request: uuid::Uuid,
    ) -> Result<(), Error> {
        command.validate().map_err(Error::Invalid)?;
        self.repository.execute(actor, command, Some(request)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use uuid::Uuid;
    struct RejectingRepository(Arc<AtomicUsize>);
    impl Repository for RejectingRepository {
        async fn read(&self, _actor: Actor) -> Result<Workspace, Error> {
            Err(Error::Forbidden)
        }
        async fn execute(
            &self,
            _actor: Actor,
            _command: Command,
            _request: Option<Uuid>,
        ) -> Result<(), Error> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(Error::Conflict)
        }
    }
    #[tokio::test]
    async fn replacement_adapter_preserves_validation_and_errors_without_fallback() {
        let calls = Arc::new(AtomicUsize::new(0));
        let service = Service::new(RejectingRepository(calls.clone()));
        let actor = Actor {
            user_id: Uuid::nil(),
        };
        let delete = |version| Command::DeleteAssignment {
            id: Uuid::nil(),
            org_id: Uuid::nil(),
            version,
        };
        assert!(matches!(
            service.execute(actor, delete(0)).await,
            Err(Error::Invalid(_))
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(matches!(
            service.execute(actor, delete(1)).await,
            Err(Error::Conflict)
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(matches!(service.read(actor).await, Err(Error::Forbidden)));
    }
}
