use crate::{Postgres, error::Error, events, tenancy};
use chrono::{DateTime, Utc};
use kivo_tenancy::{
    Actor, Invitation, Invited, Member, Permission, Repository, Role, Team, TeamCommand,
};
use serde_json::Value;
use uuid::Uuid;
impl Repository for Postgres {
    async fn team(&self, actor: Actor, org: Uuid) -> Result<Team, kivo_tenancy::Error> {
        team(self, actor, org).await.map_err(Into::into)
    }
    async fn manage(
        &self,
        actor: Actor,
        org: Uuid,
        command: TeamCommand,
        request: Uuid,
    ) -> Result<Option<Invited>, kivo_tenancy::Error> {
        command.validate()?;
        manage(self, actor, org, command, request)
            .await
            .map_err(Into::into)
    }
    async fn accept_invitation(&self, actor: Actor, id: Uuid) -> Result<Uuid, kivo_tenancy::Error> {
        accept_id(self, actor, id).await.map_err(Into::into)
    }
    async fn accept(&self, actor: Actor, token: &str) -> Result<Uuid, kivo_tenancy::Error> {
        accept(self, actor, token).await.map_err(Into::into)
    }
}
async fn team(db: &Postgres, actor: Actor, org: Uuid) -> Result<Team, Error> {
    let mut tx = db.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    tenancy::require(&mut tx, actor, org, Permission::Administer).await?;
    let rows:Vec<(Uuid,String,String,i32,Option<Uuid>)>=sqlx::query_as("SELECT u.id,u.email,m.role,m.version,p.person_id FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN member_people p ON p.org_id=m.org_id AND p.user_id=m.user_id WHERE m.org_id=$1 ORDER BY lower(u.email),u.id").bind(org).fetch_all(&mut *tx).await?;
    let members = rows
        .into_iter()
        .map(|(user_id, email, role, version, person_id)| {
            Ok(Member {
                user_id,
                email,
                role: Role::parse(&role).ok_or(Error::Forbidden)?,
                version,
                person_id,
            })
        })
        .collect::<Result<_, Error>>()?;
    let rows:Vec<(Uuid,String,String,DateTime<Utc>)>=sqlx::query_as("SELECT id,email,role,expires_at FROM invitations WHERE org_id=$1 AND accepted_by IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at,id").bind(org).fetch_all(&mut *tx).await?;
    let invitations = rows
        .into_iter()
        .map(|(id, email, role, expires_at)| {
            Ok(Invitation {
                id,
                email,
                role: Role::parse(&role).ok_or(Error::Forbidden)?,
                expires_at,
            })
        })
        .collect::<Result<_, Error>>()?;
    tx.commit().await?;
    Ok(Team {
        members,
        invitations,
    })
}
async fn manage(
    db: &Postgres,
    actor: Actor,
    org: Uuid,
    command: TeamCommand,
    key: Uuid,
) -> Result<Option<Invited>, Error> {
    let mut tx = db.pool.begin().await?;
    events::lock(&mut tx, org).await?;
    let role = tenancy::role(&mut tx, actor, org)
        .await?
        .filter(|r| r.permits(Permission::Administer))
        .ok_or(Error::Forbidden)?;
    if let TeamCommand::Invite { role: target, .. } | TeamCommand::ChangeRole { role: target, .. } =
        &command
        && !role.can_manage(*target)
    {
        return Err(Error::Forbidden);
    }
    let request = serde_json::json!({"team":command});
    if let Some(result) = events::replay(&mut tx, org, actor.user_id, key, &request).await? {
        return if result.is_null() {
            Ok(None)
        } else {
            Ok(Some(Invited {
                invitation: serde_json::from_value(result).map_err(|_| Error::Conflict)?,
                token: None,
            }))
        };
    }
    let (entity, action, result) = match command {
        TeamCommand::Invite {
            email,
            role: target,
        } => {
            let email = email.to_lowercase();
            let id = Uuid::new_v4();
            let token = events::secret();
            let expires_at = Utc::now() + chrono::Duration::days(7);
            sqlx::query("INSERT INTO invitations(id,org_id,email,role,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(id).bind(org).bind(&email).bind(target.as_str()).bind(events::hash(&token)).bind(actor.user_id).bind(expires_at).execute(&mut *tx).await?;
            (
                id,
                "invitation.create",
                Some(Invited {
                    invitation: Invitation {
                        id,
                        email,
                        role: target,
                        expires_at,
                    },
                    token: Some(token),
                }),
            )
        }
        TeamCommand::Revoke { id } => {
            let target:Option<String>=sqlx::query_scalar("SELECT role FROM invitations WHERE id=$1 AND org_id=$2 AND accepted_by IS NULL AND revoked_at IS NULL FOR UPDATE").bind(id).bind(org).fetch_optional(&mut *tx).await?;
            let target = target
                .as_deref()
                .and_then(Role::parse)
                .ok_or(Error::Conflict)?;
            if !role.can_manage(target) {
                return Err(Error::Forbidden);
            }
            sqlx::query("UPDATE invitations SET revoked_at=now() WHERE id=$1 AND org_id=$2")
                .bind(id)
                .bind(org)
                .execute(&mut *tx)
                .await?;
            (id, "invitation.revoke", None)
        }
        TeamCommand::ChangeRole {
            user_id,
            role: target,
            version,
        } => {
            check_member(&mut tx, org, user_id, role, version, Some(target)).await?;
            sqlx::query(
                "UPDATE memberships SET role=$3,version=version+1 WHERE org_id=$1 AND user_id=$2",
            )
            .bind(org)
            .bind(user_id)
            .bind(target.as_str())
            .execute(&mut *tx)
            .await?;
            (user_id, "membership.role", None)
        }
        TeamCommand::Remove { user_id, version } => {
            check_member(&mut tx, org, user_id, role, version, None).await?;
            sqlx::query("DELETE FROM memberships WHERE org_id=$1 AND user_id=$2")
                .bind(org)
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
            (user_id, "membership.remove", None)
        }
    };
    events::record(&mut tx, org, actor.user_id, entity, action).await?;
    let saved = result
        .as_ref()
        .map(|v| serde_json::json!(v.invitation))
        .unwrap_or(Value::Null);
    events::receipt(&mut tx, org, actor.user_id, key, &request, &saved).await?;
    tx.commit().await?;
    Ok(result)
}
async fn check_member(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    org: Uuid,
    user: Uuid,
    actor_role: Role,
    version: i32,
    new_role: Option<Role>,
) -> Result<(), Error> {
    let current: Option<(String, i32)> = sqlx::query_as(
        "SELECT role,version FROM memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE",
    )
    .bind(org)
    .bind(user)
    .fetch_optional(&mut **tx)
    .await?;
    let (current, stored) = current.ok_or(Error::Conflict)?;
    let current = Role::parse(&current).ok_or(Error::Forbidden)?;
    if !actor_role.can_manage(current) {
        return Err(Error::Forbidden);
    }
    if stored != version {
        return Err(Error::Conflict);
    }
    if current == Role::Owner && new_role != Some(Role::Owner) {
        let owners: i64 =
            sqlx::query_scalar("SELECT count(*) FROM memberships WHERE org_id=$1 AND role='owner'")
                .bind(org)
                .fetch_one(&mut **tx)
                .await?;
        if !current.can_relinquish_ownership(new_role, owners) {
            return Err(Error::Invalid(
                "Assign another owner before removing the last owner",
            ));
        }
    }
    Ok(())
}
async fn accept(db: &Postgres, actor: Actor, token: &str) -> Result<Uuid, Error> {
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::Invalid("This invitation is invalid or expired"));
    }
    let hash = events::hash(token);
    let id: Uuid = sqlx::query_scalar("SELECT id FROM invitations WHERE token_hash=$1")
        .bind(&hash)
        .fetch_optional(&db.pool)
        .await?
        .ok_or(Error::Invalid("This invitation is invalid or expired"))?;
    accept_id(db, actor, id).await
}
async fn accept_id(db: &Postgres, actor: Actor, invite_id: Uuid) -> Result<Uuid, Error> {
    let org: Uuid = sqlx::query_scalar("SELECT org_id FROM invitations WHERE id=$1")
        .bind(invite_id)
        .fetch_optional(&db.pool)
        .await?
        .ok_or(Error::Invalid("This invitation is invalid or expired"))?;
    let mut tx = db.pool.begin().await?;
    events::lock(&mut tx, org).await?;
    let (email, verified): (String, bool) =
        sqlx::query_as("SELECT email,email_verified FROM users WHERE id=$1 FOR SHARE")
            .bind(actor.user_id)
            .fetch_one(&mut *tx)
            .await?;
    if !verified {
        return Err(Error::Invalid(
            "Verify your email address before accepting an invitation",
        ));
    }
    type InviteRow = (
        Uuid,
        String,
        String,
        Uuid,
        DateTime<Utc>,
        Option<Uuid>,
        Option<DateTime<Utc>>,
    );
    let (id,invited_email,invited_role,inviter,expires,accepted,revoked):InviteRow=sqlx::query_as("SELECT id,email,role,invited_by,expires_at,accepted_by,revoked_at FROM invitations WHERE id=$1 AND org_id=$2 FOR UPDATE").bind(invite_id).bind(org).fetch_one(&mut *tx).await?;
    if invited_email != email.to_lowercase() {
        return Err(Error::Forbidden);
    }
    if let Some(accepted) = accepted {
        if accepted == actor.user_id && tenancy::role(&mut tx, actor, org).await?.is_some() {
            return Ok(org);
        }
        return Err(Error::Invalid("This invitation has already been used"));
    }
    if revoked.is_some() || expires <= Utc::now() {
        return Err(Error::Invalid("This invitation is invalid or expired"));
    }
    let target = Role::parse(&invited_role).ok_or(Error::Forbidden)?;
    let inviter_role = tenancy::role(&mut tx, Actor { user_id: inviter }, org).await?;
    if !inviter_role.is_some_and(|r| r.can_manage(target)) {
        return Err(Error::Invalid(
            "Ask a workspace administrator for a new invitation",
        ));
    }
    let n = sqlx::query(
        "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    )
    .bind(org)
    .bind(actor.user_id)
    .bind(target.as_str())
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(Error::Invalid("You already belong to this workspace"));
    }
    sqlx::query("UPDATE invitations SET accepted_by=$2 WHERE id=$1")
        .bind(id)
        .bind(actor.user_id)
        .execute(&mut *tx)
        .await?;
    events::record(
        &mut tx,
        org,
        actor.user_id,
        actor.user_id,
        "membership.join",
    )
    .await?;
    tx.commit().await?;
    Ok(org)
}
