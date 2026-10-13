use aws_sdk_s3::{
    Client,
    config::{BehaviorVersion, Region, retry::RetryConfig, timeout::TimeoutConfig},
    presigning::{PresignedRequest, PresigningConfig},
};
use kivo_files::{Error, ObjectLocation, ObjectStore, SignedRequest};
use std::time::Duration;
use url::Url;
use uuid::Uuid;

const URL_TTL: u64 = 300;

#[derive(Clone)]
pub struct Storage {
    client: Client,
    bucket: String,
    prefix: String,
}

// Credentials are resolved by the SDK; never expose SDK types through the port.
pub struct S3Config {
    pub bucket: String,
    pub region: String,
    pub prefix: String,
    pub endpoint: Option<Url>,
}

impl Storage {
    pub async fn new(config: S3Config) -> Self {
        let sdk = aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new(config.region))
            .retry_config(RetryConfig::standard().with_max_attempts(2))
            .timeout_config(
                TimeoutConfig::builder()
                    .operation_timeout(Duration::from_secs(10))
                    .build(),
            )
            .load()
            .await;
        let mut builder = aws_sdk_s3::config::Builder::from(&sdk);
        if let Some(endpoint) = config.endpoint {
            // S3-compatible gateways (including Neon) require /bucket/key routing.
            builder = builder
                .endpoint_url(endpoint.as_str())
                .force_path_style(true);
        }
        Self {
            client: Client::from_conf(builder.build()),
            bucket: config.bucket,
            prefix: config.prefix,
        }
    }

    pub fn key(&self, org: Uuid, file: Uuid) -> String {
        format!("{}/organizations/{org}/files/{file}", self.prefix)
    }
}
impl ObjectStore for Storage {
    fn location(&self, org: Uuid, id: Uuid) -> ObjectLocation {
        ObjectLocation {
            bucket: self.bucket.clone(),
            key: self.key(org, id),
        }
    }
    async fn ping(&self) -> Result<(), Error> {
        self.client
            .head_bucket()
            .bucket(&self.bucket)
            .send()
            .await
            .map_err(|_| Error::Unavailable("S3 unavailable"))?;
        Ok(())
    }

    async fn upload(
        &self,
        key: &str,
        content_type: &str,
        size: i64,
    ) -> Result<SignedRequest, Error> {
        let request = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .content_length(size)
            .if_none_match("*")
            .server_side_encryption(aws_sdk_s3::types::ServerSideEncryption::Aes256)
            .presigned(presigning_config()?)
            .await
            .map_err(|_| Error::Unavailable("Could not sign S3 upload"))?;
        Ok(signed(request))
    }

    async fn verify(
        &self,
        bucket: &str,
        key: &str,
        content_type: &str,
        size: i64,
    ) -> Result<(), Error> {
        let object = self
            .client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| {
                if e.as_service_error().is_some_and(|e| e.is_not_found()) {
                    Error::Invalid("Upload is not present in S3 yet")
                } else {
                    Error::Unavailable("Could not verify S3 upload")
                }
            })?;
        if object.content_length() != Some(size) || object.content_type() != Some(content_type) {
            return Err(Error::Invalid(
                "Uploaded file size or content type does not match its reservation",
            ));
        }
        Ok(())
    }

    async fn download(
        &self,
        bucket: &str,
        key: &str,
        filename: &str,
    ) -> Result<SignedRequest, Error> {
        let request = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .response_content_disposition(format!("attachment; filename=\"{filename}\""))
            .response_cache_control("private, no-store")
            .presigned(presigning_config()?)
            .await
            .map_err(|_| Error::Unavailable("Could not sign S3 download"))?;
        Ok(signed(request))
    }
}

fn presigning_config() -> Result<PresigningConfig, Error> {
    PresigningConfig::expires_in(Duration::from_secs(URL_TTL))
        .map_err(|_| Error::Unavailable("Could not configure S3 signing"))
}

fn signed(request: PresignedRequest) -> SignedRequest {
    SignedRequest {
        url: request.uri().to_owned(),
        method: request.method().to_string(),
        headers: request
            .headers()
            .filter(|(name, _)| *name != "host")
            .map(|(name, value)| (name.to_owned(), value.to_owned()))
            .collect(),
        expires_in_seconds: URL_TTL,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    #[tokio::test]
    async fn signatures_bind_upload_size_type_and_no_overwrite_condition() {
        let config = aws_sdk_s3::config::Builder::new()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new("us-east-1"))
            .credentials_provider(aws_sdk_s3::config::Credentials::new(
                "test-key",
                "test-secret",
                None,
                None,
                "test",
            ))
            .build();
        let storage = Storage {
            client: Client::from_conf(config),
            bucket: "kivo-test".into(),
            prefix: "test".into(),
        };
        let key = storage.key(Uuid::nil(), Uuid::from_u128(1));
        let upload = storage.upload(&key, "text/csv", 123).await.unwrap();
        let url = url::Url::parse(&upload.url).unwrap();
        let params: BTreeMap<_, _> = url.query_pairs().collect();
        let headers = params.get("X-Amz-SignedHeaders").unwrap();
        for header in [
            "content-length",
            "content-type",
            "if-none-match",
            "x-amz-server-side-encryption",
        ] {
            assert!(headers.split(';').any(|v| v == header), "unsigned {header}");
        }
        assert_eq!(upload.headers["if-none-match"], "*");
        assert_eq!(upload.headers["content-length"], "123");
        assert_eq!(upload.expires_in_seconds, 300);
        assert!(url.path().ends_with(&key));
    }
}
