mod auth;
mod config;
mod error;
mod files;
mod leave_requests;
mod migration;
mod onboarding;
mod team;
mod time_tracking;
use anyhow::bail;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use error::ApiError;
use kivo_object_storage_s3::Storage;
use kivo_planning::{Command, Workspace};
use kivo_postgres::Postgres;
use kivo_rate_limit::{Decision, RateLimiter, upstash::Redis};
use kivo_tenancy::{Actor, DevelopmentIdentity};
use std::time::Duration;
#[derive(Clone)]
struct AppState {
    database: Postgres,
    planning: kivo_planning::Service<Postgres>,
    auth: auth::Authentication,
    redis: Option<Redis>,
    files: Option<kivo_files::Service<Postgres, Storage>>,
}
async fn authorize(headers: &HeaderMap, state: &AppState) -> Result<auth::Context, ApiError> {
    let context = state.auth.authenticate(headers, &state.database).await?;
    if let Some(redis) = &state.redis
        && let Decision::Deny {
            retry_after_seconds,
        } = redis.check(context.actor.user_id).await?
    {
        return Err(ApiError::RateLimited(retry_after_seconds));
    }
    Ok(context)
}
fn request_key(headers: &HeaderMap) -> Result<Option<uuid::Uuid>, ApiError> {
    headers
        .get("idempotency-key")
        .map(|v| {
            v.to_str()
                .ok()
                .and_then(|v| uuid::Uuid::parse_str(v).ok())
                .ok_or(ApiError::Invalid("Idempotency-Key must be a UUID"))
        })
        .transpose()
}
async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Workspace>, ApiError> {
    let context = authorize(&headers, &state).await?;
    Ok(Json(state.planning.read(context.actor).await?))
}
async fn write(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(command): Json<Command>,
) -> Result<StatusCode, ApiError> {
    let context = authorize(&headers, &state).await?;
    match request_key(&headers)? {
        Some(key) => {
            state
                .planning
                .execute_once(context.actor, command, key)
                .await?
        }
        None => state.planning.execute(context.actor, command).await?,
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn ready(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    state.auth.authenticate(&headers, &state.database).await?;
    let postgres = state.database.ping();
    let redis = async {
        match &state.redis {
            Some(redis) => {
                if redis.ping().await.is_ok() {
                    "ok"
                } else {
                    "unavailable"
                }
            }
            None => "disabled",
        }
    };
    let s3 = async {
        match &state.files {
            Some(storage) => {
                if matches!(
                    tokio::time::timeout(Duration::from_secs(12), storage.ping()).await,
                    Ok(Ok(()))
                ) {
                    "ok"
                } else {
                    "unavailable"
                }
            }
            None => "disabled",
        }
    };
    let (postgres, redis, s3) = tokio::join!(postgres, redis, s3);
    let healthy = postgres && redis != "unavailable" && s3 != "unavailable";
    Ok((
        if healthy {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        Json(serde_json::json!({
            "status":if healthy {"ok"} else {"unavailable"},
            "mode":state.auth.mode(),
            "services":{"postgres":if postgres {"ok"} else {"unavailable"}, "redis":redis,"s3":s3}
        })),
    ))
}

async fn no_store(mut response: Response) -> Response {
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("private, no-store"),
    );
    response
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let config = config::Config::load()?;
    match std::env::args().nth(1).as_deref() {
        Some("migrate") => {
            migration::run().await?;
            tracing::info!("PostgreSQL migrations complete");
            return Ok(());
        }
        None => (),
        Some(_) => bail!("Usage: kivo-api [migrate]"),
    }
    if config.run_migrations {
        migration::run().await?;
    }
    let database = Postgres::connect(&config.database).await?;
    let actor = Actor {
        user_id: config.user,
    };
    let auth = match config.auth0 {
        Some(config) => auth::Authentication::Auth0(kivo_auth0::Auth0::new(config)?),
        None => {
            database.ensure_development_actor(actor).await?;
            auth::Authentication::Development {
                actor,
                token: config.token,
            }
        }
    };
    let redis = config.redis.map(Redis::new).transpose()?;
    let files = match config.s3 {
        Some(config) => Some(kivo_files::Service::new(
            database.clone(),
            Storage::new(config).await,
        )),
        None => None,
    };
    tracing::info!(
        redis_enabled = redis.is_some(),
        s3_enabled = files.is_some(),
        "Provider adapters configured; use /ready to check connectivity"
    );
    let state = AppState {
        database: database.clone(),
        planning: kivo_planning::Service::new(database.clone()),
        auth,
        redis,
        files,
    };
    let app = Router::new()
        .route(
            "/health",
            get(|| async { Json(serde_json::json!({"status":"ok"})) }),
        )
        .route("/v1/workspace", get(read).post(write))
        .route(
            "/v1/onboarding",
            get(onboarding::status).post(onboarding::setup),
        )
        .route(
            "/v1/organizations/{org}/enrollment",
            post(onboarding::enroll),
        )
        .route(
            "/v1/organizations/{org}/time",
            get(time_tracking::read).post(time_tracking::write),
        )
        .route(
            "/v1/organizations/{org}/leave",
            get(leave_requests::read).post(leave_requests::write),
        )
        .route("/ready", get(ready))
        .route(
            "/v1/organizations/{org}/team",
            get(team::read).post(team::write),
        )
        .route("/v1/invitations/accept", post(team::accept))
        .route(
            "/v1/organizations/{org}/realtime-ticket",
            post(team::ticket),
        )
        .route("/v1/organizations/{org}/files", post(files::create))
        .route(
            "/v1/organizations/{org}/files/{id}/complete",
            post(files::complete),
        )
        .route(
            "/v1/organizations/{org}/files/{id}/download",
            post(files::download),
        )
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(axum::middleware::map_response(no_store))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    tracing::info!(bind=%config.bind,"Kivo API listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            if let Err(e) = tokio::signal::ctrl_c().await {
                tracing::error!(error=%e,"shutdown signal failed")
            }
        })
        .await?;
    database.close().await;
    Ok(())
}
