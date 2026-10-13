use anyhow::{Context, bail};
use kivo_postgres::{DatabaseConfig, migration_connection};
use sqlx::Connection;
use std::path::Path;

fn load_config() -> anyhow::Result<DatabaseConfig> {
    if std::env::var("KIVO_LOAD_ENV").as_deref() != Ok("0") {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../api/.env");
        match dotenvy::from_path(path) {
            Ok(_) => (),
            Err(dotenvy::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => bail!("Could not parse apps/api/.env; check its dotenv syntax"),
        }
    }
    DatabaseConfig::from_lookup(|key| std::env::var(key).ok())
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    if std::env::args().len() != 1 {
        bail!("Usage: kivo-migrator");
    }
    let config = load_config()?;
    let mut connection = migration_connection(&config).await?;
    // SQLx retains a session advisory lock on this direct connection.
    sqlx::migrate!()
        .run(&mut connection)
        .await
        .context("run migrations")?;
    connection
        .close()
        .await
        .context("close migration connection")?;
    tracing::info!("PostgreSQL migrations complete");
    Ok(())
}
