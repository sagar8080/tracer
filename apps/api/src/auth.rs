use crate::error::ApiError;
use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use kivo_identity::{Directory, Verifier};
use kivo_postgres::Postgres;
use kivo_tenancy::Actor;
#[derive(Clone)]
pub enum Authentication {
    Development { actor: Actor, token: String },
    Auth0(kivo_auth0::Auth0),
}
pub struct Context {
    pub actor: Actor,
    pub expires_at: DateTime<Utc>,
}
impl Authentication {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::Development { .. } => "development",
            Self::Auth0(_) => "auth0",
        }
    }
    pub async fn authenticate(
        &self,
        headers: &HeaderMap,
        db: &Postgres,
    ) -> Result<Context, ApiError> {
        let bearer = headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|h| h.strip_prefix("Bearer "))
            .ok_or(ApiError::Unauthorized)?;
        match self {
            Self::Development { actor, token } => {
                if bearer != token {
                    return Err(ApiError::Unauthorized);
                }
                Ok(Context {
                    actor: *actor,
                    expires_at: Utc::now() + chrono::Duration::hours(1),
                })
            }
            Self::Auth0(verifier) => {
                let identity = verifier.verify(bearer).await?;
                let actor = db.resolve(&identity).await?;
                Ok(Context {
                    actor,
                    expires_at: identity.expires_at,
                })
            }
        }
    }
}
