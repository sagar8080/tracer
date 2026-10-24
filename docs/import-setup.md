# A1 spreadsheet onboarding setup

The database and private Neon Object Storage configuration are reused. Run `npm run db:migrate` for additive migration 0009, then run API, web, realtime and **`npm run dev:worker`**. The worker is a separate executable with its own configuration, bounded concurrency and shutdown; by default local development reads the server-only `apps/api/.env`. Set `KIVO_WORKER_ENV_FILE` for another local credentials file, or use `KIVO_LOAD_ENV=0` with deployment-injected variables.

Worker settings:

```dotenv
KIVO_WORKER_BIND=127.0.0.1:4002
KIVO_WORKER_CONCURRENCY=2
KIVO_DB_MAX_CONNECTIONS=5
```

The loopback health server exposes `/health` (process alive) and `/ready` (database/storage/current loops). It does not expose keys, source cells or signed URLs. API replicas do not migrate hosted databases; apply the separate migration first. The worker requires the same DATABASE_URL, KIVO_S3_BUCKET, KIVO_S3_PREFIX, AWS_ENDPOINT_URL_S3, AWS_REGION and storage credentials as the API. Upstash is optional and does not own queue correctness.

## Optional model mapping

Manual mapping needs no AI provider configuration. Enable any subset of providers by setting **both** its server API key and explicit supported model ID in API and worker environments:

```dotenv
# OpenAI Responses with structured output
# OPENAI_API_KEY=your-server-api-key
# KIVO_OPENAI_MODEL=your-structured-output-model-id

# Anthropic Claude Messages with structured output
# ANTHROPIC_API_KEY=your-server-api-key
# KIVO_CLAUDE_MODEL=your-structured-output-model-id

# Google Gemini generateContent with JSON-schema output
# GEMINI_API_KEY=your-server-api-key
# KIVO_GEMINI_MODEL=your-json-schema-model-id
```

No model is silently chosen. Incomplete key/model pairs leave that optional adapter disabled and manual planning available. Keep these keys out of `apps/web`, browser storage and NEXT_PUBLIC variables. API and worker must advertise/configure the same providers; restart both after changes. The UI requires explicit consent for each assisted import. Only worksheet names/headers and up to three bounded sample rows per sheet leave Kivo, capped at 16 KiB. Cell strings in the sample are capped at 160 characters. The model cannot request tools, access more files, create accounts or publish work. Its schema and column references are checked, and the reviewer confirms meaning/units/identities before publication. Mapping failure stays manually usable.

Each attempt makes at most one provider call with a 30-second request deadline and 2,000 output-token cap. An expired/crashed lease may retry, with a maximum of three queue attempts; this can incur up to three billed model calls. There is no claim of provider-side exactly-once billing. HTTP test-origin overrides only work in explicitly enabled loopback fixture mode; they are not production proxy settings.

Protocols were checked against official [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [Claude structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) and [Gemini generateContent](https://ai.google.dev/api/generate-content) docs. Account entitlements and the configured model's schema support still need a live smoke.

## Browser upload and limits

Open `/app` → workspace switcher → **Spreadsheet imports**. Owner/Admin/Planner can upload and review. Only Owner/Admin can create scheduled people; Planner must select existing people. New project budgets start at reconciled imported effort; prices/rates and staffing metadata require subsequent review. Scheduled people do not become users or receive grants.

The private bucket/gateway must permit signed browser uploads from the exact web origin. If configurable, allow PUT/GET/HEAD/OPTIONS and headers `content-type`, `if-none-match`, `x-amz-server-side-encryption`, plus the content-length header used by the signature. The browser supplies Content-Length from the File body. Use the origin actually configured in Auth0/APP_BASE_URL. Never make the bucket public to resolve CORS. Gateway CORS is separate from the API's origin checks.

Supported: CSV/XLSX, tabular allocations and weekly Monday matrices. Limits: 10 MiB source, 32 MiB expanded XLSX, eight sheets, 2,000 rows per worksheet, 64 columns, 64,000 workbook cells and 2,000 resulting allocations. A sheet's first populated row is its header; arbitrary header discovery is not supported. Reviewed mapping requests are bounded at 2 MiB. Individual cell text is capped at 1,000 bytes and total cell text at 4 MiB. Macros, legacy XLS, spreadsheet error values and huge sparse dimensions are rejected with visible findings. Merged cells block the selected worksheet; merged cells on other sheets remain visible warnings and are retained in the original. Cached formula results require acknowledgement; no recalculation occurs.

Dates use explicit ISO/month-first/day-first interpretation. ISO dates remain supported in either selected order. Total hours distribute exactly over working days into quarter-hour daily effort; a nonuniform remainder needs source correction rather than rounding. Time off produces explained overload warnings without discarding effort. Existing calendar defaults must be acknowledged; new people require seven explicit working-minute values. Source fields cannot import membership, grants, rates or permissions.

A refresh selects the same published source; changed stable row IDs preview updates/removals/additions. Without an ID column, person/project/start/end form a visible composite identity, so changing a date appears as removal plus addition. Any newer Kivo edit blocks that source refresh. Resolve it manually or use a separate source; Kivo never silently overwrites it. Staged imports can be cancelled before publication. Post-publication bulk undo remains future work.

Exports pin the published source snapshot and revision, escape spreadsheet formula injection and retain source-cell references. Download the original for unsupported sheets/formulas; the generated CSV is not arbitrary Excel round-trip synchronization. Export output is private and immutable; retries compare bytes before recording ready metadata. There is no automatic Excel/SharePoint sync.

## Verification

`npm run test:imports` exercises real local PostgreSQL/API/worker with storage and three model HTTP fixtures. Rust parser fixtures include XLSX formula/merged/macro/ZIP-bomb cases. `KIVO_IMPORT_BROWSER_QA=1 npm run test:imports` serves a disposable environment on 3002 until Ctrl+C, with no hosted env files copied. Test keys and data are isolated. Real customer workbooks, model accuracy, onboarding time, file retention cleanup, load benchmarks and operational deployment remain gates; fixture results must not be represented as those outcomes.
