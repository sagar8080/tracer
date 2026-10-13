use crate::{AppState, authorize, error::ApiError};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use kivo_files::{Download, ReservedUpload, Upload};
use uuid::Uuid;

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Json(upload): Json<Upload>,
) -> Result<(StatusCode, Json<ReservedUpload>), ApiError> {
    let context = authorize(&headers, &state).await?;
    // Preserve validation-before-disabled-service behavior.
    upload.validate()?;
    let service = state
        .files
        .as_ref()
        .ok_or(ApiError::Unavailable("S3 is not configured"))?;
    Ok((
        StatusCode::CREATED,
        Json(
            service
                .reserve_once(
                    context.actor,
                    org,
                    upload,
                    crate::request_key(&headers)?.unwrap_or_else(Uuid::new_v4),
                )
                .await?,
        ),
    ))
}
pub async fn complete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((org, id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let context = authorize(&headers, &state).await?;
    let service = state
        .files
        .as_ref()
        .ok_or(ApiError::Unavailable("S3 is not configured"))?;
    service.complete(context.actor, org, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((org, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Download>, ApiError> {
    let context = authorize(&headers, &state).await?;
    let service = state
        .files
        .as_ref()
        .ok_or(ApiError::Unavailable("S3 is not configured"))?;
    Ok(Json(service.download(context.actor, org, id).await?))
}
