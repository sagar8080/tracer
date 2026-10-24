# A1 — reviewed spreadsheet onboarding

Cycle A1 implements AGT09–AGT10, EXT01 and the first DIF06 slice. A planner uploads a private CSV or XLSX, chooses manual mapping or an explicitly consented OpenAI/Claude/Gemini suggestion, reviews identities, calendars and effort, inspects a dry run and publishes a reconciled schedule. A refreshed file uses the same source identity and previews additions, changes and removals. Export is a pinned CSV; the original workbook remains available, preserving unsupported sheets and formulas.

## Ownership and boundaries

- `kivo-integrations`: typed import/source/mapping/reconciliation contracts and deterministic schedule evaluation; no file parser, HTTP, SQL or model SDK.
- `kivo-workbook`: bounded CSV/XLSX parser, source cells, formula/merged-cell findings, deterministic header suggestions and CSV output.
- `kivo-import-inference`: replaceable mapping port with three explicit provider adapters. No business mutations, tools or authority.
- `kivo-jobs`: durable lease and retry contracts. `kivo-postgres` implements the queue and import repositories.
- `apps/worker`: separate executable, server configuration, bounded concurrency, health and graceful shutdown. Parses files and produces private exports outside database locks.
- `apps/api`: human HTTP transport. `features/imports`: upload, mapping, reconciliation and publication UI on Quiet Canvas.

## Input contract and safety

Initial limits: 10 MiB compressed source, 32 MiB expanded XLSX, eight worksheets, 2,000 data rows per selected sheet, 64 columns, 64,000 populated cells and 2,000 resulting allocations. Macros and merged-cell ambiguity block mapping. Formula caches require explicit acknowledgement; Kivo never recalculates formulas. Headers and a bounded sample are the only model input (up to 16 KiB); originals remain private. Provider/model configuration is server-owned and manual mapping always works. Missing provider configuration and inference errors become visible manual-review findings.

Supported layouts are tabular person/project/start/end/effort and weekly matrices with dated columns. Date order and effort units are explicit. Total hours must distribute exactly into quarter-hour daily allocations over the person's working calendar; rounding is never silent. Identity matches are unique exact names or reviewer-selected IDs. New people require Admin authority and explicit working hours; imports never create users, memberships or agent grants. Existing baseline calendars require explicit acknowledgement when no effective calendar is stored.

## Transaction contracts

Import creation authorizes current membership and reserves a source/import plus parse job and receipt in one transaction. Claims serialize a tenant queue lane, use SKIP LOCKED, increment fencing tokens and enforce one active job per tenant; expired leases are recoverable with bounded retries. Completion rechecks membership, import version/status and the lease fence. Cancellation invalidates pending work. Network and parsing stay outside locks.

Review stores the selected mapping and a dry-run result against the current organization revision. Publication locks organization, current membership, import and source; requires the reviewed organization/import/source versions; applies all typed planning commands, source links, audit events and receipt in one commit. A stale review cannot publish. Refresh requires the prior published source version and preserves any assignment whose version differs from its last imported version, requiring human resolution instead of overwriting. Exact retries return the original receipt after current authorization. Export jobs use the saved publication snapshot and reauthorize output metadata before exposing a private file.

## Acceptance evidence

Parser fixtures cover both layouts, XLSX cell positions, cached formulas, ambiguous dates, invalid units, compressed bombs and unsupported layouts. Adapter fixtures cover all three provider protocols, refusals, malformed/out-of-bounds suggestions and sample budgets. Real local PostgreSQL/API/worker/S3 fixtures cover tenant isolation, role changes, lease fencing, cancellation, publication rollback, replay, refreshed-file diffs and newer human edits. Browser validation covers desktop/mobile upload-review-publish-export, errors, keyboard and reduced motion. Existing Rust/frontend/integration checks remain required.

Real customer workbooks and first-result/correction measurements have not been supplied. Representative fixture success does not satisfy the customer-workbook gate or establish the fifteen-minute target. Live model calls require explicitly configured keys/models and per-import processing consent; simulated adapter tests are labelled separately.
