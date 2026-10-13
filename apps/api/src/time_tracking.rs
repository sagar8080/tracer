use crate::{AppState, authorize, error::ApiError, request_key};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use chrono::NaiveDate;
use kivo_time_tracking::{Command, Repository, Snapshot};
use serde::Deserialize;
use uuid::Uuid;
#[derive(Deserialize)]
pub struct Week {
    week: NaiveDate,
}
pub async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Query(input): Query<Week>,
) -> Result<Json<Snapshot>, ApiError> {
    let context = authorize(&headers, &state).await?;
    Ok(Json(
        state
            .database
            .timesheets(context.actor, org, input.week)
            .await?,
    ))
}
pub async fn write(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Json(command): Json<Command>,
) -> Result<StatusCode, ApiError> {
    let context = authorize(&headers, &state).await?;
    let key = request_key(&headers)?.ok_or(ApiError::Invalid("Idempotency-Key is required"))?;
    state
        .database
        .track_time(context.actor, org, command, key)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
