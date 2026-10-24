use anyhow::{Result, ensure};
use kivo_object_storage_s3::S3Config;
use kivo_postgres::DatabaseConfig;
use url::Url;
pub struct Config {
    pub database: DatabaseConfig,
    pub storage: S3Config,
    pub inference: kivo_import_inference::Config,
    pub bind: String,
    pub concurrency: usize,
}
impl Config {
    pub fn load() -> Result<Self> {
        if std::env::var("KIVO_LOAD_ENV").as_deref() != Ok("0") {
            // Development shares the explicitly documented server-only credentials file.
            let file = std::env::var("KIVO_WORKER_ENV_FILE")
                .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../api/.env").into());
            dotenvy::from_path(file)
                .map_err(|_| anyhow::anyhow!("Could not load worker environment"))?;
        }
        Self::from_lookup(|k| std::env::var(k).ok())
    }
    fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let value = |k| get(k).filter(|s| !s.trim().is_empty());
        let required =
            |k| value(k).ok_or_else(|| anyhow::anyhow!("{k} is required for the worker"));
        let bucket = required("KIVO_S3_BUCKET")?;
        ensure!(
            (3..=63).contains(&bucket.len())
                && bucket
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b".-".contains(&b)),
            "Invalid worker bucket"
        );
        let prefix = value("KIVO_S3_PREFIX").unwrap_or_else(|| "kivo-dev".into());
        ensure!(
            !prefix.is_empty()
                && prefix.len() <= 64
                && prefix
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b)),
            "Invalid worker object prefix"
        );
        let endpoint = match (value("KIVO_S3_ENDPOINT_URL"), value("AWS_ENDPOINT_URL_S3")) {
            (None, None) => None,
            (Some(_), Some(_)) => anyhow::bail!("Configure one S3 endpoint"),
            (local, remote) => {
                let is_local = local.is_some();
                let raw = local
                    .or(remote)
                    .ok_or_else(|| anyhow::anyhow!("Missing S3 endpoint"))?;
                let url = Url::parse(&raw).map_err(|_| anyhow::anyhow!("Invalid S3 endpoint"))?;
                ensure!(
                    url.username().is_empty()
                        && url.password().is_none()
                        && url.path() == "/"
                        && url.query().is_none()
                        && url.fragment().is_none(),
                    "S3 endpoint must be an origin"
                );
                ensure!(
                    if is_local {
                        url.scheme() == "http"
                            && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
                    } else {
                        url.scheme() == "https"
                    },
                    "Invalid S3 endpoint scheme/host"
                );
                Some(url)
            }
        };
        let bind = value("KIVO_WORKER_BIND").unwrap_or_else(|| "127.0.0.1:4002".into());
        let address: std::net::SocketAddr = bind.parse()?;
        ensure!(
            address.ip().is_loopback(),
            "Worker health must bind to loopback"
        );
        let concurrency = value("KIVO_WORKER_CONCURRENCY")
            .unwrap_or_else(|| "2".into())
            .parse::<usize>()?;
        ensure!(
            (1..=4).contains(&concurrency),
            "Worker concurrency must be 1–4"
        );
        Ok(Self {
            database: DatabaseConfig::from_lookup(&get)?,
            storage: S3Config {
                bucket,
                region: required("AWS_REGION")?,
                prefix,
                endpoint,
            },
            inference: kivo_import_inference::Config::from_lookup(&get)?,
            bind,
            concurrency,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_explicit_storage_and_bounds_concurrency() {
        assert!(Config::from_lookup(|_| None).is_err());
    }
}
