use crate::{error::Error, events};
use kivo_jobs::{Kind, Lease, Repository};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;
pub(super) async fn enqueue(
    tx: &mut Transaction<'_, Postgres>,
    org: Uuid,
    actor: Uuid,
    entity: Uuid,
    kind: Kind,
) -> Result<(), Error> {
    sqlx::query("INSERT INTO job_lanes(org_id) VALUES($1) ON CONFLICT DO NOTHING")
        .bind(org)
        .execute(&mut **tx)
        .await?;
    sqlx::query("INSERT INTO durable_jobs(id,org_id,actor_id,entity_id,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING").bind(Uuid::new_v4()).bind(org).bind(actor).bind(entity).bind(kind.as_str()).execute(&mut **tx).await?;
    Ok(())
}
pub(super) async fn fence(tx: &mut Transaction<'_, Postgres>, lease: &Lease) -> Result<(), Error> {
    let found:Option<Uuid>=sqlx::query_scalar("SELECT id FROM durable_jobs WHERE id=$1 AND org_id=$2 AND actor_id=$3 AND entity_id=$4 AND kind=$5 AND status='running' AND fence=$6 AND lease_until>clock_timestamp() FOR UPDATE")
        .bind(lease.id).bind(lease.org_id).bind(lease.actor_id).bind(lease.entity_id).bind(lease.kind.as_str()).bind(lease.fence).fetch_optional(&mut **tx).await?;
    if found.is_none() {
        return Err(Error::Conflict);
    }
    Ok(())
}
pub(super) async fn done(tx: &mut Transaction<'_, Postgres>, lease: &Lease) -> Result<(), Error> {
    fence(tx, lease).await?;
    sqlx::query("UPDATE durable_jobs SET status='done',lease_until=NULL WHERE id=$1")
        .bind(lease.id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
impl Repository for crate::Postgres {
    async fn claim(&self) -> Result<Option<Lease>, kivo_jobs::Error> {
        async {
            let mut tx=self.pool.begin().await?;
            // Lanes prevent two replicas from both claiming jobs for the same tenant.
            let org:Option<Uuid>=sqlx::query_scalar("SELECT l.org_id FROM job_lanes l WHERE EXISTS(SELECT 1 FROM durable_jobs j WHERE j.org_id=l.org_id AND ((j.status='queued' AND j.available_at<=now()) OR (j.status='running' AND j.lease_until<=clock_timestamp()))) AND NOT EXISTS(SELECT 1 FROM durable_jobs j WHERE j.org_id=l.org_id AND j.status='running' AND j.lease_until>clock_timestamp()) ORDER BY l.last_claimed_at,l.org_id FOR UPDATE OF l SKIP LOCKED LIMIT 1").fetch_optional(&mut *tx).await?;
            let Some(org)=org else { return Ok(None); };
            // Exhausted crashed leases become dead letters, never an infinite retry.
            sqlx::query("UPDATE durable_jobs SET status='dead',error_code='lease_exhausted',lease_until=NULL WHERE org_id=$1 AND status='running' AND lease_until<=clock_timestamp() AND attempts=3").bind(org).execute(&mut *tx).await?;
            let row:Option<(Uuid,Uuid,Uuid,String,i64,i32)>=sqlx::query_as("UPDATE durable_jobs SET status='running',attempts=attempts+1,fence=fence+1,lease_until=now()+interval '90 seconds' WHERE id=(SELECT id FROM durable_jobs WHERE org_id=$1 AND attempts<3 AND ((status='queued' AND available_at<=now()) OR (status='running' AND lease_until<=clock_timestamp())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,actor_id,entity_id,kind,fence,attempts").bind(org).fetch_optional(&mut *tx).await?;
            sqlx::query("UPDATE job_lanes SET last_claimed_at=now() WHERE org_id=$1").bind(org).execute(&mut *tx).await?;
            tx.commit().await?;
            let Some((id,actor_id,entity_id,kind,fence,attempt))=row else { return Ok(None); };
            Ok::<_,Error>(Some(Lease{id,org_id:org,actor_id,entity_id,kind:Kind::parse(&kind).ok_or(Error::Conflict)?,fence,attempt}))
        }.await.map_err(|_|kivo_jobs::Error::Unavailable)
    }
    async fn fail(&self, lease: &Lease, code: &'static str) -> Result<(), kivo_jobs::Error> {
        async {
            let mut tx=self.pool.begin().await?;
            events::lock(&mut tx,lease.org_id).await?;
            fence(&mut tx,lease).await?;
            sqlx::query("UPDATE durable_jobs SET status=CASE WHEN attempts=3 THEN 'dead' ELSE 'queued' END,available_at=now()+make_interval(secs=>attempts*2),lease_until=NULL,error_code=$2 WHERE id=$1").bind(lease.id).bind(code).execute(&mut *tx).await?;
            if lease.attempt==3 { super::imports::failed(&mut tx,lease,code).await?; }
            tx.commit().await?; Ok::<_,Error>(())
        }.await.map_err(|e|match e {Error::Conflict=>kivo_jobs::Error::Conflict,_=>kivo_jobs::Error::Unavailable})
    }
}
