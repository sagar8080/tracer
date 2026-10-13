use crate::{Postgres, agents, error::Error, rows::*};
use kivo_agent_runtime::{Capacity, Person, Project, Repository, Schedule, Window};
use kivo_tenancy::{AgentCapability, Principal};
use sqlx::{Postgres as Pg, Transaction};
use uuid::Uuid;

pub(super) async fn person_visible(
    tx: &mut Transaction<'_, Pg>,
    auth: &agents::Authorized,
    org: Uuid,
    person: Uuid,
) -> Result<(), Error> {
    if let Some(scope) = &auth.scope {
        let visible: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM assignments WHERE org_id=$1 AND person_id=$2 AND project_id=ANY($3))")
            .bind(org).bind(person).bind(&scope.project_ids).fetch_one(&mut **tx).await?;
        if !visible {
            return Err(Error::Forbidden);
        }
    }
    Ok(())
}
pub(super) use kivo_agent_runtime::{CapacitySource as Source, day_series as days};
pub(super) async fn source(
    tx: &mut Transaction<'_, Pg>,
    org: Uuid,
    person: Uuid,
    window: &Window,
) -> Result<Source, Error> {
    let row: PersonRow = sqlx::query_as("SELECT * FROM people WHERE org_id=$1 AND id=$2")
        .bind(org)
        .bind(person)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(Error::Forbidden)?;
    let mut person: kivo_planning::Person = row.into();
    person.cost_rate = None;
    let calendars: Vec<WorkingCalendarRow> = sqlx::query_as("SELECT * FROM working_calendars WHERE org_id=$1 AND person_id=$2 AND effective_from<=$3 ORDER BY effective_from,id LIMIT 1001")
        .bind(org).bind(person.id).bind(window.end).fetch_all(&mut **tx).await?;
    let absences: Vec<AbsenceRow> = sqlx::query_as("SELECT * FROM absences WHERE org_id=$1 AND (person_id=$2 OR category='holiday') AND start_date<=$3 AND end_date>=$4 ORDER BY id LIMIT 1001")
        .bind(org).bind(person.id).bind(window.end).bind(window.start).fetch_all(&mut **tx).await?;
    let assignments: Vec<AssignmentRow> = sqlx::query_as("SELECT * FROM assignments WHERE org_id=$1 AND person_id=$2 AND start_date<=$3 AND end_date>=$4 ORDER BY id LIMIT 2001")
        .bind(org).bind(person.id).bind(window.end).bind(window.start).fetch_all(&mut **tx).await?;
    if calendars.len() > 1000 || absences.len() > 1000 || assignments.len() > 2000 {
        return Err(Error::Invalid(
            "This window is too dense; narrow the date range",
        ));
    }
    Ok(Source {
        person,
        calendars: calendars.into_iter().map(Into::into).collect(),
        absences: absences.into_iter().map(Into::into).collect(),
        assignments: assignments.into_iter().map(Into::into).collect(),
    })
}
impl Repository for Postgres {
    async fn capabilities(
        &self,
        caller: Principal,
        org: Uuid,
    ) -> Result<Vec<AgentCapability>, kivo_agents::Error> {
        let mut tx = self.pool.begin().await.map_err(Error::from)?;
        let mut result = Vec::new();
        for cap in [
            AgentCapability::ReadSchedule,
            AgentCapability::ReadCapacity,
            AgentCapability::ProposeMove,
            AgentCapability::ReadProposal,
        ] {
            match agents::authorize(&mut tx, caller, org, cap).await {
                Ok(_) => result.push(cap),
                Err(Error::Forbidden) => (),
                Err(e) => return Err(e.into()),
            }
        }
        if result.is_empty() {
            return Err(Error::Forbidden.into());
        }
        tx.commit().await.map_err(Error::from)?;
        Ok(result)
    }
    async fn schedule_window(
        &self,
        caller: Principal,
        org: Uuid,
        window: Window,
    ) -> Result<Schedule, kivo_agents::Error> {
        window.validate()?;
        let mut tx = self.pool.begin().await.map_err(Error::from)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(Error::from)?;
        let auth = agents::authorize(&mut tx, caller, org, AgentCapability::ReadSchedule).await?;
        let ids = auth.scope.as_ref().map(|s| &s.project_ids);
        let (revision, timezone): (i64, String) =
            sqlx::query_as("SELECT revision,timezone FROM organizations WHERE id=$1")
                .bind(org)
                .fetch_one(&mut *tx)
                .await
                .map_err(Error::from)?;
        let mut rows: Vec<AssignmentRow> = sqlx::query_as("SELECT * FROM assignments WHERE org_id=$1 AND ($2::uuid[] IS NULL OR project_id=ANY($2)) AND start_date<=$3 AND end_date>=$4 AND ($5::uuid IS NULL OR id>$5) ORDER BY id LIMIT 201")
            .bind(org).bind(ids).bind(window.end).bind(window.start).bind(window.cursor).fetch_all(&mut *tx).await.map_err(Error::from)?;
        let more = rows.len() > 200;
        rows.truncate(200);
        let next_cursor = if more {
            rows.last().map(|a| a.id)
        } else {
            None
        };
        let people_ids: Vec<_> = rows.iter().map(|a| a.person_id).collect();
        let project_ids = ids
            .cloned()
            .unwrap_or_else(|| rows.iter().map(|a| a.project_id).collect());
        let people: Vec<(Uuid,String,String,String,i32)> = sqlx::query_as("SELECT id,name,role,team,version FROM people WHERE org_id=$1 AND id=ANY($2) ORDER BY id").bind(org).bind(people_ids).fetch_all(&mut *tx).await.map_err(Error::from)?;
        let projects: Vec<(Uuid,String,String,String,i32)> = sqlx::query_as("SELECT id,name,client,status,version FROM projects WHERE org_id=$1 AND id=ANY($2) ORDER BY id").bind(org).bind(project_ids).fetch_all(&mut *tx).await.map_err(Error::from)?;
        tx.commit().await.map_err(Error::from)?;
        Ok(Schedule {
            revision,
            timezone,
            assignments: rows.into_iter().map(Into::into).collect(),
            next_cursor,
            people: people
                .into_iter()
                .map(|(id, name, role, team, version)| Person {
                    id,
                    name,
                    role,
                    team,
                    version,
                })
                .collect(),
            projects: projects
                .into_iter()
                .map(|(id, name, client, status, version)| Project {
                    id,
                    name,
                    client,
                    status,
                    version,
                })
                .collect(),
        })
    }
    async fn capacity_window(
        &self,
        caller: Principal,
        org: Uuid,
        person: Uuid,
        window: Window,
    ) -> Result<Capacity, kivo_agents::Error> {
        window.validate()?;
        if window.cursor.is_some() {
            return Err(Error::Invalid("Capacity windows do not use a cursor").into());
        }
        let mut tx = self.pool.begin().await.map_err(Error::from)?;
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *tx)
            .await
            .map_err(Error::from)?;
        let auth = agents::authorize(&mut tx, caller, org, AgentCapability::ReadCapacity).await?;
        person_visible(&mut tx, &auth, org, person).await?;
        let revision = sqlx::query_scalar("SELECT revision FROM organizations WHERE id=$1")
            .bind(org)
            .fetch_one(&mut *tx)
            .await
            .map_err(Error::from)?;
        let data = source(&mut tx, org, person, &window).await?;
        let days = days(&data, &window, None);
        tx.commit().await.map_err(Error::from)?;
        Ok(Capacity {
            revision,
            person_id: person,
            days,
        })
    }
    async fn proposals(
        &self,
        caller: Principal,
        org: Uuid,
        cursor: Option<Uuid>,
    ) -> Result<kivo_agent_runtime::Proposals, kivo_agents::Error> {
        super::proposals::list(self, caller, org, cursor)
            .await
            .map_err(Into::into)
    }
    async fn proposal(
        &self,
        caller: Principal,
        org: Uuid,
        id: Uuid,
    ) -> Result<kivo_agent_runtime::Proposal, kivo_agents::Error> {
        super::proposals::get(self, caller, org, id)
            .await
            .map_err(Into::into)
    }
    async fn propose(
        &self,
        caller: Principal,
        org: Uuid,
        command: kivo_agent_runtime::Command,
        key: Uuid,
    ) -> Result<kivo_agent_runtime::Proposal, kivo_agents::Error> {
        super::proposals::mutate(self, caller, org, command, key)
            .await
            .map_err(Into::into)
    }
}
