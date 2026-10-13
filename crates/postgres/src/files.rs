use crate::{Postgres, error::Error, events, tenancy};
use kivo_files::{File, ObjectLocation, Repository, Upload};
use kivo_tenancy::{Actor, Permission};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
struct FileRow {
    id: Uuid,
    org_id: Uuid,
    filename: String,
    content_type: String,
    size_bytes: i64,
    status: String,
    bucket: String,
    object_key: String,
}
impl From<FileRow> for File {
    fn from(row: FileRow) -> Self {
        Self {
            id: row.id,
            org_id: row.org_id,
            filename: row.filename,
            content_type: row.content_type,
            size_bytes: row.size_bytes,
            status: row.status,
            bucket: row.bucket,
            object_key: row.object_key,
        }
    }
}
impl Repository for Postgres {
    async fn read(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        permission: Permission,
    ) -> Result<File, kivo_files::Error> {
        read(self, actor, org, id, permission)
            .await
            .map_err(Into::into)
    }
    async fn reserve(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        upload: &Upload,
        location: &ObjectLocation,
    ) -> Result<(), kivo_files::Error> {
        reserve(self, actor, org, id, upload, location)
            .await
            .map_err(Into::into)
    }
    async fn finalize(&self, actor: Actor, org: Uuid, id: Uuid) -> Result<(), kivo_files::Error> {
        finalize(self, actor, org, id).await.map_err(Into::into)
    }
}
async fn read(
    db: &Postgres,
    actor: Actor,
    org: Uuid,
    id: Uuid,
    permission: Permission,
) -> Result<File, Error> {
    let mut tx = db.pool.begin().await?;
    tenancy::require(&mut tx, actor, org, permission).await?;
    let file = sqlx::query_as::<_, FileRow>("SELECT * FROM files WHERE org_id=$1 AND id=$2")
        .bind(org)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(Error::NotFound)?;
    tx.commit().await?;
    Ok(file.into())
}
async fn reserve(
    db: &Postgres,
    actor: Actor,
    org: Uuid,
    id: Uuid,
    upload: &Upload,
    location: &ObjectLocation,
) -> Result<(), Error> {
    upload.validate().map_err(|e| match e {
        kivo_files::Error::Invalid(message) => Error::Invalid(message),
        _ => Error::Invalid("Invalid upload"),
    })?;
    let mut tx = db.pool.begin().await?;
    events::lock(&mut tx, org).await?;
    tenancy::require(&mut tx, actor, org, Permission::Plan).await?;
    let request = serde_json::json!({"kind":"file.reserve","upload":upload,"bucket":location.bucket,"key":location.key});
    if events::replay(&mut tx, org, actor.user_id, id, &request)
        .await?
        .is_some()
    {
        return Ok(());
    }
    sqlx::query("INSERT INTO files(id,org_id,created_by,filename,content_type,size_bytes,bucket,object_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(id).bind(org).bind(actor.user_id).bind(&upload.filename).bind(&upload.content_type).bind(upload.size_bytes).bind(&location.bucket).bind(&location.key)
        .execute(&mut *tx).await?;
    events::record(&mut tx, org, actor.user_id, id, "file.reserve").await?;
    events::receipt(
        &mut tx,
        org,
        actor.user_id,
        id,
        &request,
        &serde_json::Value::Null,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
async fn finalize(db: &Postgres, actor: Actor, org: Uuid, id: Uuid) -> Result<(), Error> {
    let mut tx = db.pool.begin().await?;
    events::lock(&mut tx, org).await?;
    tenancy::require(&mut tx, actor, org, Permission::Plan).await?;
    let rows = sqlx::query("UPDATE files SET status='ready', completed_at=now() WHERE id=$1 AND org_id=$2 AND status='pending'")
        .bind(id).bind(org).execute(&mut *tx).await?.rows_affected();
    if rows == 1 {
        events::record(&mut tx, org, actor.user_id, id, "file.complete").await?;
    }
    tx.commit().await?;
    Ok(())
}
