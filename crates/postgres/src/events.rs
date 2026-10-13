//! Transaction-local authorization serialization, receipts and committed invalidations.
use crate::error::Error;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;
pub(super) fn hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}
pub(super) fn secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
pub(super) async fn lock(tx: &mut Transaction<'_, Postgres>, org: Uuid) -> Result<(), Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))")
        .bind(org.to_string())
        .execute(&mut **tx)
        .await?;
    sqlx::query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE")
        .bind(org)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
pub(super) async fn replay(
    tx: &mut Transaction<'_, Postgres>,
    org: Uuid,
    actor: Uuid,
    key: Uuid,
    request: &Value,
) -> Result<Option<Value>, Error> {
    let saved:Option<(Value,Value)>=sqlx::query_as("SELECT request,result FROM command_receipts WHERE org_id=$1 AND actor_id=$2 AND request_id=$3").bind(org).bind(actor).bind(key).fetch_optional(&mut **tx).await?;
    match saved {
        Some((original, result)) if original == *request => Ok(Some(result)),
        Some(_) => Err(Error::Conflict),
        None => Ok(None),
    }
}
pub(super) async fn receipt(
    tx: &mut Transaction<'_, Postgres>,
    org: Uuid,
    actor: Uuid,
    key: Uuid,
    request: &Value,
    result: &Value,
) -> Result<(), Error> {
    sqlx::query("INSERT INTO command_receipts(org_id,actor_id,request_id,request,result) VALUES($1,$2,$3,$4,$5)").bind(org).bind(actor).bind(key).bind(request).bind(result).execute(&mut **tx).await?;
    Ok(())
}
pub(super) async fn record(
    tx: &mut Transaction<'_, Postgres>,
    org: Uuid,
    actor: Uuid,
    entity: Uuid,
    kind: &str,
) -> Result<(), Error> {
    sqlx::query("INSERT INTO audit_events(org_id,actor_id,entity_id,action) VALUES($1,$2,$3,$4)")
        .bind(org)
        .bind(actor)
        .bind(entity)
        .bind(kind)
        .execute(&mut **tx)
        .await?;
    let revision: i64 = sqlx::query_scalar(
        "UPDATE organizations SET revision=revision+1 WHERE id=$1 RETURNING revision",
    )
    .bind(org)
    .fetch_one(&mut **tx)
    .await?;
    sqlx::query("INSERT INTO workspace_events(org_id,revision,entity_id,kind) VALUES($1,$2,$3,$4)")
        .bind(org)
        .bind(revision)
        .bind(entity)
        .bind(kind)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
