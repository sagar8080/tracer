use crate::{Error, File, ObjectStore, Repository, SignedRequest, Upload};
use kivo_tenancy::{Actor, Permission};
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReservedUpload {
    pub file_id: Uuid,
    pub upload: SignedRequest,
}
#[derive(Serialize)]
pub struct Download {
    pub file: File,
    pub download: SignedRequest,
}
#[derive(Clone)]
pub struct Service<R, S> {
    repository: R,
    storage: S,
}
impl<R: Repository, S: ObjectStore> Service<R, S> {
    pub fn new(repository: R, storage: S) -> Self {
        Self {
            repository,
            storage,
        }
    }
    pub async fn ping(&self) -> Result<(), Error> {
        self.storage.ping().await
    }
    pub async fn reserve(
        &self,
        actor: Actor,
        org: Uuid,
        upload: Upload,
    ) -> Result<ReservedUpload, Error> {
        self.reserve_once(actor, org, upload, Uuid::new_v4()).await
    }
    pub async fn reserve_once(
        &self,
        actor: Actor,
        org: Uuid,
        upload: Upload,
        id: Uuid,
    ) -> Result<ReservedUpload, Error> {
        upload.validate()?;
        let location = self.storage.location(org, id);
        self.repository
            .reserve(actor, org, id, &upload, &location)
            .await?;
        let upload = self
            .storage
            .upload(&location.key, &upload.content_type, upload.size_bytes)
            .await?;
        Ok(ReservedUpload {
            file_id: id,
            upload,
        })
    }
    pub async fn complete(&self, actor: Actor, org: Uuid, id: Uuid) -> Result<(), Error> {
        let record = self
            .repository
            .read(actor, org, id, Permission::Plan)
            .await?;
        if record.status == "ready" {
            return Ok(());
        }
        self.storage
            .verify(
                &record.bucket,
                &record.object_key,
                &record.content_type,
                record.size_bytes,
            )
            .await?;
        self.repository.finalize(actor, org, id).await
    }
    pub async fn download(&self, actor: Actor, org: Uuid, id: Uuid) -> Result<Download, Error> {
        let file = self
            .repository
            .read(actor, org, id, Permission::Read)
            .await?;
        if file.status != "ready" {
            return Err(Error::Invalid("Complete the upload before downloading"));
        }
        let download = self
            .storage
            .download(&file.bucket, &file.object_key, &file.filename)
            .await?;
        Ok(Download { file, download })
    }
}
