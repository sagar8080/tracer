use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Authentication required")]
    Unauthorized,
    #[error("You do not have permission for this workspace")]
    Forbidden,
    #[error("This record changed or is unavailable. Reload before editing.")]
    Conflict,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("{0}")]
    Unavailable(&'static str),
    #[error("Too many requests. Try again shortly.")]
    RateLimited(u64),
    #[error("File not found")]
    NotFound,
    #[error("Could not persist this change. Check related records and retry.")]
    Persistence { constraint: bool },
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::Conflict => StatusCode::CONFLICT,
            Self::Invalid(_) => StatusCode::UNPROCESSABLE_ENTITY,
            Self::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::RateLimited(_) => StatusCode::TOO_MANY_REQUESTS,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Persistence { constraint: true } => StatusCode::UNPROCESSABLE_ENTITY,
            Self::Persistence { constraint: false } => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = self.to_string();
        let mut response = (status, Json(serde_json::json!({"error":message}))).into_response();
        if let Self::RateLimited(seconds) = self
            && let Ok(value) = seconds.to_string().parse()
        {
            response.headers_mut().insert("retry-after", value);
        }
        response
    }
}

impl From<kivo_planning::Error> for ApiError {
    fn from(error: kivo_planning::Error) -> Self {
        match error {
            kivo_planning::Error::Forbidden => Self::Forbidden,
            kivo_planning::Error::Conflict => Self::Conflict,
            kivo_planning::Error::Invalid(message) => Self::Invalid(message),
            kivo_planning::Error::Persistence { constraint } => Self::Persistence { constraint },
        }
    }
}
impl From<kivo_files::Error> for ApiError {
    fn from(error: kivo_files::Error) -> Self {
        match error {
            kivo_files::Error::Forbidden => Self::Forbidden,
            kivo_files::Error::Conflict => Self::Conflict,
            kivo_files::Error::NotFound => Self::NotFound,
            kivo_files::Error::Invalid(message) => Self::Invalid(message),
            kivo_files::Error::Unavailable(message) => Self::Unavailable(message),
            kivo_files::Error::Persistence { constraint } => Self::Persistence { constraint },
        }
    }
}
impl From<kivo_rate_limit::Error> for ApiError {
    fn from(error: kivo_rate_limit::Error) -> Self {
        match error {
            kivo_rate_limit::Error::Unavailable(message) => Self::Unavailable(message),
        }
    }
}
impl From<kivo_identity::Error> for ApiError {
    fn from(e: kivo_identity::Error) -> Self {
        match e {
            kivo_identity::Error::Unauthorized => Self::Unauthorized,
            kivo_identity::Error::Unavailable => Self::Unavailable("Identity service unavailable"),
        }
    }
}
impl From<kivo_tenancy::Error> for ApiError {
    fn from(e: kivo_tenancy::Error) -> Self {
        match e {
            kivo_tenancy::Error::Forbidden => Self::Forbidden,
            kivo_tenancy::Error::Conflict => Self::Conflict,
            kivo_tenancy::Error::Invalid(m) => Self::Invalid(m),
            kivo_tenancy::Error::Unavailable => Self::Unavailable("Workspace service unavailable"),
        }
    }
}
impl From<kivo_realtime::Error> for ApiError {
    fn from(e: kivo_realtime::Error) -> Self {
        match e {
            kivo_realtime::Error::Forbidden => Self::Forbidden,
            kivo_realtime::Error::Unavailable => Self::Unavailable("Live updates unavailable"),
        }
    }
}
