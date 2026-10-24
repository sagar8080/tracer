use crate::Error;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
pub const MAX_FILE_BYTES: i64 = 10 * 1024 * 1024;
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Upload {
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
}

impl Upload {
    pub fn validate(&self) -> Result<(), Error> {
        if self.filename.trim().is_empty()
            || self.filename.len() > 120
            || !self
                .filename
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b" ._-".contains(&c))
            || self.filename.starts_with('.')
        {
            return Err(Error::Invalid(
                "Use a filename of 1-120 ASCII letters, digits, spaces, dots, underscores or hyphens; do not start with a dot",
            ));
        }
        if !(1..=MAX_FILE_BYTES).contains(&self.size_bytes) {
            return Err(Error::Invalid("Files must contain 1 byte to 10 MiB"));
        }
        if !matches!(
            self.content_type.as_str(),
            "text/csv"
                | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                | "application/json"
                | "application/pdf"
                | "image/png"
                | "image/jpeg"
                | "application/octet-stream"
        ) {
            return Err(Error::Invalid("Unsupported file content type"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub id: Uuid,
    pub org_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub status: String,
    #[serde(skip_serializing)]
    pub bucket: String,
    #[serde(skip_serializing)]
    pub object_key: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_path_traversal_header_injection_active_content_and_oversize() {
        for name in ["../secret", "a/b", "a\\b", "a\r\nX: y", "a\"b", ".hidden"] {
            assert!(
                Upload {
                    filename: name.into(),
                    content_type: "text/csv".into(),
                    size_bytes: 10
                }
                .validate()
                .is_err()
            );
        }
        let mut upload = Upload {
            filename: "plan.csv".into(),
            content_type: "text/csv".into(),
            size_bytes: MAX_FILE_BYTES,
        };
        assert!(upload.validate().is_ok());
        upload.size_bytes += 1;
        assert!(upload.validate().is_err());
        upload.size_bytes = 10;
        upload.content_type = "text/html".into();
        assert!(upload.validate().is_err());
    }
}
