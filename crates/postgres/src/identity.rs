use crate::Postgres;
use kivo_identity::{Directory, Error, Identity};
use kivo_tenancy::Actor;
use uuid::Uuid;
impl Directory for Postgres {
    async fn resolve(&self, identity: &Identity) -> Result<Actor, Error> {
        resolve(self, identity)
            .await
            .map_err(|_| Error::Unavailable)
    }
}
async fn resolve(db: &Postgres, identity: &Identity) -> Result<Actor, sqlx::Error> {
    let known:Option<(Uuid,String,bool)>=sqlx::query_as("SELECT u.id,u.email,u.email_verified FROM external_identities e JOIN users u ON u.id=e.user_id WHERE e.issuer=$1 AND e.subject=$2").bind(&identity.issuer).bind(&identity.subject).fetch_optional(&db.pool).await?;
    if let Some((id, email, verified)) = known
        && verified == identity.email_verified
        && identity.email.as_ref().is_none_or(|e| *e == email)
    {
        return Ok(Actor { user_id: id });
    }
    let mut tx = db.pool.begin().await?;
    // Serializes only first-login races for this issuer/subject pair, including
    // absent rows. Never matches or merges users by email.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("{}\n{}", identity.issuer, identity.subject))
        .execute(&mut *tx)
        .await?;
    let user: Option<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM external_identities WHERE issuer=$1 AND subject=$2",
    )
    .bind(&identity.issuer)
    .bind(&identity.subject)
    .fetch_optional(&mut *tx)
    .await?;
    let user = match user {
        Some(id) => id,
        None => {
            let id = Uuid::new_v4();
            sqlx::query("INSERT INTO users(id,email,email_verified) VALUES($1,$2,$3)")
                .bind(id)
                .bind(
                    identity
                        .email
                        .clone()
                        .unwrap_or_else(|| format!("{id}@identity.invalid")),
                )
                .bind(identity.email_verified)
                .execute(&mut *tx)
                .await?;
            sqlx::query("INSERT INTO external_identities(issuer,subject,user_id) VALUES($1,$2,$3)")
                .bind(&identity.issuer)
                .bind(&identity.subject)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            id
        }
    };
    if let Some(email) = &identity.email {
        sqlx::query("UPDATE users SET email=$2,email_verified=$3 WHERE id=$1 AND (email IS DISTINCT FROM $2 OR email_verified IS DISTINCT FROM $3)").bind(user).bind(email).bind(identity.email_verified).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE users SET email_verified=false WHERE id=$1 AND email_verified")
            .bind(user)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Actor { user_id: user })
}
