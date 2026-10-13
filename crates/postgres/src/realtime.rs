use crate::{Postgres, error::Error, events, tenancy};
use chrono::{DateTime, Utc};
use kivo_realtime::{Change, Changes, Repository, Subscription, Ticket};
use kivo_tenancy::{Actor, Permission, Role};
use uuid::Uuid;
impl Repository for Postgres {
    async fn issue_ticket(
        &self,
        actor: Actor,
        org: Uuid,
        valid_until: DateTime<Utc>,
    ) -> Result<Ticket, kivo_realtime::Error> {
        issue(self, actor, org, valid_until)
            .await
            .map_err(Into::into)
    }
    async fn consume_ticket(&self, ticket: &str) -> Result<Subscription, kivo_realtime::Error> {
        consume(self, ticket).await.map_err(Into::into)
    }
    async fn changes(
        &self,
        actor: Actor,
        org: Uuid,
        after: i64,
    ) -> Result<Changes, kivo_realtime::Error> {
        changes(self, actor, org, after).await.map_err(Into::into)
    }
    async fn revisions(&self, orgs: &[Uuid]) -> Result<Vec<(Uuid, i64)>, kivo_realtime::Error> {
        sqlx::query_as("SELECT id,revision FROM organizations WHERE id=ANY($1)")
            .bind(orgs)
            .fetch_all(&self.pool)
            .await
            .map_err(|_| kivo_realtime::Error::Unavailable)
    }
}
async fn issue(
    db: &Postgres,
    actor: Actor,
    org: Uuid,
    until: DateTime<Utc>,
) -> Result<Ticket, Error> {
    let mut tx = db.pool.begin().await?;
    tenancy::require(&mut tx, actor, org, Permission::Read).await?;
    let ticket = events::secret();
    let expires_at = Utc::now() + chrono::Duration::seconds(30);
    if until <= Utc::now() {
        return Err(Error::Forbidden);
    }
    sqlx::query("DELETE FROM realtime_tickets WHERE expires_at<now()")
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO realtime_tickets(token_hash,org_id,user_id,expires_at,valid_until) VALUES($1,$2,$3,$4,$5)").bind(events::hash(&ticket)).bind(org).bind(actor.user_id).bind(expires_at).bind(until).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Ticket { ticket, expires_at })
}
async fn consume(db: &Postgres, ticket: &str) -> Result<Subscription, Error> {
    if ticket.len() != 64 {
        return Err(Error::Forbidden);
    }
    let row:Option<(Uuid,Uuid,DateTime<Utc>)>=sqlx::query_as("DELETE FROM realtime_tickets WHERE token_hash=$1 AND expires_at>now() AND valid_until>now() RETURNING org_id,user_id,valid_until").bind(events::hash(ticket)).fetch_optional(&db.pool).await?;
    let (org_id, user_id, valid_until) = row.ok_or(Error::Forbidden)?;
    // Membership is rechecked in the initial authorized snapshot before delivery.
    Ok(Subscription {
        actor: Actor { user_id },
        org_id,
        valid_until,
    })
}
async fn changes(db: &Postgres, actor: Actor, org: Uuid, after: i64) -> Result<Changes, Error> {
    let mut tx = db.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let row:Option<(String,i64)>=sqlx::query_as("SELECT m.role,o.revision FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.org_id=$1 AND m.user_id=$2").bind(org).bind(actor.user_id).fetch_optional(&mut *tx).await?;
    let (role, revision) = row.ok_or(Error::Forbidden)?;
    let role = Role::parse(&role).ok_or(Error::Forbidden)?;
    let rows:Vec<(i64,String,Uuid)>=sqlx::query_as("SELECT revision,kind,entity_id FROM workspace_events WHERE org_id=$1 AND revision>$2 ORDER BY revision LIMIT 257").bind(org).bind(after).fetch_all(&mut *tx).await?;
    let reset = after < 0
        || after > revision
        || rows.len() > 256
        || rows.first().is_some_and(|r| r.0 != after + 1)
        || (rows.is_empty() && after < revision);
    let changes = if reset {
        vec![]
    } else {
        rows.into_iter()
            .map(|(revision, kind, entity_id)| Change {
                revision,
                kind,
                entity_id,
            })
            .collect()
    };
    tx.commit().await?;
    Ok(Changes {
        role,
        revision,
        reset,
        changes,
    })
}
