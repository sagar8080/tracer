#[derive(Debug, thiserror::Error)]
pub(super) enum Error {
    #[error("Permission denied")]
    Forbidden,
    #[error("Version conflict")]
    Conflict,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("File not found")]
    NotFound,
    #[error("Database unavailable")]
    Database(#[from] sqlx::Error),
}
fn constraint(error: sqlx::Error) -> bool {
    tracing::error!(error=%error, "database operation failed");
    error
        .as_database_error()
        .and_then(|e| e.code())
        .is_some_and(|code| matches!(code.as_ref(), "23503" | "23514" | "23505"))
}
impl From<Error> for kivo_planning::Error {
    fn from(error: Error) -> Self {
        match error {
            Error::Forbidden => Self::Forbidden,
            Error::Conflict | Error::NotFound => Self::Conflict,
            Error::Invalid(message) => Self::Invalid(message),
            Error::Database(error) => Self::Persistence {
                constraint: constraint(error),
            },
        }
    }
}
impl From<Error> for kivo_files::Error {
    fn from(error: Error) -> Self {
        match error {
            Error::Forbidden => Self::Forbidden,
            Error::NotFound => Self::NotFound,
            Error::Invalid(message) => Self::Invalid(message),
            Error::Conflict => Self::Conflict,
            Error::Database(error) => Self::Persistence {
                constraint: constraint(error),
            },
        }
    }
}
impl From<Error> for kivo_tenancy::Error {
    fn from(e: Error) -> Self {
        match e {
            Error::Forbidden => Self::Forbidden,
            Error::Conflict | Error::NotFound => Self::Conflict,
            Error::Invalid(m) => Self::Invalid(m),
            Error::Database(e) => {
                constraint(e);
                Self::Unavailable
            }
        }
    }
}
impl From<Error> for kivo_realtime::Error {
    fn from(e: Error) -> Self {
        match e {
            Error::Database(e) => {
                constraint(e);
                Self::Unavailable
            }
            _ => Self::Forbidden,
        }
    }
}
