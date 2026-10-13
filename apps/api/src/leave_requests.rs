use crate::{AppState, authorize, error::ApiError, request_key};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use kivo_leave_requests::{Command, Repository, Snapshot};
use uuid::Uuid;
pub async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
) -> Result<Json<Snapshot>, ApiError> {
    let context = authorize(&headers, &state).await?;
    Ok(Json(state.database.leave(context.actor, org).await?))
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
        .request_leave(context.actor, org, command, key)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
