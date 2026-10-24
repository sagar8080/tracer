use crate::{AppState, authorize, error::ApiError, request_key};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use kivo_integrations::{Import, MappingSuggestions, Registry, Repository, Review, Start, Version};
use uuid::Uuid;
pub async fn list(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(org): Path<Uuid>,
) -> Result<Json<Registry>, ApiError> {
    let actor = authorize(&h, &s).await?.actor;
    Ok(Json(Registry {
        imports: s.database.list(actor, org).await?,
        providers: s.mapping.providers(),
    }))
}
pub async fn read(
    State(s): State<AppState>,
    h: HeaderMap,
    Path((org, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Import>, ApiError> {
    let actor = authorize(&h, &s).await?.actor;
    Ok(Json(s.database.read(actor, org, id).await?))
}
pub async fn start(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(org): Path<Uuid>,
    Json(input): Json<Start>,
) -> Result<Json<Import>, ApiError> {
    let actor = authorize(&h, &s).await?.actor;
    input.validate()?;
    if !s.mapping.providers().contains(&input.provider) {
        return Err(ApiError::Invalid("This mapping provider is not configured"));
    }
    if s.files.is_none() {
        return Err(ApiError::Unavailable("S3 is not configured"));
    }
    Ok(Json(
        s.database
            .start(
                actor,
                org,
                input,
                request_key(&h)?.unwrap_or_else(Uuid::new_v4),
            )
            .await?,
    ))
}
pub async fn review(
    State(s): State<AppState>,
    h: HeaderMap,
    Path((org, id)): Path<(Uuid, Uuid)>,
    Json(input): Json<Review>,
) -> Result<Json<Import>, ApiError> {
    let actor = authorize(&h, &s).await?.actor;
    Ok(Json(
        s.database
            .review(
                actor,
                org,
                id,
                input,
                request_key(&h)?.unwrap_or_else(Uuid::new_v4),
            )
            .await?,
    ))
}
macro_rules! version_command {
    ($name:ident) => {
        pub async fn $name(
            State(s): State<AppState>,
            h: HeaderMap,
            Path((org, id)): Path<(Uuid, Uuid)>,
            Json(input): Json<Version>,
        ) -> Result<Json<Import>, ApiError> {
            let actor = authorize(&h, &s).await?.actor;
            Ok(Json(
                s.database
                    .$name(
                        actor,
                        org,
                        id,
                        input.version,
                        request_key(&h)?.unwrap_or_else(Uuid::new_v4),
                    )
                    .await?,
            ))
        }
    };
}
version_command!(publish);
version_command!(cancel);
version_command!(export);
