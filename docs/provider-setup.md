# Backend provider setup

The backend integrates Neon PostgreSQL through SQLx, Upstash Redis through its HTTPS REST API, and private Neon Object Storage through its S3-compatible API using the AWS Rust SDK. These are the selected hosted services. Hosted resources are not provisioned by this repository. The API defaults to explicit loopback development authentication; configure [Auth0 and shared workspaces](auth0-setup.md) for real accounts. Provider connectivity alone is not a deployment validation.

## 1. Backend environment

From the repository root, copy `apps/api/.env.example` to `apps/api/.env` if the destination does not already exist. Generate a development token with `openssl rand -hex 32` and replace `KIVO_DEV_TOKEN`. The API loads this specific dotenv file regardless of the working directory; existing shell variables take precedence. `KIVO_LOAD_ENV=0` disables file loading for isolated tests.

Keep all provider credentials in the backend environment. `.env` files are ignored by Git. Do not put them in the browser, `NEXT_PUBLIC_*` variables, or chat messages.

## 2. Neon PostgreSQL

Create a development project/branch and database in [Neon](https://console.neon.tech). PostgreSQL 17 matches local development. Choose a region close to the future API host, Upstash database, and S3 bucket.

Copy both connection strings for the **same branch endpoint and database**:

| Variable                  | Value                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`            | Pooled PostgreSQL URL: hostname contains `-pooler`                                         |
| `DATABASE_DIRECT_URL`     | Direct PostgreSQL URL: hostname has no `-pooler`                                           |
| `KIVO_DB_MAX_CONNECTIONS` | `5` initially, per API process                                                             |
| `KIVO_RUN_MIGRATIONS`     | `1` for automatic development startup migrations; `0` after applying migrations separately |

Use URLs of the form `postgresql://ROLE:PASSWORD@HOST/DATABASE?sslmode=verify-full`, with URL-encoded credentials. Remote database connections enforce certificate and hostname verification even if the supplied URL requests weaker TLS. Local loopback PostgreSQL remains supported.

If a Neon credentials export supplies a direct `DATABASE_URL` and a separate `DATABASE_URL_POOLED`, map the direct value to `DATABASE_DIRECT_URL` and the pooled value to `DATABASE_URL`. `NEON_AUTH_BASE_URL` is not used; Auth0 is the selected identity provider.

Migrations use a direct connection because SQLx migration locks are session-scoped. Runtime connections have a bounded pool, short idle retention, and disabled prepared-statement caching for transaction-pool compatibility. See [Neon's pooling guidance](https://neon.com/docs/connect/connection-pooling).

The migration role needs permission to create and alter the schema. For this development experiment, both URLs can use the same role. Runtime and migration roles can be separated later.

Apply migrations independently:

```sh
cargo run --locked -p kivo-migrator
```

The migrator loads the same development dotenv file but reads only database settings; it does not require API authentication or optional provider configuration. `KIVO_RUN_MIGRATIONS=1` (the local default) and the existing `kivo-api migrate` command launch the sibling `kivo-migrator` executable, so build both with `cargo build --locked --workspace` first. Missing/failed migrators abort startup. For separate deployment steps, run the migrator once and set `KIVO_RUN_MIGRATIONS=0` on API instances.

This applies the scheduling schema, private-file metadata, and working-calendar/time-off tables. It does not import browser demo data. Keep migrations serialized as a deployment step when the API has multiple instances.

## 3. Upstash Redis

Create a Redis database on the Free plan in the [Upstash console](https://console.upstash.com). Copy the HTTPS REST URL and **read/write** REST token:

```dotenv
UPSTASH_REDIS_REST_URL=https://YOUR-DATABASE.upstash.io
UPSTASH_REDIS_REST_TOKEN=YOUR-READ-WRITE-TOKEN
KIVO_REDIS_PREFIX=kivo:dev
KIVO_RATE_LIMIT_PER_MINUTE=120
```

Use a different prefix for each environment. Both connection variables must be supplied together. Omitting both disables Redis locally; partial configuration fails startup.

The first consumer is a distributed rate limiter for authenticated application requests. A Lua operation increments a user counter and sets its expiry atomically. The 60-second window starts with the first request. Over-limit requests return `429` with `Retry-After`; configured Redis failures return `503` without executing a business mutation. The HTTP client uses short timeouts and no redirects or automatic retries. Health/readiness checks do not increment the rate counter.

This uses several Redis commands per request, so watch the Free plan's command allowance. It does not implement workspace caching, presence or WebSocket fan-out yet. See [Upstash REST semantics](https://upstash.com/docs/redis/features/restapi).

## 4. Neon Object Storage

Use a **private bucket** on the experiment's Neon branch. Copy its storage endpoint, region and Neon-issued credentials into the backend environment. Keep the endpoint, bucket and credentials associated with the same branch:

```dotenv
KIVO_S3_BUCKET=YOUR-PRIVATE-BUCKET
AWS_ENDPOINT_URL_S3=https://YOUR-BRANCH-STORAGE-ENDPOINT
AWS_REGION=YOUR-NEON-STORAGE-REGION
AWS_ACCESS_KEY_ID=YOUR-NEON-ACCESS-KEY
AWS_SECRET_ACCESS_KEY=YOUR-NEON-SECRET-KEY
KIVO_S3_PREFIX=kivo-dev
```

Set `KIVO_S3_BUCKET` to the `S3_BUCKET` value supplied by Neon. The `AWS_*` variable names are SDK conventions for the S3 protocol; their values come from Neon. Use the exact endpoint and region from the credentials export.

The backend validates the HTTPS endpoint and uses path-style `/bucket/key` addressing. Leave `KIVO_S3_ENDPOINT_URL` unset: it is a separate loopback-only test override and cannot be combined with `AWS_ENDPOINT_URL_S3`.

Manage bucket privacy and access through Neon, keeping the bucket private. See [Neon's storage implementation](https://neon.com/blog/building-neon-object-storage).

The current frontend has no file interface. Browser upload/download behavior and allowed-origin configuration must be verified when that interface is implemented; the live API smoke test does not establish browser CORS behavior.

## 5. Start and verify

```sh
RUST_LOG=info npm run dev:api
```

In another terminal:

```sh
npm run check:providers
```

The check reads the backend token locally and calls authenticated `GET /ready`. It reports PostgreSQL `SELECT 1`, Redis `PING`, and S3 `HeadBucket` status without printing secrets. It exits unsuccessfully if any provider is unavailable or disabled. `GET /health` remains a process-liveness check. Avoid frequent readiness polling on small free tiers because checks consume provider requests and can wake database compute.

Successful readiness establishes connectivity, not S3 write permissions or a complete cloud integration test. Verify the file flow below against the configured bucket as a separate smoke test.

For the existing scheduling UI, set `apps/web/.env.local` to `NEXT_PUBLIC_STORAGE_MODE=api`, `KIVO_ALLOW_DEV_AUTH=1`, and the same `KIVO_DEV_TOKEN`; then restart Next.js. Only the development token belongs in that server-side proxy environment, never the provider credentials.

## Private-file API

All calls below require `Authorization: Bearer <access-token>` in Auth0 mode, or the explicit local development token in development mode. Include a UUID `Idempotency-Key` on reservation requests to safely retry them. Use an organization ID from `GET /v1/workspace`.

1. `POST /v1/organizations/{orgId}/files` with `{"filename":"schedule.csv","contentType":"text/csv","sizeBytes":7}` returns `201`, `fileId`, and an `upload` object containing `url`, `method`, `headers`, and `expiresInSeconds`.
2. Send the exact bytes to that URL using its method and headers. Do not forward the API's bearer token to S3. In a future browser client, omit the manually set `content-length` header: the browser derives it from the exact Blob body. Other returned headers must be preserved.
3. `POST /v1/organizations/{orgId}/files/{fileId}/complete` checks the actual S3 size and content type, then marks the file ready. Repeated completion is idempotent.
4. `POST /v1/organizations/{orgId}/files/{fileId}/download` returns a short-lived GET URL only for a ready file. Downloads use attachment disposition and private/no-store caching.

Owner, admin and planner roles can reserve/complete uploads; any current organization member can request a download. Object keys are generated by the server under `PREFIX/organizations/ORG_ID/files/FILE_ID`; callers cannot choose another tenant's key. Metadata and audit events stay in PostgreSQL. New URL requests check current membership; an already issued URL is a bearer capability until its expiry (up to five minutes, subject to credential lifetime).

Files are limited to 10 MiB. Supported content types are CSV, JSON, PDF, PNG, JPEG and generic binary. Filename validation prevents path/header injection. Upload signatures bind exact length, content type and `If-None-Match: *`, preventing reuse to overwrite an existing object. The MIME check compares S3 metadata; it is not malware scanning or content inspection. See [AWS Rust presigning](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/presigned-urls.html) and [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

This first slice does not yet provide file listing/deletion, abandoned-upload cleanup, multipart uploads, antivirus scanning, per-tenant byte quotas, or a browser file interface. Failed/abandoned reservations can leave pending metadata or objects; use a dedicated experiment bucket and inspect these manually until cleanup is implemented. An expired upload URL requires a new reservation.

## Local verification

```sh
cargo test --locked --workspace
npm run test:api
npm run test:providers
```

Run the two API suites sequentially: they own the same local ports. Both build the root Cargo workspace before starting temporary PostgreSQL. The provider suite supplies local HTTP fixtures and fake credentials, disables dotenv loading, and removes inherited provider credentials. It also upgrades an existing v2 schema, retains its records and ledger, checks frozen SQL checksums, rejects drift, and tests idempotent migrator reruns. It tests the transport contracts and application behavior; it does not validate permissions or signatures at Neon, execute Redis Lua, or establish connectivity to your Neon branch. See [validation evidence](validation.md) for the separately executed live provider checks.
