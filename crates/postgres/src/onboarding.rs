use crate::{Postgres, error::Error, events, planning, tenancy};
use kivo_onboarding::{Enroll, Enrollment, PendingInvitation, Repository, Setup, Status};
use kivo_planning::Command;
use kivo_tenancy::{Actor, Permission, Role};
use uuid::Uuid;

impl Repository for Postgres {
    async fn status(&self, actor: Actor) -> Result<Status, kivo_onboarding::Error> {
        status(self, actor).await.map_err(Into::into)
    }
    async fn setup(
        &self,
        actor: Actor,
        input: Setup,
        key: Uuid,
    ) -> Result<Uuid, kivo_onboarding::Error> {
        input.validate()?;
        setup(self, actor, input, key).await.map_err(Into::into)
    }
    async fn enroll(
        &self,
        actor: Actor,
        org: Uuid,
        input: Enroll,
        key: Uuid,
    ) -> Result<(), kivo_onboarding::Error> {
        input.validate()?;
        enroll(self, actor, org, input, key)
            .await
            .map_err(Into::into)
    }
}
async fn status(db: &Postgres, actor: Actor) -> Result<Status, Error> {
    let mut tx = db.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let (email, email_verified): (String, bool) =
        sqlx::query_as("SELECT email,email_verified FROM users WHERE id=$1")
            .bind(actor.user_id)
            .fetch_one(&mut *tx)
            .await?;
    let mut invitations = Vec::new();
    if email_verified {
        let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
            "SELECT i.id,o.name,i.role FROM invitations i JOIN organizations o ON o.id=i.org_id
             JOIN memberships inviter ON inviter.org_id=i.org_id AND inviter.user_id=i.invited_by
             WHERE i.email=lower($1) AND i.accepted_by IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
             AND (inviter.role='owner' OR (inviter.role='admin' AND i.role IN ('planner','member','viewer')))
             AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id=i.org_id AND m.user_id=$2)
             ORDER BY i.created_at DESC,i.id LIMIT 100")
            .bind(&email).bind(actor.user_id).fetch_all(&mut *tx).await?;
        for (id, organization_name, role) in rows {
            invitations.push(PendingInvitation {
                id,
                organization_name,
                role: Role::parse(&role).ok_or(Error::Forbidden)?,
            });
        }
    }
    tx.commit().await?;
    Ok(Status {
        email,
        email_verified,
        invitations,
    })
}
async fn setup(db: &Postgres, actor: Actor, input: Setup, key: Uuid) -> Result<Uuid, Error> {
    let org = input.organization();
    let org_id = org.id;
    let mut tx = db.pool.begin().await?;
    events::lock(&mut tx, org_id).await?;
    tenancy::require_verified(&mut tx, actor).await?;
    let request = serde_json::json!({"setup": input});
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM organizations WHERE id=$1)")
        .bind(org_id)
        .fetch_one(&mut *tx)
        .await?;
    if exists {
        tenancy::require(&mut tx, actor, org_id, Permission::Administer).await?;
        if events::replay(&mut tx, org_id, actor.user_id, key, &request)
            .await?
            .is_some()
        {
            return Ok(org_id);
        }
        return Err(Error::Conflict);
    }
    sqlx::query("INSERT INTO organizations(id,name,timezone,currency) VALUES($1,$2,$3,$4)")
        .bind(org_id)
        .bind(&org.name)
        .bind(&org.timezone)
        .bind(&org.currency)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')")
        .bind(org_id)
        .bind(actor.user_id)
        .execute(&mut *tx)
        .await?;
    if let Setup::Personal { profile, .. } = &input {
        let person = profile.person(org_id, Uuid::new_v4());
        let id = person.id;
        planning::persist(&mut tx, &Command::Person(person)).await?;
        sqlx::query("INSERT INTO member_people(org_id,user_id,person_id) VALUES($1,$2,$3)")
            .bind(org_id)
            .bind(actor.user_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    events::record(&mut tx, org_id, actor.user_id, org_id, "onboarding.create").await?;
    events::receipt(
        &mut tx,
        org_id,
        actor.user_id,
        key,
        &request,
        &serde_json::json!({"orgId":org_id}),
    )
    .await?;
    tx.commit().await?;
    Ok(org_id)
}
async fn enroll(
    db: &Postgres,
    actor: Actor,
    org: Uuid,
    input: Enroll,
    key: Uuid,
) -> Result<(), Error> {
    let mut tx = db.pool.begin().await?;
    events::lock(&mut tx, org).await?;
    tenancy::require(&mut tx, actor, org, Permission::Administer).await?;
    let request = serde_json::json!({"enroll":input});
    if events::replay(&mut tx, org, actor.user_id, key, &request)
        .await?
        .is_some()
    {
        return Ok(());
    }
    let version: Option<i32> = sqlx::query_scalar(
        "SELECT version FROM memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE",
    )
    .bind(org)
    .bind(input.user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if version != Some(input.membership_version) {
        return Err(Error::Conflict);
    }
    let current: Option<Uuid> =
        sqlx::query_scalar("SELECT person_id FROM member_people WHERE org_id=$1 AND user_id=$2")
            .bind(org)
            .bind(input.user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let action = match input.enrollment {
        Enrollment::Unlink => {
            if current.is_none() {
                return Err(Error::Conflict);
            }
            sqlx::query("DELETE FROM member_people WHERE org_id=$1 AND user_id=$2")
                .bind(org)
                .bind(input.user_id)
                .execute(&mut *tx)
                .await?;
            "onboarding.unlink"
        }
        enrollment => {
            if current.is_some() {
                return Err(Error::Invalid(
                    "This member already has a scheduling profile",
                ));
            }
            let person_id = match enrollment {
                Enrollment::Create { profile } => {
                    let person = profile.person(org, Uuid::new_v4());
                    let id = person.id;
                    planning::persist(&mut tx, &Command::Person(person)).await?;
                    id
                }
                Enrollment::Link { person_id } => {
                    let exists: bool = sqlx::query_scalar(
                        "SELECT EXISTS(SELECT 1 FROM people WHERE org_id=$1 AND id=$2)",
                    )
                    .bind(org)
                    .bind(person_id)
                    .fetch_one(&mut *tx)
                    .await?;
                    if !exists {
                        return Err(Error::Conflict);
                    }
                    person_id
                }
                Enrollment::Unlink => return Err(Error::Conflict),
            };
            sqlx::query("INSERT INTO member_people(org_id,user_id,person_id) VALUES($1,$2,$3)")
                .bind(org)
                .bind(input.user_id)
                .bind(person_id)
                .execute(&mut *tx)
                .await?;
            "onboarding.enroll"
        }
    };
    sqlx::query("UPDATE memberships SET version=version+1 WHERE org_id=$1 AND user_id=$2")
        .bind(org)
        .bind(input.user_id)
        .execute(&mut *tx)
        .await?;
    events::record(&mut tx, org, actor.user_id, input.user_id, action).await?;
    events::receipt(
        &mut tx,
        org,
        actor.user_id,
        key,
        &request,
        &serde_json::Value::Null,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
