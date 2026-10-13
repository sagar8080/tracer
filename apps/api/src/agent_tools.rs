use crate::{AppState, authorize, error::ApiError, request_key};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use kivo_agent_runtime::{Capacity, Command, Proposal, Proposals, Repository, Schedule, Window};
use kivo_agents::Repository as _;
use kivo_rate_limit::{Decision, RateLimiter};
use kivo_tenancy::Principal;
use serde::Deserialize;
use uuid::Uuid;
pub(super) async fn caller(
    headers: &HeaderMap,
    state: &AppState,
    org: Uuid,
) -> Result<Principal, ApiError> {
    crate::agents::check_origin(headers, state)?;
    let token = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;
    if token.starts_with("kivo_session_") {
        let context = state.database.verify_agent_session(token).await?;
        if context.org_id != org {
            return Err(ApiError::Forbidden);
        }
        if let Some(redis) = &state.redis
            && let Decision::Deny {
                retry_after_seconds,
            } = redis.check(context.principal.id()).await?
        {
            return Err(ApiError::RateLimited(retry_after_seconds));
        }
        Ok(context.principal)
    } else {
        Ok(Principal::Human(authorize(headers, state).await?.actor))
    }
}
pub async fn schedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Query(window): Query<Window>,
) -> Result<Json<Schedule>, ApiError> {
    let caller = caller(&headers, &state, org).await?;
    Ok(Json(
        state.database.schedule_window(caller, org, window).await?,
    ))
}
pub async fn capacity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((org, person)): Path<(Uuid, Uuid)>,
    Query(window): Query<Window>,
) -> Result<Json<Capacity>, ApiError> {
    let caller = caller(&headers, &state, org).await?;
    Ok(Json(
        state
            .database
            .capacity_window(caller, org, person, window)
            .await?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cursor {
    cursor: Option<Uuid>,
}
pub async fn proposals(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Query(input): Query<Cursor>,
) -> Result<Json<Proposals>, ApiError> {
    let caller = caller(&headers, &state, org).await?;
    Ok(Json(
        state.database.proposals(caller, org, input.cursor).await?,
    ))
}
pub async fn proposal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((org, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Proposal>, ApiError> {
    let caller = caller(&headers, &state, org).await?;
    Ok(Json(state.database.proposal(caller, org, id).await?))
}
pub async fn write(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Json(command): Json<Command>,
) -> Result<Json<Proposal>, ApiError> {
    let caller = caller(&headers, &state, org).await?;
    let key = request_key(&headers)?.ok_or(ApiError::Invalid("Idempotency-Key is required"))?;
    Ok(Json(
        state.database.propose(caller, org, command, key).await?,
    ))
}
