use crate::{error::Error, events, rows::*, tenancy};
use kivo_planning::*;
use kivo_tenancy::{Access, Actor, Permission, Role};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

async fn read(pool: &PgPool, user: Uuid) -> Result<Workspace, Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let organizations=sqlx::query_as::<_,OrganizationRow>("SELECT o.id,o.name,o.timezone,o.currency,o.version FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=$1 ORDER BY o.created_at,o.id").bind(user).fetch_all(&mut *tx).await?;
    let memberships:Vec<(Uuid,String,i64)>=sqlx::query_as("SELECT m.org_id,m.role,o.revision FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1").bind(user).fetch_all(&mut *tx).await?;
    let access: Vec<Access> = memberships
        .into_iter()
        .map(|(org_id, role, revision)| {
            Ok(Access {
                org_id,
                role: Role::parse(&role).ok_or(Error::Forbidden)?,
                revision,
            })
        })
        .collect::<Result<_, Error>>()?;
    let finance = |org: Uuid| {
        access
            .iter()
            .any(|a| a.org_id == org && a.role.permits(Permission::Finance))
    };
    let ids: Vec<_> = organizations.iter().map(|o| o.id).collect();
    let people = sqlx::query_as::<_, PersonRow>(
        "SELECT * FROM people WHERE org_id=ANY($1) ORDER BY name,id",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    let projects = sqlx::query_as::<_, ProjectRow>(
        "SELECT * FROM projects WHERE org_id=ANY($1) ORDER BY name,id",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    let assignments = sqlx::query_as::<_, AssignmentRow>(
        "SELECT * FROM assignments WHERE org_id=ANY($1) ORDER BY start_date,id",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    let calendars = sqlx::query_as::<_, WorkingCalendarRow>(
        "SELECT * FROM working_calendars WHERE org_id=ANY($1) ORDER BY effective_from,id",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    let absences = sqlx::query_as::<_, AbsenceRow>(
        "SELECT * FROM absences WHERE org_id=ANY($1) ORDER BY start_date,id",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let people = people
        .into_iter()
        .map(|row| {
            let mut p: Person = row.into();
            if !finance(p.org_id) {
                p.cost_rate = None;
            }
            p
        })
        .collect();
    let projects = projects
        .into_iter()
        .map(|row| {
            let mut p: Project = row.into();
            if !finance(p.org_id) {
                p.bill_rate = None;
            }
            p
        })
        .collect();
    Ok(Workspace {
        access,
        actor_id: Some(user),
        organizations: organizations.into_iter().map(Into::into).collect(),
        people,
        projects,
        assignments: assignments.into_iter().map(Into::into).collect(),
        calendars: calendars.into_iter().map(Into::into).collect(),
        absences: absences.into_iter().map(Into::into).collect(),
    })
}
async fn execute(pool: &PgPool, user: Uuid, c: Command, key: Option<Uuid>) -> Result<(), Error> {
    c.validate().map_err(Error::Invalid)?;
    let mut tx = pool.begin().await?;
    events::lock(&mut tx, c.org_id()).await?;
    let request = serde_json::to_value(&c).map_err(|_| Error::Invalid("Invalid command"))?;
    // Organization first, membership second: all business writes use this order.
    let role = tenancy::role(&mut tx, Actor { user_id: user }, c.org_id()).await?;
    let mut created_org = false;
    if let Command::Organization(v) = &c
        && role.is_none()
    {
        if v.version != 1 {
            return Err(Error::Conflict);
        }
        let n=sqlx::query("INSERT INTO organizations(id,name,timezone,currency) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING").bind(v.id).bind(&v.name).bind(&v.timezone).bind(&v.currency).execute(&mut *tx).await?.rows_affected();
        if n == 0 {
            return Err(Error::Forbidden);
        }
        sqlx::query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')")
            .bind(v.id)
            .bind(user)
            .execute(&mut *tx)
            .await?;
        created_org = true;
    }
    if !created_org {
        let category: Option<String> = if let Command::DeleteAbsence { id, org_id, .. } = &c {
            sqlx::query_scalar("SELECT category FROM absences WHERE id=$1 AND org_id=$2 FOR UPDATE")
                .bind(id)
                .bind(org_id)
                .fetch_optional(&mut *tx)
                .await?
        } else {
            None
        };
        let allowed = role.is_some_and(|role| role.permits(c.permission(category.as_deref())));
        if !allowed {
            return Err(Error::Forbidden);
        }
        let finance = role.is_some_and(|r| r.permits(Permission::Finance));
        if !finance
            && (matches!(&c, Command::Person(v) if v.cost_rate.is_some())
                || matches!(&c,Command::Project(v) if v.bill_rate.is_some()))
        {
            return Err(Error::Forbidden);
        }
        if let Some(key) = key
            && events::replay(&mut tx, c.org_id(), user, key, &request)
                .await?
                .is_some()
        {
            return Ok(());
        }
        persist(&mut tx, &c).await?;
    }
    events::record(&mut tx, c.org_id(), user, c.entity_id(), c.action()).await?;
    if let Some(key) = key {
        events::receipt(
            &mut tx,
            c.org_id(),
            user,
            key,
            &request,
            &serde_json::Value::Null,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
async fn persist(tx: &mut Transaction<'_, Postgres>, c: &Command) -> Result<(), Error> {
    let rows=match c {
 Command::Organization(v)=>sqlx::query("UPDATE organizations SET name=$2,timezone=$3,currency=$4,version=$5 WHERE id=$1 AND version=$5-1").bind(v.id).bind(&v.name).bind(&v.timezone).bind(&v.currency).bind(v.version).execute(&mut **tx).await?.rows_affected(),
 Command::Person(v)=>{
  if v.version==1 {
   sqlx::query("INSERT INTO people(id,org_id,name,role,team,daily_minutes,cost_rate,color) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,0),$8) ON CONFLICT DO NOTHING").bind(v.id).bind(v.org_id).bind(&v.name).bind(&v.role).bind(&v.team).bind(v.daily_minutes).bind(v.cost_rate).bind(&v.color).execute(&mut **tx).await?.rows_affected()
  } else {
   sqlx::query("UPDATE people SET name=$3,role=$4,team=$5,daily_minutes=$6,cost_rate=COALESCE($7,cost_rate),color=$8,version=$9 WHERE id=$1 AND org_id=$2 AND version=$9-1").bind(v.id).bind(v.org_id).bind(&v.name).bind(&v.role).bind(&v.team).bind(v.daily_minutes).bind(v.cost_rate).bind(&v.color).bind(v.version).execute(&mut **tx).await?.rows_affected()
  }
 },
 Command::Project(v)=>{
  if v.version==1 {
   sqlx::query("INSERT INTO projects(id,org_id,name,client,color,budget_minutes,bill_rate,status) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,0),$8) ON CONFLICT DO NOTHING").bind(v.id).bind(v.org_id).bind(&v.name).bind(&v.client).bind(&v.color).bind(v.budget_minutes).bind(v.bill_rate).bind(&v.status).execute(&mut **tx).await?.rows_affected()
  } else {
   sqlx::query("UPDATE projects SET name=$3,client=$4,color=$5,budget_minutes=$6,bill_rate=COALESCE($7,bill_rate),status=$8,version=$9 WHERE id=$1 AND org_id=$2 AND version=$9-1").bind(v.id).bind(v.org_id).bind(&v.name).bind(&v.client).bind(&v.color).bind(v.budget_minutes).bind(v.bill_rate).bind(&v.status).bind(v.version).execute(&mut **tx).await?.rows_affected()
  }
 },
 Command::Calendar(v)=>{
  // Calendar writes and allocation validation serialize on this person, including first inserts.
  lock_person(tx, v.org_id, v.person_id).await?;
  if v.version == 1 {
    sqlx::query("INSERT INTO working_calendars(id,org_id,person_id,effective_from,weekly_minutes,version) VALUES($1,$2,$3,$4,$5,1) ON CONFLICT DO NOTHING").bind(v.id).bind(v.org_id).bind(v.person_id).bind(v.effective_from).bind(&v.weekly_minutes).execute(&mut **tx).await?.rows_affected()
  } else {
    sqlx::query("UPDATE working_calendars SET effective_from=$4,weekly_minutes=$5,version=$6 WHERE id=$1 AND org_id=$2 AND person_id=$3 AND version=$6-1").bind(v.id).bind(v.org_id).bind(v.person_id).bind(v.effective_from).bind(&v.weekly_minutes).bind(v.version).execute(&mut **tx).await?.rows_affected()
  }
 },
 Command::DeleteCalendar{id,org_id,version}=>{
  let person:Option<Uuid>=sqlx::query_scalar("SELECT person_id FROM working_calendars WHERE id=$1 AND org_id=$2").bind(id).bind(org_id).fetch_optional(&mut **tx).await?;
  if let Some(person) = person { lock_person(tx, *org_id, person).await?; }
  sqlx::query("DELETE FROM working_calendars WHERE id=$1 AND org_id=$2 AND version=$3").bind(id).bind(org_id).bind(version).execute(&mut **tx).await?.rows_affected()
 },
 Command::Absence(v)=>{
  if v.version == 1 {
    sqlx::query("INSERT INTO absences(id,org_id,person_id,category,title,start_date,end_date,daily_minutes,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1) ON CONFLICT DO NOTHING").bind(v.id).bind(v.org_id).bind(v.person_id).bind(&v.category).bind(&v.title).bind(v.start).bind(v.end).bind(v.daily_minutes).execute(&mut **tx).await?.rows_affected()
  } else {
    sqlx::query("UPDATE absences SET person_id=$3,title=$5,start_date=$6,end_date=$7,daily_minutes=$8,version=$9 WHERE id=$1 AND org_id=$2 AND category=$4 AND version=$9-1").bind(v.id).bind(v.org_id).bind(v.person_id).bind(&v.category).bind(&v.title).bind(v.start).bind(v.end).bind(v.daily_minutes).bind(v.version).execute(&mut **tx).await?.rows_affected()
  }
 },
 Command::DeleteAbsence{id,org_id,version}=>sqlx::query("DELETE FROM absences WHERE id=$1 AND org_id=$2 AND version=$3").bind(id).bind(org_id).bind(version).execute(&mut **tx).await?.rows_affected(),
 Command::Assignment(v)=>{
  lock_person(tx, v.org_id, v.person_id).await?;
  let calendars = sqlx::query_as::<_, WorkingCalendarRow>("SELECT * FROM working_calendars WHERE org_id=$1 AND person_id=$2").bind(v.org_id).bind(v.person_id).fetch_all(&mut **tx).await?;
  v.validate_calendar(&calendars.into_iter().map(Into::into).collect::<Vec<_>>()).map_err(Error::Invalid)?;

  let status:Option<String>=sqlx::query_scalar("SELECT status FROM projects WHERE org_id=$1 AND id=$2 FOR SHARE").bind(v.org_id).bind(v.project_id).fetch_optional(&mut **tx).await?;
  Project::validate_allocation_status(status.as_deref()).map_err(Error::Invalid)?;
  if v.version==1 {
   sqlx::query("INSERT INTO assignments(id,org_id,person_id,project_id,title,start_date,end_date,daily_minutes,status,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1) ON CONFLICT DO NOTHING").bind(v.id).bind(v.org_id).bind(v.person_id).bind(v.project_id).bind(&v.title).bind(v.start).bind(v.end).bind(v.daily_minutes).bind(&v.status).execute(&mut **tx).await?.rows_affected()
  }else{
   sqlx::query("UPDATE assignments SET person_id=$3,project_id=$4,title=$5,start_date=$6,end_date=$7,daily_minutes=$8,status=$9,version=$10,updated_at=now() WHERE id=$1 AND org_id=$2 AND version=$10-1").bind(v.id).bind(v.org_id).bind(v.person_id).bind(v.project_id).bind(&v.title).bind(v.start).bind(v.end).bind(v.daily_minutes).bind(&v.status).bind(v.version).execute(&mut **tx).await?.rows_affected()
  }
 },
 Command::DeleteAssignment{id,org_id,version}=>sqlx::query("DELETE FROM assignments WHERE id=$1 AND org_id=$2 AND version=$3").bind(id).bind(org_id).bind(version).execute(&mut **tx).await?.rows_affected(),
 };
    if rows != 1 {
        return Err(Error::Conflict);
    }
    Ok(())
}

async fn lock_person(
    tx: &mut Transaction<'_, Postgres>,
    org: Uuid,
    person: Uuid,
) -> Result<(), Error> {
    let found: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM people WHERE org_id=$1 AND id=$2 FOR UPDATE")
            .bind(org)
            .bind(person)
            .fetch_optional(&mut **tx)
            .await?;
    if found.is_none() {
        return Err(Error::Invalid("Choose a person in this workspace"));
    }
    Ok(())
}

impl Repository for crate::Postgres {
    async fn read(&self, actor: Actor) -> Result<Workspace, kivo_planning::Error> {
        read(&self.pool, actor.user_id).await.map_err(Into::into)
    }
    async fn execute(
        &self,
        actor: Actor,
        command: Command,
        request: Option<Uuid>,
    ) -> Result<(), kivo_planning::Error> {
        execute(&self.pool, actor.user_id, command, request)
            .await
            .map_err(Into::into)
    }
}
