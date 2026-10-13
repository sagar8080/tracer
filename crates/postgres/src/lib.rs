//! PostgreSQL adapters: SQL, pool ownership, locked authorization and audit writes.
mod connection;
mod error;
mod events;
mod files;
mod identity;
mod leave_requests;
mod onboarding;
mod planning;
mod realtime;
mod rows;
mod team;
mod tenancy;
mod time_tracking;
pub use connection::migration_connection;
use std::time::Duration;

// No Debug: connection URLs contain credentials.
pub struct DatabaseConfig {
    pub database_url: String,
    pub database_direct_url: Option<String>,
    pub database_max_connections: u32,
}
impl DatabaseConfig {
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let value = |key: &str| get(key).filter(|v| !v.trim().is_empty());
        let database_url =
            value("DATABASE_URL").ok_or_else(|| anyhow::anyhow!("DATABASE_URL is required"))?;
        let database_max_connections = match value("KIVO_DB_MAX_CONNECTIONS") {
            Some(v) => v
                .parse()
                .map_err(|_| anyhow::anyhow!("Invalid KIVO_DB_MAX_CONNECTIONS"))?,
            None => 5,
        };
        anyhow::ensure!(
            (1..=50).contains(&database_max_connections),
            "KIVO_DB_MAX_CONNECTIONS is outside its allowed range"
        );
        Ok(Self {
            database_url,
            database_direct_url: value("DATABASE_DIRECT_URL"),
            database_max_connections,
        })
    }
}
#[derive(Clone)]
pub struct Postgres {
    pool: sqlx::PgPool,
}
impl Postgres {
    pub async fn connect(config: &DatabaseConfig) -> anyhow::Result<Self> {
        Ok(Self {
            pool: connection::connect(config).await?,
        })
    }
    pub async fn ping(&self) -> bool {
        matches!(
            tokio::time::timeout(
                Duration::from_secs(5),
                sqlx::query("SELECT 1").execute(&self.pool)
            )
            .await,
            Ok(Ok(_))
        )
    }
    pub async fn close(&self) {
        self.pool.close().await;
    }
}
