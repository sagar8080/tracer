//! Upstash REST adapter. No authorization or scheduling correctness depends on Redis.
use crate::{Decision, Error, RateLimiter};
use reqwest::{Client, Url};
use serde_json::{Value, json};
use std::time::Duration;
use uuid::Uuid;

pub struct RedisConfig {
    pub url: Url,
    pub token: String,
    pub prefix: String,
    pub requests_per_minute: u64,
}

#[derive(Clone)]
pub struct Redis {
    client: Client,
    url: Url,
    token: String,
    prefix: String,
    limit: u64,
}

impl Redis {
    pub fn new(config: RedisConfig) -> anyhow::Result<Self> {
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(3))
                .connect_timeout(Duration::from_secs(2))
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .build()?,
            url: config.url,
            token: config.token,
            prefix: config.prefix,
            limit: config.requests_per_minute,
        })
    }

    async fn command(&self, command: Value) -> Result<Value, Error> {
        let response = self
            .client
            .post(self.url.clone())
            .bearer_auth(&self.token)
            .json(&command)
            .send()
            .await
            .map_err(|_| Error::Unavailable("Redis unavailable"))?;
        if !response.status().is_success() {
            return Err(Error::Unavailable("Redis unavailable"));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|_| Error::Unavailable("Invalid Redis response"))?;
        if body.get("error").is_some() {
            return Err(Error::Unavailable("Redis command failed"));
        }
        body.get("result")
            .cloned()
            .ok_or(Error::Unavailable("Invalid Redis response"))
    }
}
impl RateLimiter for Redis {
    async fn ping(&self) -> Result<(), Error> {
        if self.command(json!(["PING"])).await? != "PONG" {
            return Err(Error::Unavailable("Invalid Redis response"));
        }
        Ok(())
    }

    async fn check(&self, user: Uuid) -> Result<Decision, Error> {
        // One atomic script: no counter can be left without expiry after a crash.
        // Redis owns the window clock. Requests are never retried after ambiguous delivery.
        const SCRIPT: &str = "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 60) end; return {n, redis.call('TTL', KEYS[1])}";
        let result = self
            .command(json!([
                "EVAL",
                SCRIPT,
                "1",
                format!("{}:rate:{user}", self.prefix)
            ]))
            .await?;
        let count = result
            .get(0)
            .and_then(Value::as_u64)
            .ok_or(Error::Unavailable("Invalid Redis response"))?;
        let ttl = result
            .get(1)
            .and_then(Value::as_i64)
            .filter(|v| (0..=60).contains(v))
            .ok_or(Error::Unavailable("Invalid Redis response"))?;
        if count > self.limit {
            return Ok(Decision::Deny {
                retry_after_seconds: ttl.max(1) as u64,
            });
        }
        Ok(Decision::Allow)
    }
}
