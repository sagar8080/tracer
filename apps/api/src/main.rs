mod agent_tools;
mod agents;
mod auth;
mod config;
mod error;
mod files;
mod imports;
mod leave_requests;
mod mcp;
mod migration;
mod onboarding;
mod reporting;
mod team;
mod time_tracking;
use anyhow::bail;
use axum::{
    Json, Router,
    extract::{ConnectInfo, DefaultBodyLimit, State},
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
    web_origin: String,
    mapping: kivo_import_inference::Adapters,
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
    Ok(dependency_status(&state).await)
}

// Container health uses a local request without an expiring human OAuth token.
// The authenticated /ready endpoint retains its existing public contract.
async fn internal_ready(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
) -> StatusCode {
    if !peer.ip().is_loopback() {
        return StatusCode::FORBIDDEN;
    }
    dependency_status(&state).await.0
}

async fn dependency_status(state: &AppState) -> (StatusCode, Json<serde_json::Value>) {
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
    (
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
    )
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
        mapping: kivo_import_inference::Adapters::new(config.inference)?,
        web_origin: config.web_origin,
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
        .route("/internal/ready", get(internal_ready))
        .route("/v1/workspace", get(read).post(write))
        .route(
            "/v1/organizations/{org}/agents",
            get(agents::read).post(agents::write),
        )
        .route("/v1/agent-sessions", post(agents::exchange))
        .route(
            "/v1/organizations/{org}/schedule",
            get(agent_tools::schedule),
        )
        .route(
            "/v1/organizations/{org}/capacity/{person}",
            get(agent_tools::capacity),
        )
        .route(
            "/v1/organizations/{org}/proposals",
            get(agent_tools::proposals).post(agent_tools::write),
        )
        .route(
            "/v1/organizations/{org}/proposals/{id}",
            get(agent_tools::proposal),
        )
        .route(
            "/v1/organizations/{org}/mcp",
            post(mcp::handle).get(mcp::no_stream).delete(mcp::no_stream),
        )
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
        .route("/v1/organizations/{org}/reports", get(reporting::read))
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
        .route(
            "/v1/organizations/{org}/imports",
            get(imports::list).post(imports::start),
        )
        .route("/v1/organizations/{org}/imports/{id}", get(imports::read))
        .route(
            "/v1/organizations/{org}/imports/{id}/review",
            post(imports::review).layer(DefaultBodyLimit::max(2 * 1024 * 1024)),
        )
        .route(
            "/v1/organizations/{org}/imports/{id}/publish",
            post(imports::publish),
        )
        .route(
            "/v1/organizations/{org}/imports/{id}/cancel",
            post(imports::cancel),
        )
        .route(
            "/v1/organizations/{org}/imports/{id}/export",
            post(imports::export),
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
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    database.close().await;
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    if let Ok(mut terminate) =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    {
        tokio::select! { _ = tokio::signal::ctrl_c() => (), _ = terminate.recv() => () }
        return;
    }
    let _ = tokio::signal::ctrl_c().await;
}
