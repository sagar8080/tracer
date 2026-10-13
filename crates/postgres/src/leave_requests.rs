use crate::{Postgres, error::Error, events, planning, tenancy, time_tracking::linked_person};
use kivo_leave_requests::{
    Command, Decision, Repository, Request, Snapshot, can_request, can_review,
};
use kivo_planning::{Absence, Command as PlanningCommand};
use kivo_tenancy::Actor;
use uuid::Uuid;
#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    user_id: Uuid,
    person_id: Uuid,
    person_name: String,
    title: String,
    start_date: chrono::NaiveDate,
    end_date: chrono::NaiveDate,
    daily_minutes: Option<i32>,
    status: String,
    version: i32,
    review_note: String,
    absence_id: Option<Uuid>,
}
impl From<Row> for Request {
    fn from(r: Row) -> Self {
        Self {
            id: r.id,
            user_id: r.user_id,
            person_id: r.person_id,
            person_name: r.person_name,
            title: r.title,
            start: r.start_date,
            end: r.end_date,
            daily_minutes: r.daily_minutes,
            status: r.status,
            version: r.version,
            review_note: r.review_note,
            absence_id: r.absence_id,
        }
    }
}
impl Repository for Postgres {
    async fn leave(&self, actor: Actor, org: Uuid) -> Result<Snapshot, kivo_leave_requests::Error> {
        read(self, actor, org).await.map_err(Into::into)
    }
    async fn request_leave(
        &self,
        actor: Actor,
        org: Uuid,
        command: Command,
        key: Uuid,
    ) -> Result<(), kivo_leave_requests::Error> {
        command.validate()?;
        write(self, actor, org, command, key)
            .await
            .map_err(Into::into)
    }
}
async fn read(db: &Postgres, actor: Actor, org: Uuid) -> Result<Snapshot, Error> {
    let mut tx = db.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    let role = tenancy::role(&mut tx, actor, org)
        .await?
        .ok_or(Error::Forbidden)?;
    let person_id = linked_person(&mut tx, actor, org).await?;
    let rows:Vec<Row>=sqlx::query_as("SELECT r.id,r.user_id,r.person_id,p.name person_name,r.title,r.start_date,r.end_date,r.daily_minutes,r.status,r.version,r.review_note,r.absence_id FROM leave_requests r JOIN people p ON p.org_id=r.org_id AND p.id=r.person_id WHERE r.org_id=$1 AND (r.user_id=$2 OR $3) ORDER BY r.created_at DESC,r.id")
 .bind(org).bind(actor.user_id).bind(can_review(role)).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Snapshot {
        person_id,
        can_request: can_request(role),
        can_review: can_review(role),
        requests: rows.into_iter().map(Into::into).collect(),
    })
}
async fn write(
    db: &Postgres,
    actor: Actor,
    org: Uuid,
    command: Command,
    key: Uuid,
) -> Result<(), Error> {
    let mut tx = db.pool.begin().await?;
    events::lock(&mut tx, org).await?;
    let role = tenancy::role(&mut tx, actor, org)
        .await?
        .ok_or(Error::Forbidden)?;
    if !can_request(role) {
        return Err(Error::Forbidden);
    }
    if matches!(command, Command::Review { .. }) && !can_review(role) {
        return Err(Error::Forbidden);
    }
    let request = serde_json::json!({"leave":command});
    if events::replay(&mut tx, org, actor.user_id, key, &request)
        .await?
        .is_some()
    {
        return Ok(());
    }
    let (entity, action) = match command {
        Command::Request {
            id,
            title,
            start,
            end,
            daily_minutes,
        } => {
            let person = linked_person(&mut tx, actor, org)
                .await?
                .ok_or(Error::Invalid(
                    "Ask an administrator to link your scheduling profile before requesting leave",
                ))?;
            let n=sqlx::query("INSERT INTO leave_requests(id,org_id,user_id,person_id,title,start_date,end_date,daily_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING")
   .bind(id).bind(org).bind(actor.user_id).bind(person).bind(title.trim()).bind(start).bind(end).bind(daily_minutes).execute(&mut *tx).await?.rows_affected();
            if n != 1 {
                return Err(Error::Conflict);
            }
            (id, "leave.request")
        }
        command => {
            let (id, version) = match &command {
                Command::Cancel { id, version } | Command::Review { id, version, .. } => {
                    (*id, *version)
                }
                Command::Request { .. } => return Err(Error::Conflict),
            };
            let row:Option<Row>=sqlx::query_as("SELECT r.id,r.user_id,r.person_id,p.name person_name,r.title,r.start_date,r.end_date,r.daily_minutes,r.status,r.version,r.review_note,r.absence_id FROM leave_requests r JOIN people p ON p.org_id=r.org_id AND p.id=r.person_id WHERE r.id=$1 AND r.org_id=$2 FOR UPDATE OF r")
   .bind(id).bind(org).fetch_optional(&mut *tx).await?;
            let row = row.ok_or(Error::Conflict)?;
            if row.user_id != actor.user_id && !can_review(role) {
                return Err(Error::Forbidden);
            }
            if row.version != version {
                return Err(Error::Conflict);
            }
            match command {
                Command::Review { decision, note, .. } => {
                    if row.status != "pending" {
                        return Err(Error::Invalid("Only pending leave can be reviewed"));
                    }
                    let (status, absence) = match decision {
                        Decision::Approve => {
                            let absence = Uuid::new_v4();
                            planning::persist(
                                &mut tx,
                                &PlanningCommand::Absence(Absence {
                                    id: absence,
                                    org_id: org,
                                    person_id: Some(row.person_id),
                                    category: "timeOff".into(),
                                    title: row.title,
                                    start: row.start_date,
                                    end: row.end_date,
                                    daily_minutes: row.daily_minutes,
                                    version: 1,
                                }),
                            )
                            .await?;
                            ("approved", Some(absence))
                        }
                        Decision::Reject => ("rejected", None),
                    };
                    sqlx::query("UPDATE leave_requests SET status=$3,version=version+1,reviewed_by=$4,review_note=$5,absence_id=$6 WHERE id=$1 AND org_id=$2")
     .bind(id).bind(org).bind(status).bind(actor.user_id).bind(note.trim()).bind(absence).execute(&mut *tx).await?;
                    (
                        id,
                        if status == "approved" {
                            "leave.approve"
                        } else {
                            "leave.reject"
                        },
                    )
                }
                Command::Cancel { .. } => {
                    if row.status != "pending" && row.status != "approved" {
                        return Err(Error::Invalid(
                            "Only pending or approved leave can be cancelled",
                        ));
                    }
                    if row.status == "approved" && !can_review(role) {
                        return Err(Error::Forbidden);
                    }
                    sqlx::query("UPDATE leave_requests SET status='cancelled',version=version+1 WHERE id=$1 AND org_id=$2").bind(id).bind(org).execute(&mut *tx).await?;
                    if let Some(absence) = row.absence_id {
                        sqlx::query("DELETE FROM absences WHERE id=$1 AND org_id=$2")
                            .bind(absence)
                            .bind(org)
                            .execute(&mut *tx)
                            .await?;
                    }
                    (id, "leave.cancel")
                }
                Command::Request { .. } => return Err(Error::Conflict),
            }
        }
    };
    events::record(&mut tx, org, actor.user_id, entity, action).await?;
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
