//! Auth0 RS256 access-token verification. Tokens and provider responses are never logged.
use chrono::{TimeZone, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use kivo_identity::{Error, Identity, Verifier};
use serde::Deserialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
pub struct Config {
    pub issuer: String,
    pub audience: String,
    pub allow_local_test: bool,
}
#[derive(Clone)]
pub struct Auth0 {
    inner: Arc<Inner>,
}
struct Inner {
    issuer: String,
    audience: String,
    client: reqwest::Client,
    keys: Mutex<Keys>,
}
struct Keys {
    value: Option<JwkSet>,
    attempted: Option<Instant>,
    expires: Option<Instant>,
}
#[derive(Clone, Deserialize)]
struct Claims {
    sub: String,
    exp: i64,
    #[serde(rename = "https://kivo.app/email")]
    email: Option<String>,
    #[serde(default, rename = "https://kivo.app/email_verified")]
    email_verified: bool,
}
impl Auth0 {
    pub fn new(config: Config) -> anyhow::Result<Self> {
        let url = url::Url::parse(&config.issuer)?;
        let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost"));
        anyhow::ensure!(
            url.scheme() == "https"
                || (cfg!(debug_assertions)
                    && config.allow_local_test
                    && local
                    && url.scheme() == "http"),
            "Auth0 issuer requires HTTPS"
        );
        anyhow::ensure!(
            url.host_str().is_some()
                && url.path() == "/"
                && url.query().is_none()
                && url.fragment().is_none()
                && url.username().is_empty()
                && url.password().is_none(),
            "Auth0 issuer must be an origin"
        );
        anyhow::ensure!(
            !config.audience.trim().is_empty(),
            "AUTH0_AUDIENCE is required"
        );
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            inner: Arc::new(Inner {
                issuer: url.to_string(),
                audience: config.audience,
                client,
                keys: Mutex::new(Keys {
                    value: None,
                    attempted: None,
                    expires: None,
                }),
            }),
        })
    }
}
impl Verifier for Auth0 {
    async fn verify(&self, token: &str) -> Result<Identity, Error> {
        if token.len() > 16384 {
            return Err(Error::Unauthorized);
        }
        let header = decode_header(token).map_err(|_| Error::Unauthorized)?;
        if header.alg != Algorithm::RS256 {
            return Err(Error::Unauthorized);
        }
        let kid = header
            .kid
            .filter(|k| !k.is_empty() && k.len() <= 256)
            .ok_or(Error::Unauthorized)?;
        let mut cache = self.inner.keys.lock().await;
        let known = cache.value.as_ref().is_some_and(|v| v.find(&kid).is_some());
        let fresh = cache.expires.is_some_and(|t| t > Instant::now());
        if !fresh || !known {
            if cache
                .attempted
                .is_some_and(|t| t.elapsed() < Duration::from_secs(5))
            {
                return Err(if fresh {
                    Error::Unauthorized
                } else {
                    Error::Unavailable
                });
            }
            // One bounded refresh per process per five seconds, including provider failures.
            cache.attempted = Some(Instant::now());
            let mut response = self
                .inner
                .client
                .get(format!("{}.well-known/jwks.json", self.inner.issuer))
                .send()
                .await
                .map_err(|_| Error::Unavailable)?
                .error_for_status()
                .map_err(|_| Error::Unavailable)?;
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| Error::Unavailable)? {
                if body.len() + chunk.len() > 128 * 1024 {
                    return Err(Error::Unavailable);
                }
                body.extend_from_slice(&chunk);
            }
            cache.value =
                Some(serde_json::from_slice::<JwkSet>(&body).map_err(|_| Error::Unavailable)?);
            cache.expires = Some(Instant::now() + Duration::from_secs(300));
        }
        let key = cache
            .value
            .as_ref()
            .and_then(|v| v.find(&kid))
            .ok_or(Error::Unauthorized)?;
        let key = DecodingKey::from_jwk(key).map_err(|_| Error::Unauthorized)?;
        drop(cache);
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[&self.inner.audience]);
        validation.set_issuer(&[&self.inner.issuer]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.validate_nbf = true;
        validation.leeway = 5;
        let claims = decode::<Claims>(token, &key, &validation)
            .map_err(|_| Error::Unauthorized)?
            .claims;
        if claims.sub.is_empty() || claims.sub.len() > 512 {
            return Err(Error::Unauthorized);
        }
        let email = claims
            .email
            .filter(|e| e.len() <= 254 && e.contains('@') && !e.chars().any(char::is_whitespace))
            .map(|e| e.to_lowercase());
        Ok(Identity {
            issuer: self.inner.issuer.clone(),
            subject: claims.sub,
            email_verified: email.is_some() && claims.email_verified,
            email,
            expires_at: Utc
                .timestamp_opt(claims.exp, 0)
                .single()
                .ok_or(Error::Unauthorized)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn issuer_configuration_never_allows_remote_plaintext_or_credentials() {
        for issuer in [
            "http://tenant.example/",
            "https://user:password@tenant.example/",
            "https://tenant.example/path",
            "https://tenant.example/?key=secret",
        ] {
            assert!(
                Auth0::new(Config {
                    issuer: issuer.into(),
                    audience: "kivo-api".into(),
                    allow_local_test: true
                })
                .is_err()
            );
        }
        assert!(
            Auth0::new(Config {
                issuer: "https://tenant.example/".into(),
                audience: "".into(),
                allow_local_test: false
            })
            .is_err()
        );
        assert!(
            Auth0::new(Config {
                issuer: "http://localhost:4455/".into(),
                audience: "kivo-api".into(),
                allow_local_test: false
            })
            .is_err()
        );
        assert_eq!(
            Auth0::new(Config {
                issuer: "http://localhost:4455/".into(),
                audience: "kivo-api".into(),
                allow_local_test: true
            })
            .is_ok(),
            cfg!(debug_assertions)
        );
    }
}
