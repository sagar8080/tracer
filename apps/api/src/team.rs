use crate::{AppState, authorize, error::ApiError, request_key};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use kivo_realtime::{Repository as _, Ticket};
use kivo_tenancy::{Invited, Repository, Team, TeamCommand};
use serde::Deserialize;
use uuid::Uuid;
pub async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
) -> Result<Json<Team>, ApiError> {
    let context = authorize(&headers, &state).await?;
    Ok(Json(state.database.team(context.actor, org).await?))
}
pub async fn write(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Json(command): Json<TeamCommand>,
) -> Result<Json<Option<Invited>>, ApiError> {
    let context = authorize(&headers, &state).await?;
    let key = request_key(&headers)?.ok_or(ApiError::Invalid("Idempotency-Key is required"))?;
    Ok(Json(
        state
            .database
            .manage(context.actor, org, command, key)
            .await?,
    ))
}
#[derive(Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum Acceptance {
    Link { token: String },
    Discovered { id: Uuid },
}
pub async fn accept(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Acceptance>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let context = authorize(&headers, &state).await?;
    let org = match input {
        Acceptance::Link { token } => state.database.accept(context.actor, &token).await?,
        Acceptance::Discovered { id } => {
            state.database.accept_invitation(context.actor, id).await?
        }
    };
    Ok(Json(serde_json::json!({"orgId":org})))
}
pub async fn ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
) -> Result<Json<Ticket>, ApiError> {
    let context = authorize(&headers, &state).await?;
    Ok(Json(
        state
            .database
            .issue_ticket(context.actor, org, context.expires_at)
            .await?,
    ))
}
