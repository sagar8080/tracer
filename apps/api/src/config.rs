use anyhow::{Result, bail, ensure};
use kivo_object_storage_s3::S3Config;
use kivo_postgres::DatabaseConfig;
use kivo_rate_limit::upstash::RedisConfig;
use std::{path::Path, str::FromStr};
use url::Url;
use uuid::Uuid;

// Deliberately no Debug: these structs contain database and provider credentials.
pub struct Config {
    pub auth0: Option<kivo_auth0::Config>,
    pub bind: String,
    pub web_origin: String,
    pub database: DatabaseConfig,
    pub run_migrations: bool,
    pub user: Uuid,
    pub token: String,
    pub redis: Option<RedisConfig>,
    pub s3: Option<S3Config>,
}

impl Config {
    pub fn load() -> Result<Self> {
        if std::env::var("KIVO_LOAD_ENV").as_deref() != Ok("0") {
            let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(".env");
            match dotenvy::from_path(path) {
                Ok(_) => (),
                Err(dotenvy::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => bail!("Could not parse apps/api/.env; check its dotenv syntax"),
            }
        }
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let value = |key: &str| get(key).filter(|v| !v.trim().is_empty());
        let required = |key| value(key).ok_or_else(|| anyhow::anyhow!("{key} is required"));
        let mode = value("KIVO_AUTH_MODE").unwrap_or_else(|| "development".into());
        let auth0 = match mode.as_str() {
            "auth0" => Some(kivo_auth0::Config {
                issuer: required("AUTH0_ISSUER")?,
                audience: required("AUTH0_AUDIENCE")?,
                allow_local_test: value("KIVO_AUTH0_LOCAL_TEST").as_deref() == Some("1"),
            }),
            "development" => {
                ensure!(
                    value("KIVO_ALLOW_DEV_AUTH").as_deref() == Some("1"),
                    "Development authentication requires KIVO_ALLOW_DEV_AUTH=1"
                );
                None
            }
            _ => bail!("KIVO_AUTH_MODE must be auth0 or development"),
        };
        let token = if auth0.is_none() {
            let token = required("KIVO_DEV_TOKEN")?;
            ensure!(
                token.len() >= 32,
                "KIVO_DEV_TOKEN must be at least 32 characters"
            );
            token
        } else {
            String::new()
        };
        let bind = value("KIVO_API_BIND").unwrap_or_else(|| "127.0.0.1:4000".into());
        let address: std::net::SocketAddr = bind
            .parse()
            .map_err(|_| anyhow::anyhow!("Invalid KIVO_API_BIND"))?;
        ensure!(
            auth0.is_some() || address.ip().is_loopback(),
            "Development authentication requires a loopback bind"
        );
        ensure!(
            value("KIVO_AUTH0_LOCAL_TEST").as_deref() != Some("1") || address.ip().is_loopback(),
            "Auth0 test issuer requires a loopback bind"
        );
        let redis = match (
            value("UPSTASH_REDIS_REST_URL"),
            value("UPSTASH_REDIS_REST_TOKEN"),
        ) {
            (None, None) => None,
            (Some(url), Some(token)) => Some(RedisConfig {
                url: service_url(&url)?,
                token,
                prefix: namespace(value("KIVO_REDIS_PREFIX").unwrap_or_else(|| "kivo:dev".into()))?,
                requests_per_minute: number(
                    value("KIVO_RATE_LIMIT_PER_MINUTE"),
                    120,
                    1,
                    100_000,
                    "KIVO_RATE_LIMIT_PER_MINUTE",
                )?,
            }),
            _ => bail!("Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither"),
        };
        let s3 = if let Some(bucket) = value("KIVO_S3_BUCKET") {
            ensure!(
                (3..=63).contains(&bucket.len())
                    && bucket.bytes().all(|c| c.is_ascii_lowercase()
                        || c.is_ascii_digit()
                        || b".-".contains(&c)),
                "KIVO_S3_BUCKET must be a standard S3 bucket name"
            );
            let endpoint = match (value("KIVO_S3_ENDPOINT_URL"), value("AWS_ENDPOINT_URL_S3")) {
                (Some(_), Some(_)) => {
                    bail!("Set only one of KIVO_S3_ENDPOINT_URL and AWS_ENDPOINT_URL_S3")
                }
                (Some(local), None) => {
                    let url = service_url(&local)?;
                    ensure!(
                        is_loopback(url.host_str().unwrap_or_default()),
                        "KIVO_S3_ENDPOINT_URL is only for loopback test storage"
                    );
                    Some(url)
                }
                (None, Some(remote)) => {
                    let url = service_url(&remote)?;
                    ensure!(
                        url.scheme() == "https",
                        "AWS_ENDPOINT_URL_S3 requires HTTPS"
                    );
                    Some(url)
                }
                (None, None) => None,
            };
            Some(S3Config {
                bucket,
                region: required("AWS_REGION")?,
                prefix: namespace(value("KIVO_S3_PREFIX").unwrap_or_else(|| "kivo-dev".into()))?,
                endpoint,
            })
        } else {
            ensure!(
                value("KIVO_S3_ENDPOINT_URL").is_none() && value("AWS_ENDPOINT_URL_S3").is_none(),
                "A storage endpoint requires KIVO_S3_BUCKET"
            );
            None
        };
        let web_origin = value("KIVO_WEB_ORIGIN").unwrap_or_else(|| "http://127.0.0.1:3000".into());
        let origin = service_url(&web_origin)?;
        ensure!(
            origin.path() == "/" && origin.query().is_none() && origin.fragment().is_none(),
            "KIVO_WEB_ORIGIN must be an origin without a path"
        );
        Ok(Self {
            auth0,
            bind,
            web_origin: origin.origin().ascii_serialization(),
            database: DatabaseConfig::from_lookup(&get)?,
            run_migrations: match value("KIVO_RUN_MIGRATIONS").as_deref() {
                None => mode == "development",
                Some("1") => true,
                Some("0") => false,
                _ => bail!("KIVO_RUN_MIGRATIONS must be 0 or 1"),
            },
            user: Uuid::parse_str(
                &value("KIVO_DEV_USER_ID")
                    .unwrap_or_else(|| "00000000-0000-4000-8000-000000000002".into()),
            )
            .map_err(|_| anyhow::anyhow!("KIVO_DEV_USER_ID must be a UUID"))?,
            token,
            redis,
            s3,
        })
    }
}

pub fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

fn service_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| anyhow::anyhow!("Invalid provider endpoint URL"))?;
    ensure!(
        url.scheme() == "https"
            || (url.scheme() == "http" && is_loopback(url.host_str().unwrap_or_default())),
        "Provider endpoints require HTTPS (HTTP allowed only on loopback for tests)"
    );
    ensure!(
        url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url.path() == "/",
        "Provider endpoint must be an origin without credentials, path or query"
    );
    Ok(url)
}

