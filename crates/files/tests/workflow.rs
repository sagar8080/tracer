//! The application can run against replacement ports without a provider SDK.
//! These tests exercise failures between atomic DB steps, not mock SQL semantics.
use kivo_files::{
    Error, File, ObjectLocation, ObjectStore, Repository, Service, SignedRequest, Upload,
};
use kivo_tenancy::{Actor, Permission};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Default)]
struct State {
    events: Vec<&'static str>,
    sign_failure: bool,
    verify_failure: bool,
    revoke_on_verify: bool,
    denied: bool,
    ready: bool,
}
#[derive(Clone, Default)]
struct Fixture(Arc<Mutex<State>>);
impl Repository for Fixture {
    async fn reserve(
        &self,
        _: Actor,
        _: Uuid,
        _: Uuid,
        _: &Upload,
        _: &ObjectLocation,
    ) -> Result<(), Error> {
        let mut state = self.0.lock().unwrap();
        if state.denied {
            return Err(Error::Forbidden);
        }
        state.events.push("reserve committed");
        Ok(())
    }
    async fn read(&self, _: Actor, org: Uuid, id: Uuid, _: Permission) -> Result<File, Error> {
        let mut state = self.0.lock().unwrap();
        if state.denied {
            return Err(Error::Forbidden);
        }
        state.events.push("read authorized");
        Ok(File {
            id,
            org_id: org,
            filename: "plan.csv".into(),
            content_type: "text/csv".into(),
            size_bytes: 1,
            status: if state.ready { "ready" } else { "pending" }.into(),
            bucket: "test".into(),
            object_key: "key".into(),
        })
    }
    async fn finalize(&self, _: Actor, _: Uuid, _: Uuid) -> Result<(), Error> {
        let mut state = self.0.lock().unwrap();
        state.events.push("finalize reauthorized");
        if state.denied {
            return Err(Error::Forbidden);
        }
        state.ready = true;
        Ok(())
    }
}
impl ObjectStore for Fixture {
    fn location(&self, _: Uuid, _: Uuid) -> ObjectLocation {
        ObjectLocation {
            bucket: "test".into(),
            key: "key".into(),
        }
    }
    async fn ping(&self) -> Result<(), Error> {
        Ok(())
    }
    async fn upload(&self, _: &str, _: &str, _: i64) -> Result<SignedRequest, Error> {
        let mut state = self.0.lock().unwrap();
        state.events.push("sign");
        if state.sign_failure {
            return Err(Error::Unavailable("signing failed"));
        }
        Ok(signed())
    }
    async fn verify(&self, _: &str, _: &str, _: &str, _: i64) -> Result<(), Error> {
        let mut state = self.0.lock().unwrap();
        state.events.push("verify");
        if state.verify_failure {
            return Err(Error::Invalid("metadata mismatch"));
        }
        if state.revoke_on_verify {
            state.denied = true;
        }
        Ok(())
    }
    async fn download(&self, _: &str, _: &str, _: &str) -> Result<SignedRequest, Error> {
        self.0.lock().unwrap().events.push("download");
        Ok(signed())
    }
}
fn signed() -> SignedRequest {
    SignedRequest {
        url: "https://storage.invalid/signed".into(),
        method: "PUT".into(),
        headers: Default::default(),
        expires_in_seconds: 300,
    }
}
fn actor() -> Actor {
    Actor {
        user_id: Uuid::nil(),
    }
}
fn upload() -> Upload {
    Upload {
        filename: "plan.csv".into(),
        content_type: "text/csv".into(),
        size_bytes: 1,
    }
}

#[tokio::test]
async fn signing_failure_leaves_committed_reservation_and_denial_never_signs() {
    let fixture = Fixture::default();
    let service = Service::new(fixture.clone(), fixture.clone());
    fixture.0.lock().unwrap().sign_failure = true;
    assert!(matches!(
        service.reserve(actor(), Uuid::nil(), upload()).await,
        Err(Error::Unavailable(_))
    ));
    assert_eq!(
        fixture.0.lock().unwrap().events,
        ["reserve committed", "sign"]
    );
    fixture.0.lock().unwrap().denied = true;
    assert!(matches!(
        service.reserve(actor(), Uuid::nil(), upload()).await,
        Err(Error::Forbidden)
    ));
    assert_eq!(
        fixture.0.lock().unwrap().events,
        ["reserve committed", "sign"]
    );
}
#[tokio::test]
async fn failed_verification_never_finalizes_and_revocation_is_rechecked() {
    let fixture = Fixture::default();
    let service = Service::new(fixture.clone(), fixture.clone());
    fixture.0.lock().unwrap().verify_failure = true;
    assert!(matches!(
        service.complete(actor(), Uuid::nil(), Uuid::nil()).await,
        Err(Error::Invalid(_))
    ));
    assert_eq!(
        fixture.0.lock().unwrap().events,
        ["read authorized", "verify"]
    );
    {
        let mut state = fixture.0.lock().unwrap();
        state.verify_failure = false;
        state.revoke_on_verify = true;
    }
    assert!(matches!(
        service.complete(actor(), Uuid::nil(), Uuid::nil()).await,
        Err(Error::Forbidden)
    ));
    let state = fixture.0.lock().unwrap();
    assert!(!state.ready);
    assert_eq!(state.events.last(), Some(&"finalize reauthorized"));
}
#[tokio::test]
async fn pending_download_rejected_and_ready_completion_skips_storage() {
    let fixture = Fixture::default();
    let service = Service::new(fixture.clone(), fixture.clone());
    assert!(matches!(
        service.download(actor(), Uuid::nil(), Uuid::nil()).await,
        Err(Error::Invalid(_))
    ));
    fixture.0.lock().unwrap().ready = true;
    service
        .complete(actor(), Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(
        fixture.0.lock().unwrap().events,
        ["read authorized", "read authorized"]
    );
    service
        .download(actor(), Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(fixture.0.lock().unwrap().events.last(), Some(&"download"));
}
