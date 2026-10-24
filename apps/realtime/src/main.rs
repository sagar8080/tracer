mod hub;
use axum::{
    Json, Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use kivo_postgres::{DatabaseConfig, Postgres};
use kivo_realtime::Repository;
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tokio::sync::{Semaphore, watch};
#[derive(Clone)]
struct App {
    db: Postgres,
    hub: hub::Hub,
    origin: String,
    slots: Arc<Semaphore>,
    stop: watch::Receiver<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Hello {
    ticket: String,
    after_revision: i64,
}
async fn upgrade(State(app): State<App>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    if headers.get("origin").and_then(|h| h.to_str().ok()) != Some(&app.origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Ok(permit) = app.slots.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    ws.max_message_size(4096)
        .max_frame_size(4096)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            session(socket, app).await;
        })
        .into_response()
}
async fn send(socket: &mut WebSocket, value: serde_json::Value) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_secs(5),
            socket.send(Message::Text(value.to_string().into()))
        )
        .await,
        Ok(Ok(()))
    )
}
async fn session(mut socket: WebSocket, mut app: App) {
    let first = tokio::time::timeout(Duration::from_secs(5), socket.recv()).await;
    let hello = match first {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Hello>(&text).ok(),
        _ => None,
    };
    let Some(hello) = hello else {
        return;
    };
    let Ok(subscription) = app.db.consume_ticket(&hello.ticket).await else {
        send(&mut socket, serde_json::json!({"type":"denied"})).await;
        return;
    };
    let mut watcher = app.hub.subscribe(subscription.org_id).await;
    let mut after = hello.after_revision;
    let mut previous_role = None;
    let mut recheck = tokio::time::interval(Duration::from_secs(5));
    let mut last_ping = std::time::Instant::now();
    let mut last_pong = last_ping;
    loop {
        if last_pong.elapsed() > Duration::from_secs(45) {
            return;
        }
        if last_ping.elapsed() >= Duration::from_secs(15) {
            if !matches!(
                tokio::time::timeout(
                    Duration::from_secs(5),
                    socket.send(Message::Ping(vec![].into()))
                )
                .await,
                Ok(Ok(()))
            ) {
                return;
            }
            last_ping = std::time::Instant::now();
        }
        if chrono::Utc::now() >= subscription.valid_until {
            send(&mut socket, serde_json::json!({"type":"expired"})).await;
            return;
        }
        let changes = match app
            .db
            .changes(subscription.actor, subscription.org_id, after)
            .await
        {
            Ok(c) => c,
            Err(kivo_realtime::Error::Forbidden) => {
                send(&mut socket, serde_json::json!({"type":"denied"})).await;
                return;
            }
            Err(_) => {
                send(&mut socket, serde_json::json!({"type":"unavailable"})).await;
                return;
            }
        };
        let changed_role = previous_role.is_some_and(|r| r != changes.role);
        if previous_role.is_none() || changed_role || changes.revision != after || changes.reset {
            if !send(
                &mut socket,
                serde_json::json!({"type":"changes","schemaVersion":1,"orgId":subscription.org_id,"accessChanged":changed_role,"batch":changes}),
            )
            .await
            {
                return;
            }
            after = changes.revision;
        }
        previous_role = Some(changes.role);
        if changed_role {
            return;
        }
        // Control frames must not amplify into database reads. Only revision
        // notifications and the bounded reauthorization timer wake the outer loop.
        let mut controls = 0;
        loop {
            tokio::select! {
                _=app.stop.changed()=>return,
                _=watcher.changed()=>break,
                _=recheck.tick()=>break,
                message=socket.recv()=>{
                    controls+=1;
                    if controls>16 {return;}
                    match message {
                        Some(Ok(Message::Pong(_)))=>{last_pong=std::time::Instant::now();},
                        Some(Ok(Message::Ping(data)))=>{
                            if !matches!(tokio::time::timeout(Duration::from_secs(5),socket.send(Message::Pong(data))).await,Ok(Ok(()))) {return;}
                        },
                        _=>return,
                    }
                }
            }
        }
    }
}
async fn ready(State(app): State<App>) -> StatusCode {
    if app.db.ping().await {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    if std::env::var("KIVO_LOAD_ENV").as_deref() != Ok("0") {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env");
        match dotenvy::from_path(path) {
            Ok(_) => {}
            Err(dotenvy::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => anyhow::bail!("Could not parse apps/realtime/.env"),
        }
    }
    let origin =
        std::env::var("KIVO_WEB_ORIGIN").unwrap_or_else(|_| "http://localhost:3000".into());
    let parsed = url::Url::parse(&origin)?;
    anyhow::ensure!(
        parsed.origin().ascii_serialization() == origin
            && (parsed.scheme() == "https"
                || parsed.scheme() == "http"
                    && matches!(parsed.host_str(), Some("localhost" | "127.0.0.1"))),
        "KIVO_WEB_ORIGIN must be an exact HTTPS origin (HTTP only on loopback)"
    );
    let db = Postgres::connect(&DatabaseConfig::from_lookup(|k| std::env::var(k).ok())?).await?;
    let hub = hub::Hub::default();
    let poll = tokio::spawn(hub.clone().poll(db.clone()));
    let (stop_tx, stop) = watch::channel(false);
    let app = App {
        db: db.clone(),
        hub,
        origin,
        slots: Arc::new(Semaphore::new(256)),
        stop: stop.clone(),
    };
    let router = Router::new()
        .route("/ws", get(upgrade))
        .route(
            "/health",
            get(|| async { Json(serde_json::json!({"status":"ok"})) }),
        )
        .route("/ready", get(ready))
        .with_state(app);
    let bind = std::env::var("KIVO_REALTIME_BIND").unwrap_or_else(|_| "127.0.0.1:4001".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind,"Realtime listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            let _ = stop_tx.send(true);
        })
        .await?;
    poll.abort();
    db.close().await;
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