fn namespace(value: String) -> Result<String> {
    ensure!(
        !value.is_empty()
            && value.len() <= 64
            && value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_:".contains(&c)),
        "Service prefixes must contain only letters, digits, hyphens, underscores or colons (1-64 characters)"
    );
    Ok(value)
}

fn number<T: FromStr + PartialOrd>(
    raw: Option<String>,
    default: T,
    min: T,
    max: T,
    key: &str,
) -> Result<T> {
    let n = match raw {
        Some(v) => v.parse().map_err(|_| anyhow::anyhow!("Invalid {key}"))?,
        None => default,
    };
    ensure!(n >= min && n <= max, "{key} is outside its allowed range");
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn auth0_never_falls_back_to_a_configured_development_token() {
        let mut values = HashMap::from([
            ("KIVO_AUTH_MODE", "auth0".to_owned()),
            ("KIVO_ALLOW_DEV_AUTH", "1".to_owned()),
            ("KIVO_DEV_TOKEN", "x".repeat(32)),
            ("DATABASE_URL", "postgres://localhost/kivo".to_owned()),
        ]);
        assert!(Config::from_lookup(|k| values.get(k).cloned()).is_err());
        values.insert("AUTH0_ISSUER", "https://tenant.example/".into());
        values.insert("AUTH0_AUDIENCE", "kivo-api".into());
        let config = Config::from_lookup(|k| values.get(k).cloned()).unwrap();
        assert!(config.auth0.is_some());
        assert!(config.token.is_empty());
        assert!(!config.run_migrations);
        values.insert("KIVO_AUTH_MODE", "unknown".into());
        assert!(Config::from_lookup(|k| values.get(k).cloned()).is_err());
    }

    #[test]
    fn optional_services_are_explicit_and_secrets_stay_out_of_errors() {
        let mut values = HashMap::from([
            ("KIVO_ALLOW_DEV_AUTH", "1".to_owned()),
            ("KIVO_DEV_TOKEN", "x".repeat(32)),
            ("DATABASE_URL", "postgres://localhost/kivo".to_owned()),
        ]);
        assert!(Config::from_lookup(|k| values.get(k).cloned()).is_ok());
        values.insert("UPSTASH_REDIS_REST_TOKEN", "test-secret".into());
        let error = Config::from_lookup(|k| values.get(k).cloned())
            .err()
            .unwrap()
            .to_string();
        assert!(!error.contains("test-secret"));
        assert!(error.contains("both"));
        values.insert("UPSTASH_REDIS_REST_URL", "http://remote.example".into());
        assert!(Config::from_lookup(|k| values.get(k).cloned()).is_err());
        values.insert("UPSTASH_REDIS_REST_URL", "https://redis.example".into());
        assert!(Config::from_lookup(|k| values.get(k).cloned()).is_ok());
        values.insert("KIVO_S3_BUCKET", "kivo-test".into());
        assert!(Config::from_lookup(|k| values.get(k).cloned()).is_err());
    }

    #[test]
    fn s3_compatible_endpoints_are_explicit_secure_and_unambiguous() {
        let mut values = HashMap::from([
            ("KIVO_ALLOW_DEV_AUTH", "1".to_owned()),
            ("KIVO_DEV_TOKEN", "x".repeat(32)),
            ("DATABASE_URL", "postgres://localhost/kivo".to_owned()),
            ("KIVO_S3_BUCKET", "kivo-test".to_owned()),
            ("AWS_REGION", "us-east-2".to_owned()),
            ("AWS_ENDPOINT_URL_S3", "https://storage.example".to_owned()),
        ]);
        let config = Config::from_lookup(|k| values.get(k).cloned()).unwrap();
        assert_eq!(
            config.s3.unwrap().endpoint.unwrap().host_str(),
            Some("storage.example")
        );
        values.insert("KIVO_S3_ENDPOINT_URL", "http://127.0.0.1:9999".into());
        assert!(Config::from_lookup(|k| values.get(k).cloned()).is_err());
        values.remove("KIVO_S3_ENDPOINT_URL");
        values.insert("AWS_ENDPOINT_URL_S3", "http://storage.example".into());
        assert!(Config::from_lookup(|k| values.get(k).cloned()).is_err());
    }
}
