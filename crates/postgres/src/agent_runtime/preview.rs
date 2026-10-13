use super::queries::{days, source};
use crate::{agents, error::Error, events, rows::AssignmentRow};
use kivo_agent_runtime::{Impact, Move, Preview};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub(super) async fn calculate(
    tx: &mut Transaction<'_, Postgres>,
    org: Uuid,
    request: &Move,
    auth: &agents::Authorized,
) -> Result<Preview, Error> {
    request.validate().map_err(|e| match e {
        kivo_agents::Error::Invalid(m) => Error::Invalid(m),
        _ => Error::Invalid("Invalid move"),
    })?;
    let row: AssignmentRow = sqlx::query_as("SELECT * FROM assignments WHERE org_id=$1 AND id=$2")
        .bind(org)
        .bind(request.assignment_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(Error::Forbidden)?;
    if !auth.permits_project(row.project_id) {
        return Err(Error::Forbidden);
    }
    let original: kivo_planning::Assignment = row.into();
    let project: (String, i32) =
        sqlx::query_as("SELECT status,version FROM projects WHERE org_id=$1 AND id=$2")
            .bind(org)
            .bind(original.project_id)
            .fetch_one(&mut **tx)
            .await?;
    let timezone: String = sqlx::query_scalar("SELECT timezone FROM organizations WHERE id=$1")
        .bind(org)
        .fetch_one(&mut **tx)
        .await?;
    let tz: chrono_tz::Tz = timezone
        .parse()
        .map_err(|_| Error::Invalid("Invalid workspace timezone"))?;
    let today = chrono::Utc::now().with_timezone(&tz).date_naive();
    let (proposed, window) =
        kivo_agent_runtime::checked_move(&original, request, today, project.0 != "complete")
            .map_err(|e| match e {
                kivo_agents::Error::Conflict => Error::Conflict,
                kivo_agents::Error::Invalid(m) => Error::Invalid(m),
                _ => Error::Invalid("Invalid planning context"),
            })?;
    super::queries::person_visible(tx, auth, org, request.person_id).await?;
    let mut people = vec![original.person_id, request.person_id];
    people.sort();
    people.dedup();
    let mut impacts = Vec::new();
    let mut sources = Vec::new();
    for id in people {
        let data = source(tx, org, id, &window).await?;
        if id == request.person_id {
            proposed
                .validate_calendar(&data.calendars)
                .map_err(Error::Invalid)?;
        }
        impacts.push(Impact {
            person_id: id,
            before: days(&data, &window, None),
            after: days(&data, &window, Some(&proposed)),
        });
        // Hash current private context, but never expose other project identities or leave notes.
        sources.push(serde_json::json!({"person":data.person,"calendars":data.calendars,"absences":data.absences,"assignments":data.assignments}));
    }
    let fingerprint = events::hash(
        &serde_json::json!({"original":original,"projectVersion":project.1,"sources":sources})
            .to_string(),
    );
    Ok(Preview {
        original,
        proposed,
        impacts,
        source_fingerprint: fingerprint,
    })
}
