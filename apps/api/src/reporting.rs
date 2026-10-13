use crate::{AppState, authorize, error::ApiError};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use chrono::NaiveDate;
use kivo_reporting::{Report, Repository};
use serde::Deserialize;
use uuid::Uuid;
#[derive(Deserialize)]
pub struct Range {
    start: NaiveDate,
    end: NaiveDate,
}
pub async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Query(input): Query<Range>,
) -> Result<Json<Report>, ApiError> {
    let context = authorize(&headers, &state).await?;
    Ok(Json(
        state
            .database
            .report(context.actor, org, input.start, input.end)
            .await?,
    ))
}
