use crate::{AppState, authorize, error::ApiError, request_key};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use kivo_agents::{Command, Issued, Registry, Repository, Session};
use serde::Deserialize;
use uuid::Uuid;
pub(super) fn check_origin(headers: &HeaderMap, state: &AppState) -> Result<(), ApiError> {
    if let Some(origin) = headers.get("origin")
        && origin.to_str().ok() != Some(state.web_origin.as_str())
    {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}
pub async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
) -> Result<Json<Registry>, ApiError> {
    let context = authorize(&headers, &state).await?;
    Ok(Json(state.database.agents(context.actor, org).await?))
}
pub async fn write(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Json(command): Json<Command>,
) -> Result<Json<Issued>, ApiError> {
    let context = authorize(&headers, &state).await?;
    let key = request_key(&headers)?.ok_or(ApiError::Invalid("Idempotency-Key is required"))?;
    Ok(Json(
        state
            .database
            .manage_agent(context.actor, org, command, key)
            .await?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Exchange {
    credential: String,
}
pub async fn exchange(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Exchange>,
) -> Result<Json<Session>, ApiError> {
    check_origin(&headers, &state)?;
    Ok(Json(
        state
            .database
            .exchange_agent_credential(&input.credential)
            .await?,
    ))
}
