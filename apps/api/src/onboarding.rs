use crate::{AppState, authorize, error::ApiError, request_key};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use kivo_onboarding::{Enroll, Repository, Setup, Status};
use uuid::Uuid;

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Status>, ApiError> {
    let context = authorize(&headers, &state).await?;
    Ok(Json(state.database.status(context.actor).await?))
}
pub async fn setup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Setup>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let context = authorize(&headers, &state).await?;
    let key = request_key(&headers)?.ok_or(ApiError::Invalid("Idempotency-Key is required"))?;
    let org = state.database.setup(context.actor, input, key).await?;
    Ok(Json(serde_json::json!({"orgId":org})))
}
pub async fn enroll(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Json(input): Json<Enroll>,
) -> Result<StatusCode, ApiError> {
    let context = authorize(&headers, &state).await?;
    let key = request_key(&headers)?.ok_or(ApiError::Invalid("Idempotency-Key is required"))?;
    state
        .database
        .enroll(context.actor, org, input, key)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
