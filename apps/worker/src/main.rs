mod config;
use kivo_files::{ObjectBytes, ObjectStore};
use kivo_integrations::{MappingSuggestions, Provider, Repository};
use kivo_jobs::{Kind, Repository as JobRepository};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let config = config::Config::load()?;
    let database = kivo_postgres::Postgres::connect(&config.database).await?;
    let storage = kivo_object_storage_s3::Storage::new(config.storage).await;
    let mapping = kivo_import_inference::Adapters::new(config.inference)?;
    let healthy = Arc::new(AtomicBool::new(true));
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    let health_database = database.clone();
    let health_storage = storage.clone();
    let health_running = healthy.clone();
    let router = axum::Router::new()
        .route("/health", axum::routing::get(|| async { axum::Json("ok") }))
        .route(
            "/ready",
            axum::routing::get(move || {
                let db = health_database.clone();
                let s3 = health_storage.clone();
                let running = health_running.clone();
                async move {
                    let (db, s3) = tokio::join!(db.ping(), s3.ping());
                    if db && s3.is_ok() && running.load(Ordering::Relaxed) {
                        axum::http::StatusCode::OK
                    } else {
                        axum::http::StatusCode::SERVICE_UNAVAILABLE
                    }
                }
            }),
        );
    let mut health_stop = stop_rx.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = health_stop.changed().await;
            })
            .await
    });
    let mut workers = tokio::task::JoinSet::new();
    for _ in 0..config.concurrency {
        let db = database.clone();
        let s3 = storage.clone();
        let ai = mapping.clone();
        let mut stop = stop_rx.clone();
        workers.spawn(async move {
            loop {
                if *stop.borrow() { break; }
                match db.claim().await {
                    Ok(Some(lease))=> { if !matches!(tokio::time::timeout(Duration::from_secs(75),process(&db,&s3,&ai,&lease)).await,Ok(Ok(()))) { let _=db.fail(&lease,"processing_failed").await; tracing::warn!(job=%lease.id,attempt=lease.attempt,"Job failed; fenced retry or dead letter retained"); } },
                    Ok(None)=>(),Err(_)=>tracing::warn!("Job queue temporarily unavailable"),
                }
                tokio::select! { _=stop.changed()=>break,_=tokio::time::sleep(Duration::from_millis(500))=>() }
            }
        });
    }
    tracing::info!(bind=%config.bind,concurrency=config.concurrency,"Kivo import worker listening");
    tokio::select! {
        _=shutdown_signal()=>(),
        result=workers.join_next()=>{tracing::error!(finished=result.is_some(),"Worker exited unexpectedly");}
    }
    healthy.store(false, Ordering::Relaxed);
    let _ = stop_tx.send(true);
    // Bound shutdown; unfinished jobs retain their lease and are recoverable.
    let _ = tokio::time::timeout(Duration::from_secs(45), async {
        while workers.join_next().await.is_some() {}
    })
    .await;
    workers.abort_all();
    let _ = server.await;
    database.close().await;
    Ok(())
}
async fn process(
    db: &kivo_postgres::Postgres,
    s3: &kivo_object_storage_s3::Storage,
    ai: &kivo_import_inference::Adapters,
    lease: &kivo_jobs::Lease,
) -> Result<(), kivo_integrations::Error> {
    let work = db.work(lease).await?;
    match lease.kind {
        Kind::WorkbookParse => {
            let bytes = s3
                .read_bytes(&work.file)
                .await
                .map_err(|_| kivo_integrations::Error::Unavailable)?;
            let filename = work.file.filename.clone();
            let decoded =
                tokio::task::spawn_blocking(move || kivo_workbook::parse(&filename, &bytes))
                    .await
                    .map_err(|_| kivo_integrations::Error::Unavailable)?;
            let mut book = match decoded {
                Ok(book) => book,
                Err(kivo_integrations::Error::Invalid(message)) => kivo_integrations::Workbook {
                    sheets: vec![],
                    findings: vec![kivo_integrations::Finding::block(
                        "unsupportedWorkbook",
                        message,
                        None,
                    )],
                    suggestion: None,
                    suggestion_provider: Provider::Manual,
                    fingerprint: String::new(),
                },
                Err(e) => return Err(e),
            };
            if work.import.provider != Provider::Manual && !book.sheets.is_empty() {
                db.work(lease).await?; // revoked/cancelled work cannot start an inference call.
                // At most one call per attempt. Failure remains manually reviewable.
                match ai.suggest(work.import.provider,&book).await {
                    Ok(hint)=>{book.suggestion=Some(hint);book.suggestion_provider=work.import.provider;},
                    Err(_)=>book.findings.push(kivo_integrations::Finding::warning("inferenceUnavailable","The model suggestion could not be confirmed. Review the deterministic mapping or select columns manually.")),
                }
            }
            db.parsed(lease, book).await
        }
        Kind::WorkbookExport => {
            let bytes = kivo_workbook::export_csv(&work.import)?;
            let file = s3
                .write_bytes(
                    lease.org_id,
                    lease.id,
                    "reconciled-plan.csv",
                    "text/csv",
                    bytes,
                )
                .await
                .map_err(|_| kivo_integrations::Error::Unavailable)?;
            db.exported(lease, &file).await
        }
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! { _=tokio::signal::ctrl_c()=>(), _=terminate.recv()=>() }
                return;
            }
            Err(_) => {
                tracing::warn!("Could not install termination signal; Ctrl+C remains available")
            }
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
