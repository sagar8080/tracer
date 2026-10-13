use crate::{Postgres, error::Error, rows::*, tenancy};
use chrono::NaiveDate;
use kivo_reporting::{Actual, Report, Repository, Source, calculate};
use kivo_tenancy::{Actor, Permission};
use kivo_time_tracking::SheetStatus;
use uuid::Uuid;
#[derive(sqlx::FromRow)]
struct ActualRow {
    person_id: Uuid,
    project_id: Uuid,
    entry_date: NaiveDate,
    minutes: i32,
    billable: bool,
    status: String,
}
impl Repository for Postgres {
    async fn report(
        &self,
        actor: Actor,
        org: Uuid,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Report, kivo_reporting::Error> {
        kivo_reporting::validate_range(start, end)?;
        read(self, actor, org, start, end).await.map_err(Into::into)
    }
}
async fn read(
    db: &Postgres,
    actor: Actor,
    org: Uuid,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<Report, Error> {
    let mut tx = db.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    tenancy::require(&mut tx, actor, org, Permission::Read).await?;
    let people =
        sqlx::query_as::<_, PersonRow>("SELECT * FROM people WHERE org_id=$1 ORDER BY name,id")
            .bind(org)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(Into::into)
            .collect();
    let projects =
        sqlx::query_as::<_, ProjectRow>("SELECT * FROM projects WHERE org_id=$1 ORDER BY name,id")
            .bind(org)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(Into::into)
            .collect();
    let assignments = sqlx::query_as::<_, AssignmentRow>(
        "SELECT * FROM assignments WHERE org_id=$1 AND start_date<=$3 AND end_date>=$2",
    )
    .bind(org)
    .bind(start)
    .bind(end)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(Into::into)
    .collect();
    let calendars = sqlx::query_as::<_, WorkingCalendarRow>(
        "SELECT * FROM working_calendars WHERE org_id=$1 AND effective_from<=$2",
    )
    .bind(org)
    .bind(end)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(Into::into)
    .collect();
    let absences = sqlx::query_as::<_, AbsenceRow>(
        "SELECT * FROM absences WHERE org_id=$1 AND start_date<=$3 AND end_date>=$2",
    )
    .bind(org)
    .bind(start)
    .bind(end)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(Into::into)
    .collect();
    let rows=sqlx::query_as::<_,ActualRow>("SELECT s.person_id,e.project_id,e.entry_date,e.minutes,e.billable,s.status FROM time_entries e JOIN timesheets s ON s.org_id=e.org_id AND s.id=e.sheet_id WHERE e.org_id=$1 AND e.entry_date BETWEEN $2 AND $3").bind(org).bind(start).bind(end).fetch_all(&mut *tx).await?;
    let actuals = rows
        .into_iter()
        .map(|r| {
            Ok(Actual {
                person_id: r.person_id,
                project_id: r.project_id,
                date: r.entry_date,
                minutes: r.minutes,
                billable: r.billable,
                status: SheetStatus::parse(&r.status).ok_or(Error::Conflict)?,
            })
        })
        .collect::<Result<Vec<_>, Error>>()?;
    let totals:Vec<(Uuid,i64)>=sqlx::query_as("SELECT e.project_id,sum(e.minutes)::bigint FROM time_entries e JOIN timesheets s ON s.id=e.sheet_id AND s.org_id=e.org_id WHERE e.org_id=$1 AND s.status='approved' GROUP BY e.project_id").bind(org).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(calculate(
        start,
        end,
        Source {
            people,
            projects,
            assignments,
            calendars,
            absences,
            actuals,
            approved_project_totals: totals.into_iter().collect(),
        },
    ))
}
