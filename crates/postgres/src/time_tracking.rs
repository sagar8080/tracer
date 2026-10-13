use crate::{Postgres, error::Error, events, tenancy};
use chrono::NaiveDate;
use kivo_tenancy::Actor;
use kivo_time_tracking::{
    Command, Decision, Entry, Repository, Sheet, SheetStatus, Snapshot, can_record, can_review,
    week,
};
use sqlx::{Postgres as Pg, Transaction};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
struct SheetRow {
    id: Uuid,
    user_id: Uuid,
    person_id: Uuid,
    person_name: String,
    week: NaiveDate,
    status: String,
    version: i32,
    review_note: String,
}
#[derive(sqlx::FromRow)]
struct EntryRow {
    id: Uuid,
    sheet_id: Uuid,
    project_id: Uuid,
    entry_date: NaiveDate,
    minutes: i32,
    billable: bool,
    note: String,
    version: i32,
}
impl From<EntryRow> for Entry {
    fn from(v: EntryRow) -> Self {
        Self {
            id: v.id,
            sheet_id: v.sheet_id,
            project_id: v.project_id,
            date: v.entry_date,
            minutes: v.minutes,
            billable: v.billable,
            note: v.note,
            version: v.version,
        }
    }
}
impl Repository for Postgres {
    async fn timesheets(
        &self,
        actor: Actor,
        org: Uuid,
        date: NaiveDate,
    ) -> Result<Snapshot, kivo_time_tracking::Error> {
        kivo_time_tracking::validate_week(date)?;
        read(self, actor, org, date).await.map_err(Into::into)
    }
    async fn track_time(
        &self,
        actor: Actor,
        org: Uuid,
        command: Command,
        key: Uuid,
    ) -> Result<(), kivo_time_tracking::Error> {
        command.validate()?;
        write(self, actor, org, command, key)
            .await
            .map_err(Into::into)
    }
}
pub(super) async fn linked_person(
    tx: &mut Transaction<'_, Pg>,
    actor: Actor,
    org: Uuid,
) -> Result<Option<Uuid>, Error> {
    Ok(
        sqlx::query_scalar("SELECT person_id FROM member_people WHERE org_id=$1 AND user_id=$2")
            .bind(org)
            .bind(actor.user_id)
            .fetch_optional(&mut **tx)
            .await?,
    )
}
async fn read(db: &Postgres, actor: Actor, org: Uuid, date: NaiveDate) -> Result<Snapshot, Error> {
    let mut tx = db.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    let role = tenancy::role(&mut tx, actor, org)
        .await?
        .ok_or(Error::Forbidden)?;
    let person_id = linked_person(&mut tx, actor, org).await?;
    let rows:Vec<SheetRow>=sqlx::query_as("SELECT s.id,s.user_id,s.person_id,p.name person_name,s.week,s.status,s.version,s.review_note FROM timesheets s JOIN people p ON p.org_id=s.org_id AND p.id=s.person_id WHERE s.org_id=$1 AND s.week=$2 AND (s.user_id=$3 OR $4) ORDER BY p.name,s.id")
        .bind(org).bind(date).bind(actor.user_id).bind(can_review(role)).fetch_all(&mut *tx).await?;
    let ids: Vec<_> = rows.iter().map(|r| r.id).collect();
    let entries: Vec<Entry> = sqlx::query_as::<_, EntryRow>(
        "SELECT * FROM time_entries WHERE org_id=$1 AND sheet_id=ANY($2) ORDER BY entry_date,id",
    )
    .bind(org)
    .bind(ids)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(Into::into)
    .collect();
    let mut own = None;
    let mut reviews = Vec::new();
    for r in rows {
        let sheet = Sheet {
            id: r.id,
            user_id: r.user_id,
            person_id: r.person_id,
            person_name: r.person_name,
            week: r.week,
            status: SheetStatus::parse(&r.status).ok_or(Error::Conflict)?,
            version: r.version,
            review_note: r.review_note,
            entries: entries
                .iter()
                .filter(|e| e.sheet_id == r.id)
                .cloned()
                .collect(),
        };
        if sheet.user_id == actor.user_id {
            own = Some(sheet);
        } else {
            reviews.push(sheet);
        }
    }
    tx.commit().await?;
    Ok(Snapshot {
        person_id,
        can_record: can_record(role),
        can_review: can_review(role),
        own,
        reviews,
    })
}
async fn own_sheet(
    tx: &mut Transaction<'_, Pg>,
    actor: Actor,
    org: Uuid,
    person: Uuid,
    date: NaiveDate,
    expected: i32,
) -> Result<(Uuid, String), Error> {
    let row:Option<(Uuid,Uuid,String,i32)>=sqlx::query_as("SELECT id,person_id,status,version FROM timesheets WHERE org_id=$1 AND user_id=$2 AND week=$3 FOR UPDATE").bind(org).bind(actor.user_id).bind(date).fetch_optional(&mut **tx).await?;
    if let Some((id, linked, status, version)) = row {
        if linked != person {
            return Err(Error::Invalid(
                "Your scheduling profile changed. Ask an administrator to review this week's time",
            ));
        }
        if version != expected {
            return Err(Error::Conflict);
        }
        Ok((id, status))
    } else {
        if expected != 0 {
            return Err(Error::Conflict);
        }
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO timesheets(id,org_id,user_id,person_id,week) VALUES($1,$2,$3,$4,$5)",
        )
        .bind(id)
        .bind(org)
        .bind(actor.user_id)
        .bind(person)
        .bind(date)
        .execute(&mut **tx)
        .await?;
        Ok((id, "draft".into()))
    }
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
    let reviewing = matches!(command, Command::Review { .. });
    if (reviewing && !can_review(role)) || (!reviewing && !can_record(role)) {
        return Err(Error::Forbidden);
    }
    let request = serde_json::json!({"time":command});
    // Current authority is always checked before a saved receipt is returned.
    let person = if reviewing {
        None
    } else {
        Some(
            linked_person(&mut tx, actor, org)
                .await?
                .ok_or(Error::Invalid(
                    "Ask an administrator to link your scheduling profile before recording time",
                ))?,
        )
    };
    if events::replay(&mut tx, org, actor.user_id, key, &request)
        .await?
        .is_some()
    {
        return Ok(());
    }
    let (entity, action) = match command {
        Command::Review {
            id,
            version,
            decision,
            note,
        } => {
            let row: Option<(String, i32)> = sqlx::query_as(
                "SELECT status,version FROM timesheets WHERE id=$1 AND org_id=$2 FOR UPDATE",
            )
            .bind(id)
            .bind(org)
            .fetch_optional(&mut *tx)
            .await?;
            let (status, current) = row.ok_or(Error::Conflict)?;
            if current != version {
                return Err(Error::Conflict);
            }
            if status != "submitted" {
                return Err(Error::Invalid("Only submitted timesheets can be reviewed"));
            }
            let next = match decision {
                Decision::Approve => "approved",
                Decision::Return => "draft",
            };
            sqlx::query("UPDATE timesheets SET status=$3,version=version+1,reviewed_by=$4,review_note=$5,reviewed_at=now() WHERE id=$1 AND org_id=$2").bind(id).bind(org).bind(next).bind(actor.user_id).bind(note.trim()).execute(&mut *tx).await?;
            (
                id,
                if next == "approved" {
                    "timesheet.approve"
                } else {
                    "timesheet.return"
                },
            )
        }
        command => {
            let person = person.ok_or(Error::Forbidden)?;
            let (date, expected) = match &command {
                Command::Save {
                    date,
                    sheet_version,
                    ..
                } => (
                    week(*date).map_err(|_| Error::Invalid("Choose a supported calendar date"))?,
                    *sheet_version,
                ),
                Command::Delete {
                    week,
                    sheet_version,
                    ..
                } => (*week, *sheet_version),
                Command::Submit { week, version } | Command::Withdraw { week, version } => {
                    (*week, *version)
                }
                Command::Review { .. } => return Err(Error::Forbidden),
            };
            let (sheet, status) = own_sheet(&mut tx, actor, org, person, date, expected).await?;
            let action = match command {
                Command::Save {
                    id,
                    date: day,
                    project_id,
                    minutes,
                    billable,
                    note,
                    version,
                    ..
                } => {
                    if status != "draft" {
                        return Err(Error::Invalid(
                            "Submitted and approved timesheets are locked",
                        ));
                    }
                    let total:i64=sqlx::query_scalar("SELECT COALESCE(sum(minutes),0)::bigint FROM time_entries WHERE org_id=$1 AND sheet_id=$2 AND entry_date=$3 AND id<>$4").bind(org).bind(sheet).bind(day).bind(id).fetch_one(&mut *tx).await?;
                    if total + i64::from(minutes) > 1440 {
                        return Err(Error::Invalid(
                            "Recorded time cannot exceed 24 hours in one day",
                        ));
                    }
                    let project: Option<String> = sqlx::query_scalar(
                        "SELECT status FROM projects WHERE org_id=$1 AND id=$2 FOR SHARE",
                    )
                    .bind(org)
                    .bind(project_id)
                    .fetch_optional(&mut *tx)
                    .await?;
                    if project.is_none() {
                        return Err(Error::Invalid("Choose a project in this workspace"));
                    }
                    let n = if version == 1 {
                        sqlx::query("INSERT INTO time_entries(id,org_id,sheet_id,project_id,entry_date,minutes,billable,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING").bind(id).bind(org).bind(sheet).bind(project_id).bind(day).bind(minutes).bind(billable).bind(note.trim()).execute(&mut *tx).await?.rows_affected()
                    } else {
                        sqlx::query("UPDATE time_entries SET project_id=$4,entry_date=$5,minutes=$6,billable=$7,note=$8,version=$9 WHERE id=$1 AND org_id=$2 AND sheet_id=$3 AND version=$9-1").bind(id).bind(org).bind(sheet).bind(project_id).bind(day).bind(minutes).bind(billable).bind(note.trim()).bind(version).execute(&mut *tx).await?.rows_affected()
                    };
                    if n != 1 {
                        return Err(Error::Conflict);
                    }
                    "time.save"
                }
                Command::Delete { id, version, .. } => {
                    if status != "draft" {
                        return Err(Error::Invalid(
                            "Submitted and approved timesheets are locked",
                        ));
                    }
                    let n=sqlx::query("DELETE FROM time_entries WHERE id=$1 AND org_id=$2 AND sheet_id=$3 AND version=$4").bind(id).bind(org).bind(sheet).bind(version).execute(&mut *tx).await?.rows_affected();
                    if n != 1 {
                        return Err(Error::Conflict);
                    }
                    "time.delete"
                }
                Command::Submit { .. } => {
                    if status != "draft" {
                        return Err(Error::Invalid("Only draft timesheets can be submitted"));
                    }
                    let count: i64 = sqlx::query_scalar(
                        "SELECT count(*) FROM time_entries WHERE org_id=$1 AND sheet_id=$2",
                    )
                    .bind(org)
                    .bind(sheet)
                    .fetch_one(&mut *tx)
                    .await?;
                    if count == 0 {
                        return Err(Error::Invalid("Record some time before submitting"));
                    }
                    sqlx::query("UPDATE timesheets SET status='submitted',submitted_at=now(),review_note='',reviewed_by=NULL,reviewed_at=NULL WHERE id=$1 AND org_id=$2").bind(sheet).bind(org).execute(&mut *tx).await?;
                    "timesheet.submit"
                }
                Command::Withdraw { .. } => {
                    if status != "submitted" {
                        return Err(Error::Invalid("Only submitted timesheets can be withdrawn"));
                    }
                    sqlx::query("UPDATE timesheets SET status='draft' WHERE id=$1 AND org_id=$2")
                        .bind(sheet)
                        .bind(org)
                        .execute(&mut *tx)
                        .await?;
                    "timesheet.withdraw"
                }
                Command::Review { .. } => return Err(Error::Forbidden),
            };
            sqlx::query("UPDATE timesheets SET version=version+1 WHERE id=$1 AND org_id=$2")
                .bind(sheet)
                .bind(org)
                .execute(&mut *tx)
                .await?;
            (sheet, action)
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
