use crate::{Postgres, error::Error};
use kivo_tenancy::{Actor, DevelopmentIdentity, IdentityError, Permission, Role};
use sqlx::Transaction;
use uuid::Uuid;

pub(super) async fn role(
    tx: &mut Transaction<'_, sqlx::Postgres>,
    actor: Actor,
    org: Uuid,
) -> Result<Option<Role>, Error> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE")
            .bind(org)
            .bind(actor.user_id)
            .fetch_optional(&mut **tx)
            .await?;
    Ok(value.as_deref().and_then(Role::parse))
}
pub(super) async fn require(
    tx: &mut Transaction<'_, sqlx::Postgres>,
    actor: Actor,
    org: Uuid,
    permission: Permission,
) -> Result<(), Error> {
    if !role(tx, actor, org)
        .await?
        .is_some_and(|role| role.permits(permission))
    {
        return Err(Error::Forbidden);
    }
    Ok(())
}
impl DevelopmentIdentity for Postgres {
    async fn ensure_development_actor(&self, actor: Actor) -> Result<(), IdentityError> {
        sqlx::query("INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT(id) DO NOTHING")
            .bind(actor.user_id)
            .bind(format!("{}@local.invalid", actor.user_id))
            .execute(&self.pool)
            .await
            .map_err(|e| {
                tracing::error!(error=%e,"development identity provisioning failed");
                IdentityError
            })?;
        Ok(())
    }
}
