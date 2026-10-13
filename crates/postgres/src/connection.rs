use crate::DatabaseConfig;
use anyhow::{Result, ensure};
use sqlx::{
    ConnectOptions, Connection, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
};
use std::{str::FromStr, time::Duration};

fn options(url: &str) -> Result<PgConnectOptions> {
    let mut options = PgConnectOptions::from_str(url)
        .map_err(|_| anyhow::anyhow!("Invalid PostgreSQL connection URL"))?;
    if !is_loopback(options.get_host()) {
        options = options.ssl_mode(PgSslMode::VerifyFull);
    }
    Ok(options.disable_statement_logging())
}

fn migration_options(runtime_url: &str, direct_url: Option<&str>) -> Result<PgConnectOptions> {
    let opts = options(direct_url.unwrap_or(runtime_url))?;
    ensure!(
        !opts.get_host().contains("-pooler."),
        "Migrations require DATABASE_DIRECT_URL with Neon's direct hostname, not the pooled hostname"
    );
    let runtime = options(runtime_url)?;
    ensure!(
        opts.get_database() == runtime.get_database()
            && opts.get_port() == runtime.get_port()
            && opts.get_host().replace("-pooler.", ".")
                == runtime.get_host().replace("-pooler.", "."),
        "DATABASE_DIRECT_URL and DATABASE_URL must target the same database and endpoint"
    );
    Ok(opts)
}

/// A direct session for the dedicated migrator. SQLx types remain inside the
/// infrastructure boundary; capability contracts never see this connection.
pub async fn migration_connection(config: &DatabaseConfig) -> Result<PgConnection> {
    let options = migration_options(&config.database_url, config.database_direct_url.as_deref())?;
    tokio::time::timeout(Duration::from_secs(30), PgConnection::connect_with(&options)).await
        .map_err(|_| anyhow::anyhow!("PostgreSQL migration connection timed out"))?
        .map_err(|_| anyhow::anyhow!("Could not connect to PostgreSQL for migrations; check DATABASE_DIRECT_URL and network access"))
}

pub(super) async fn connect(config: &DatabaseConfig) -> Result<PgPool> {
    let options = options(&config.database_url)?.statement_cache_capacity(0);
    PgPoolOptions::new()
        .min_connections(0)
        .max_connections(config.database_max_connections)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(60))
        .max_lifetime(Duration::from_secs(1800))
        .connect_with(options)
        .await
        .map_err(|_| {
            anyhow::anyhow!(
                "Could not connect to PostgreSQL; check DATABASE_URL and network access"
            )
        })
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_connections_verify_certificates_even_when_url_disables_tls() {
        let remote =
            options("postgres://user:secret@ep-test.neon.tech/kivo?sslmode=disable").unwrap();
        assert!(matches!(remote.get_ssl_mode(), PgSslMode::VerifyFull));
        assert!(matches!(
            options("postgres://localhost/kivo?sslmode=disable")
                .unwrap()
                .get_ssl_mode(),
            PgSslMode::Disable
        ));
    }

    #[test]
    fn migrations_require_direct_connection_to_the_same_endpoint_and_database() {
        let pooled = "postgres://runtime@ep-test-pooler.neon.tech/kivo";
        let direct = "postgres://migrator@ep-test.neon.tech/kivo";
        assert!(migration_options(pooled, Some(direct)).is_ok());
        assert!(migration_options(pooled, None).is_err());
        assert!(migration_options(pooled, Some(pooled)).is_err());
        assert!(migration_options(pooled, Some("postgres://ep-other.neon.tech/kivo")).is_err());
        assert!(migration_options(pooled, Some("postgres://ep-test.neon.tech/other")).is_err());
        assert!(
            migration_options(
                "postgres://localhost:5432/kivo",
                Some("postgres://localhost:5433/kivo")
            )
            .is_err()
        );
    }
}
