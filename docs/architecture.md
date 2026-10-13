# Kivo architecture and data model

Kivo runs a Next.js browser application and an Axum backend against PostgreSQL. The backend is a Cargo workspace with eighteen crates: three independent executables and fifteen capability/provider libraries. Shared code is linked through explicit library contracts; runtime processes can be deployed and scaled independently as they are introduced. The browser-local demo is a separate storage adapter, explicitly labeled and not shared storage or authentication. Future capability boundaries and delivery dependencies are defined in the [product design and iteration plan](product-design.md); this document records implemented architecture and its current limits.

## Crate and process boundaries

Implemented October 13, 2026. Separation of concerns is a project requirement. HTTP composition, capability workflows, SQL transactions and provider clients now live at the boundaries below. Public HTTP shapes and the existing local development commands are preserved.

### Process ownership

Each independently runnable process gets its own executable crate. Its entrypoint owns configuration, tracing, dependency construction, resource limits, startup and graceful shutdown. Business logic belongs in library crates, so processes can reuse behavior without reaching into each other's implementation.

| Executable crate | Responsibility | Delivery status |
| --- | --- | --- |
| `apps/api` / `kivo-api` | HTTP transport, verified request context, routing, DTO mapping and dependency composition. | Implemented; thin HTTP handlers and composition. |
| `apps/migrator` / `kivo-migrator` | Apply the ordered schema migrations through Neon's direct connection and exit with a meaningful status. | Implemented; owns the unchanged ordered SQL stream. |
| `apps/worker` / `kivo-worker` | Execute durable background jobs, exports and cleanup with bounded concurrency, retries and idempotency. | Introduce with the first durable background workflow. |
| `apps/agent-runner` / `kivo-agent-runner` | Execute durable agent runs/steps with scoped tools, budgets, cancellation fences and verified outcomes. | Planned; introduce with the first built-in durable agent workflow in A1/A2. |
| `apps/realtime` / `kivo-realtime-server` | Authorize subscriptions, deliver committed changes, apply backpressure and recover missed revisions. | Implemented; single-use subscription tickets, bounded delivery and durable per-tenant replay. |

A task with a distinct deployment, credential boundary or scaling profile receives another executable crate when implemented. For example, a high-volume connector can run separately from file cleanup. An async function or ordinary business workflow does not automatically require a new process. Distinct processes never share mutable in-process state as their correctness mechanism.

### Initial library boundaries

These library crates contain the responsibilities implemented today. Future worker processes remain intentionally absent.

| Library crate | Owns | Public boundary / dependencies |
| --- | --- | --- |
| `crates/tenancy` / `kivo-tenancy` | Organization and membership types, actor context and role-policy decisions. | Typed tenant/actor context and access decisions; no HTTP or provider SDKs. Identity remains a separate capability. |
| `crates/agents` / `kivo-agents` | Agent registry, versioned definition, one-time credential/session contracts and atomic persistence ports. | Depends on tenancy and value types; no SQL, inference or transport. |
| `crates/agent-runtime` / `kivo-agent-runtime` | Bounded schedule/capacity queries, pure move/impact evaluation, inert proposal lifecycle and atomic persistence ports. | Depends on agents, tenancy and planning contracts; no model, SQL or HTTP. Durable runs are future work. |
| `crates/time-tracking` / `kivo-time-tracking` | Member time ownership, weekly submission states, entry validation and approval rules. | Atomic repository port; depends on tenancy, with no SQL/HTTP types. |
| `crates/leave-requests` / `kivo-leave-requests` | Member leave request and approval workflows. | Atomic repository port; depends on tenancy and planning contracts. Approved absence and review commit together. |
| `crates/reporting` / `kivo-reporting` | Hour-based planned/actual aggregates and calendar-aware capacity. | Pure calculations and snapshot repository port; depends on tenancy, planning and time-tracking value types. |
| `crates/onboarding` / `kivo-onboarding` | Personal/team workspace setup and explicit membership-to-person enrollment. | Pure typed workflows and atomic repository ports; depends on tenancy and planning contracts. No process or provider dependencies. |
| `crates/identity` / `kivo-identity` | Verified issuer/subject identity and account directory ports. | Pure contracts; depends only on tenancy and value types. |
| `crates/auth0` / `kivo-auth0` | RS256/JWKS verification and bounded key refresh. | Implements the identity verifier; no database or HTTP routing dependency. |
| `crates/realtime` / `kivo-realtime` | Ticket and authorized committed-event replay contracts. | Pure ports; PostgreSQL implements durable storage. |
| `crates/planning` / `kivo-planning` | People, projects, allocations, working calendars, leave, capacity rules and planning use cases. | Typed planning commands, results and atomic persistence ports. Internally separate people/projects/scheduling/capacity modules; depends on tenancy contracts. |
| `crates/files` / `kivo-files` | File reservation, completion and download use cases; metadata and object-store contracts. | Typed file lifecycle operations and storage capabilities; depends on tenancy contracts. |
| `crates/postgres` / `kivo-postgres` | SQLx implementations of identity, tenancy, agents, agent tools/proposals, onboarding, planning, time tracking, leave, reporting, realtime and file persistence ports, bounded pools and transactional audit persistence. | Depends on capability contracts; owns SQL, row mapping and transaction mechanics. Organize internally by capability. |
| `crates/rate-limit` / `kivo-rate-limit` | Rate-limit port, explicit allow/deny/unavailable outcomes, and Upstash REST implementation in a separate adapter module. | No authorization authority or scheduling locks. Its small stable interface is consumed by the HTTP process. Split additional adapters into their own crates when introduced. |
| `crates/object-storage-s3` / `kivo-object-storage-s3` | Neon S3 endpoint configuration, signing, object verification and storage client lifecycle. | Implements the file capability's object-store port; provider SDK types remain private. |

One root Cargo workspace provides shared dependency versions, lint policy and a lockfile. Build and test individual packages with `-p`; validate the whole workspace before integration. Every package declares its own direct dependencies and can be built without unrelated process entrypoints. Shared versions simplify a coordinated monorepo release; they do not require deploying all executables together.

Keep the dependency direction explicit:

```text
kivo-planning ────────────────> kivo-tenancy
kivo-agents ────────────────> tenancy principal/scope contracts
kivo-agent-runtime ─────────> agents / tenancy / planning contracts
kivo-files ───────────────────> kivo-tenancy
kivo-onboarding ─────────────> tenancy / planning contracts
kivo-time-tracking ──────────> tenancy contracts
kivo-leave-requests ─────────> tenancy / planning contracts
kivo-reporting ──────────────> tenancy / planning / time-tracking contracts
kivo-postgres ────────────────> capability contracts (SQL adapters and atomic transactions)
kivo-object-storage-s3 ───────> files object-store contract
kivo-api ────────────────────> capability services + selected adapters
kivo-migrator ────────────────> PostgreSQL migration support
kivo-realtime-server ────────> realtime contract + PostgreSQL adapter
kivo-auth0 ──────────────────> identity verifier contract
```

Capability crates never depend on concrete adapters or another executable. Avoid a catch-all `core`, `shared`, `common` or `utils` package. Share a type only when its ownership and compatibility policy are clear. Keep transport DTOs distinct from persistence rows; `sqlx::FromRow` derives exist only on adapter-local rows.

### Replaceable adapters and contracts

Plug-and-play is implemented with capability-owned Rust traits and typed values, injected by constructors at the process entrypoint. Select implementations from validated configuration at startup. Keep trait surfaces limited to real operations needed by their consumers; select generics or trait objects per caller without exposing provider SDK types. Runtime loading of third-party Rust binaries is outside this plan.

For each port, document inputs, tenant context, outputs, error categories, timeout/cancellation behavior, idempotency and consistency guarantees. An object-store replacement must satisfy the existing signed-header, conditional-write, private-access and metadata-verification behavior. A rate limiter must preserve atomic expiry, limit windows and explicit outage behavior. A persistence replacement must preserve transaction guarantees. Contract tests use local fixtures where useful and real PostgreSQL for transactional guarantees; mock success is not provider parity.

Configuration fails explicitly for missing or incompatible required adapters. Optional capabilities are explicitly disabled, with a corresponding readiness state; no silent fallback from configured hosted storage to memory or browser data. A schema or trait change cannot silently change a public HTTP contract or queued event shape.

### Transactions, data ownership and independent growth

Neon PostgreSQL remains the source of truth. Capability owners define schema semantics, constraints and permitted mutations. Initially the PostgreSQL adapter uses one shared database to retain composite tenant foreign keys and atomic cross-table work. Crate separation does not require one database or network hop per capability.

Persistence ports represent atomic use cases, not a series of unrelated CRUD calls. Tenant authorization, stable membership checks, calendar/person locks where needed, version comparison, mutation and audit insertion remain in one transaction. The PostgreSQL adapter calls capability-owned pure validation/policy functions against the locked state where a decision depends on concurrent data; it does not reimplement those rules independently. Public ports must not expose `PgPool`, SQL strings or `sqlx::Transaction`.

The file flow preserves its existing boundary: reserve metadata transactionally, perform S3 work outside database locks, then verify and finalize metadata in a separate transaction. An object-store call cannot be made atomic by wrapping it in a PostgreSQL transaction.

One ordered migration stream in `apps/migrator/migrations` is owned operationally by `kivo-migrator`; capability changes contribute migrations to that stream. Move existing migrations byte-for-byte, preserving their version and checksum. Run migrations once as a release step before starting dependent processes. The local API default and legacy `kivo-api migrate` command launch a sibling migrator binary; `npm run dev:api` builds both first. A standalone API with `KIVO_RUN_MIGRATIONS=0` needs no migrator binary. Use additive schema changes and an expand/migrate/contract sequence when old and new process versions may overlap.

Realtime events now commit with their originating database mutation. Before worker processes ship, commit durable jobs with their originating mutations. Consumers assume at-least-once delivery, record idempotency keys, bound retries and recover after a crash. Define tenant, event ID, schema version and relevant entity revision in event envelopes. Prove claim/ack/retry behavior against PostgreSQL before relying on it. Redis may accelerate delivery or hold ephemeral state but cannot be the only record of required work. New processes receive only their required secrets and database permissions.

Frontend feature ownership mirrors capability boundaries: planning and file components call typed application/storage interfaces; pure calendar calculations stay out of JSX. The workspace shell owns navigation and shared context. Feature-owned composers plug into the shell; a global editor must not accumulate every future capability. Existing React files will be extracted incrementally without changing Quiet Canvas or persistence behavior.

### Shared-workspace transaction and process contracts

Implemented after extraction. `0004_shared_workspaces.sql` adds external identities, versioned memberships, hashed invitations, versions for people/projects/organizations, command receipts, monotonic organization revisions, events and single-use socket tickets. Earlier SQL migrations retain their exact bytes and checksums.

Identity resolves by `(issuer, subject)` only. Organization writes take an organization-scoped advisory lock (including missing-row creation) followed by its row lock and membership authorization. This gives all mutations a consistent lock order and ensures revision order matches commit order. The same transaction checks expected versions, persists the change, records audit, records a non-sensitive invalidation event, and stores an idempotency receipt. Replayed requests are authorized again. Financial fields are redacted inside the consistent workspace snapshot for non-admin roles; planner writes cannot supply them.

Invitations are email-bound, hashed, expiring and single-use. Acceptance rechecks the inviter's current authority, the recipient's verified email and tenant membership in the mutation transaction. Membership changes enforce version and last-owner rules. Auth0 never supplies Kivo roles.

`apps/realtime` owns its configuration, connection cap, WebSocket transport, coalescing revision hub, readiness and shutdown. It consumes a one-time PostgreSQL ticket from the first frame, reauthorizes every batch, expires with the access token and replays at most 256 committed events. The browser refetches authoritative data, reconnects with a fresh ticket, preserves draft versions, and ignores obsolete reads while a save or workspace switch is underway. No access token or invitation secret appears in an event.

Feature modules under `apps/web/src/features/identity`, `tenancy`, and `realtime` own login/join, team access/role policy, and subscription lifecycle. The workspace shell composes them. Detailed API and operating policy: [Auth0 setup](auth0-setup.md).

### Extraction and acceptance gates

The extraction is implemented in the five steps below. The evidence and remaining product limitations are recorded in [validation](validation.md#crate-extraction-verification).

1. **Workspace and pure rules.** The initial extraction placed eight packages under one root Cargo workspace, lockfile and lint policy; later capabilities expanded this to eighteen. Tenancy owns actor/role policy; planning owns commands and validation. Persistence derives remain on Postgres row types. The metadata boundary check rejects cycles and forbidden dependencies.
2. **Atomic PostgreSQL ports.** Capability-owned repository traits express whole transactions. The adapter retains one repeatable-read workspace snapshot and locked authorization/version/mutation/audit writes. Real PostgreSQL integration tests cover tenant isolation, concurrent edits, calendar-aware validation and exact audit counts.
3. **Providers and file use cases.** File workflows live in `kivo-files`, S3 implements its object-store port, and Upstash implements the rate-limit port. Thin HTTP handlers translate DTOs and errors. Replacement-port workflow tests and local provider fixtures verify error propagation, private-file lifecycle and readiness behavior.
4. **Dedicated migrator and process wiring.** Migration execution and unchanged SQL live in `apps/migrator`. The API's local compatibility launcher starts that separate binary and fails if it cannot complete. The upgrade test seeds an existing v2 database, preserves its records/ledger, applies v3, reruns idempotently, and rejects checksum drift. No live cloud writes were repeated for extraction.
5. **Boundary enforcement and browser behavior.** CI is configured to run dependency checks, formatting, Clippy, workspace tests, frontend tests/build, and API/provider integration suites. Local desktop/mobile smoke checks cover persistence, overloads, failed-save recovery and demo Undo. Existing frontend feature extraction remains incremental; this refactor changes no UI implementation. There is no temporary in-process delegation or empty worker/realtime scaffolding.

For later processes, add operational gates as they are built: independent build and start commands, bounded pools/queues, health/readiness, graceful shutdown, job recovery, contract compatibility and observable failure. Do not create empty workers, event buses or adapter abstractions without their first implemented workflow.

## Selected hosted data stack

A0 adds canonical principals without changing Auth0 human accounts or role presets. Human principal UUIDs equal the existing user UUIDs. Migration 0008 backfills principal-aware audit/receipt identity and keeps legacy human actor fields through compatibility triggers; machine records have a null human actor and an explicit principal. Principal type/user/tenant bindings are immutable. Agent registry/version history, normalized project grants, hashed credentials/sessions and inert proposals persist in PostgreSQL. No scheduled person or human time entry is created by registration.

`kivo-agents` owns registry/session contracts; `kivo-agent-runtime` owns bounded tool ports, pure daily capacity/move evaluation and proposal states. Postgres modules implement atomic authority/version/mutation/audit/receipt decisions. HTTP and MCP only deserialize trusted inputs, obtain verified principals and call those same ports. Queries recheck the whole active delegation chain in their transaction, and tool catalogs are filtered by current capability. Rotation invalidates sessions; revocation or loss of an ancestor's accountable owner authority blocks descendants. Typed scopes intersect across at most four agent levels.

Schedule queries are 1–93 inclusive days with a maximum 200 assignments per UUID page; agent scope is at most 50 projects. Capacity reads one permitted person, shares deterministic calendar/leave math, and discloses aggregate workload without unrelated project details. Financial fields are excluded from tool DTOs for every caller. Dense capacity sources fail explicitly rather than truncate. Proposals retain their original source revision, assignment version, content hash and private-context fingerprint. Human review revalidates current source and authority; rejection/cancellation records a decision without a live effect. Registry and decision changes emit the existing durable invalidation events. [Agent setup](agent-setup.md) documents full bounds and connection contracts.

Durable runs/steps, inference, live publication, budget/cancellation fences and hybrid resource units remain in [Human and agent system design](agentic-system-design.md). No agent-runner or inference adapter is introduced by A0. Autonomous live effects in A3 must still atomically check authority, budget, source versions and cancellation.

Decision recorded on 2026-10-13. The experiment uses these three services:

| Service | Responsibility |
| ------- | -------------- |
| Neon PostgreSQL | Canonical application data, transactions, tenant isolation, search, analytics and reporting; durable revision events; future durable jobs. |
| Upstash Redis | Authenticated request rate limiting; future rebuildable caches, ephemeral presence and fan-out. |
| Neon Object Storage (S3-compatible) | Private file storage for imports, exports and attachments. |

PostgreSQL owns mutation correctness through constraints, transactions and version checks. Redis does not own authoritative data or scheduling locks. Analytics and reporting start with PostgreSQL queries and derived reporting tables; Redshift, Iceberg and a separate analytics database are outside the current scope.

Provider adapters are implemented. The configured experiment passed live checks against Neon PostgreSQL, Upstash Redis and Neon Object Storage on 2026-10-13, including a private-file upload/download round trip and cleanup. Neon Object Storage is the selected object store. The backend uses the AWS Rust SDK for its S3-compatible API, with an explicit Neon HTTPS endpoint and path-style addressing. The local PostgreSQL development setup remains available. See [provider setup](provider-setup.md) for configuration, API contracts and current limits.

Neon runtime connections use a bounded pool and verified TLS for remote hosts. Migrations use a separate direct connection to preserve SQLx session-lock semantics. Upstash atomically rate-limits authenticated requests and returns an explicit service error when configured but unavailable. S3 file reservations and completion audits persist in PostgreSQL; tenant-authorized endpoints issue expiring upload/download URLs, and completion validates object metadata. Provider calls do not hold database transaction locks. `/ready` checks configured dependencies, while `/health` only reports liveness.

## Repository structure

- `apps/web/src/lib`: typed schemas, date/capacity functions, seed data, storage adapters, domain tests.
- `apps/web/src/components`: application workspace, schedule renderer, Radix editor.
- `apps/web/src/app/api/workspace`: session-authenticated backend-for-frontend; OAuth tokens remain server-side.
- `crates/tenancy` and `crates/planning`: actor policy, typed commands, validation and atomic persistence ports.
- `crates/files`: private-file application workflows and ports.
- `crates/postgres`: database reads, tenant authorization locks, row mapping and transactions.
- `crates/rate-limit` and `crates/object-storage-s3`: provider adapters.
- `apps/api/src/error.rs`: safe HTTP error mapping.
- `apps/migrator/migrations`: unchanged versioned PostgreSQL schema.

React 19 and TypeScript render the interface; Next.js provides the app shell and Auth0 session bridge. Tailwind CSS is installed through PostCSS, with CSS tokens and semantic classes supplying the visual system. Radix provides dialog focus management and accessible menus. Lucide supplies icons. Rust/Axum owns persistent mutations in API mode. SQLx runs migrations and parameterized queries. Process configuration selects the Postgres, Upstash and S3 adapters explicitly. WebSockets run in their own process; Stripe belongs in a later milestone.

## Current data model

| Entity       | Important fields and ownership                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Organization | UUID, name, IANA timezone, USD currency, version, committed revision; tenant root                                            |
| User         | UUID, email, verified flag; identity keyed separately by provider issuer and subject                                  |
| Membership   | Organization + user composite key; owner/admin/planner/member/viewer role, version                       |
| Person       | Tenant, name, role label, team label, daily capacity in minutes, cost rate in cents/hour, color, version |
| Project      | Tenant, client label, name, status, budget in minutes, bill rate in cents/hour, color, version           |
| Assignment   | Tenant, person and project IDs, inclusive dates, daily minutes, commitment status, version      |
| Working calendar | Tenant, person, effective-from date, seven Monday–Sunday minute values, version; one change per person/date. |
| Absence | Tenant, optional person (null for workspace holiday), category, inclusive dates, optional daily minutes (null for full day), version. |
| Audit event  | Tenant, actor, entity, action, timestamp; committed with the mutation                           |

Memberships do not imply a schedulable person: viewers and service accounts should not inflate capacity or billing. Projects and people have `(org_id, id)` unique keys. Assignment foreign keys include `org_id`, preventing an assignment from referencing another tenant's person or project even if application code regresses.

`role`, `team`, and `client` are intentionally labels in the first milestone. Extract first-class catalog entities when those records acquire settings, permissions, rate cards, or independent lifecycle. Money is integer minor units; effort is integer minutes. Current rates are planning settings, not historical accounting evidence.

## API contract

The service defaults to `127.0.0.1:4000`; `KIVO_API_BIND` can configure an Auth0 deployment behind a reverse proxy. `KIVO_AUTH_MODE=auth0` verifies each request independently. Development mode requires explicit opt-in and a token of at least 32 characters, remains loopback-only, and is rejected by the web bridge in production. See [Auth0 setup](auth0-setup.md).

- `GET /health`: process health and liveness status. This is not a full dependency readiness probe.
- `GET /v1/workspace`: memberships and associated organizations, people, projects, allocations for the current identity, using one repeatable-read snapshot.
- `POST /v1/workspace`: one discriminated command, such as `{ "kind": "assignment", "value": { ... } }`; returns 204 after commit.
- `deleteAssignment`: requires `id`, `orgId`, and the expected current `version`.

Each command validates fields, locks the membership for stable authorization, applies one mutation, and writes an audit record in the same transaction. Organization/person changes require owner or admin. Project/assignment changes allow planner as well. Organization creation grants its creator ownership. The server never accepts a client-supplied actor ID.

Allocation creation requires version 1. Updates require the stored version to equal the supplied next version minus one. Deletes require an exact current version. A stale mutation returns 409 and leaves the stored allocation intact. People, projects and organizations follow the same version contract. Database constraints are mapped to a generic validation response; SQL details are logged server-side, not exposed in the UI.

The read endpoint includes actor ID and per-organization role/revision metadata. Non-admin readers receive null cost/bill rates. `GET/POST /v1/organizations/{org}/team` manages members and invitations; `POST /v1/invitations/accept` accepts a verified-email invitation; `POST /v1/organizations/{org}/realtime-ticket` issues a one-use subscription ticket. Team commands require a UUID `Idempotency-Key`; planning and file commands support it and all browser mutations supply it.

## Capacity calendars and time off

`0003_capacity.sql` adds effective working calendars and absence records. A person retains the existing Monday–Friday daily-capacity baseline before the earliest applicable calendar. For each date, the latest effective calendar supplies seven Monday–Sunday minute values; zero means non-working. Editing/deleting a calendar recalculates affected planning dates, and deletion restores the preceding calendar or baseline. Baseline person edits still change dates not covered by a calendar; this is not immutable historical accounting.

Time off targets one person; holidays cover the workspace. Null daily minutes means the full working day, otherwise the reduction is clamped to that day's base capacity. Reductions have no time-of-day intervals, so overlapping entries use the maximum daily reduction, not their sum. Holidays therefore override partial leave. Planned effort accrues on calendar working days even when leave/holidays consume all availability. Tentative effort is displayed separately and excluded from committed load. A zero denominator has undefined utilization (shown as a dash), while any committed hours still produce an overload.

The workspace API includes `calendars` and `absences`. Commands `calendar`, `absence`, `deleteCalendar`, and `deleteAbsence` use the existing write route. Inserts require version 1, updates require the next version, and deletes require the current version. Calendar person identity and absence category cannot change on update. Owner/admin roles manage working calendars and holidays; owner/admin/planner roles manage individual time off. Tenant-composite foreign keys reject foreign-person references. A locked person row serializes calendar changes with allocation working-day validation; membership locks protect authorization. Every successful mutation writes its audit event in the same transaction.

The Capacity surface offers a daily availability grid with per-day source detail, a dated leave register, and editable calendar history. The timeline shows leave and net-capacity warnings, allocation previews use the same calendar math, and project planned-hour totals count the person's actual working days. The frontend narrows calculations to the person and visible date range before daily aggregation; pagination and large-team benchmarks remain future work.

## Browser behavior and persistence

The public homepage lives at `/`, including for signed-in users. `features/marketing` owns editorial components, scoped CSS and a labelled illustrative preview; its fixture data is never read from or saved to a tenant. Preview capacity uses the same pure frontend scheduling functions as the app. `/app` owns the existing workspace/onboarding and human Auth0 gate. Default login/signup returns to `/app`; invitation login still returns to `/join`, then acceptance selects the invited organization and opens `/app`. Auth0 callback/logout origins remain unchanged. Public session-dependent CTAs render dynamically so an account state is not served from a shared static cache.

Default demo mode stores one schema-validated document in `localStorage`. Invalid stored data is preserved and surfaces an error rather than being reset. Storage failure prevents state advancement. Cross-tab storage events refresh the view, but concurrent browser-local edits are last-write-wins. Local undo restores one prior document and is intentionally unavailable in API mode.

API mode loads server data and sends one command per change. There is no automatic fallback to demo data on server failure. Writes show a saving state and refresh the authoritative snapshot after success. Failed requests surface a reload action rather than allowing further edits against a potentially stale plan. A mutation whose refresh fails is explicitly reported as saved-but-not-refreshed. Reload is required before editing again; UUID idempotency keys protect one automatic retry; confirmed 409/422/403 responses refresh the current snapshot while preserving the draft and its original version.

## Scheduling workspace implementation

A two-week viewport bounds horizontal date work. People stay pinned on the left and dates stay pinned while scrolling. Overlapping allocations are packed into separate lanes with variable row heights. Rows are windowed with overscan, reducing mounted elements for larger teams. Pointer capture supports move and end-date resize; editing dates/person in the panel is the keyboard alternative. Alt + Left/Right moves a focused allocation one calendar day. Dragging across empty days previews a date range and opens a centered composer with the person and inclusive dates pre-filled. Allocation previews follow the pointer in both axes and highlight the destination person; Escape cancels a gesture. Radix traps composer focus, focuses the title input, and restores the initiating control on close. Cmd/Ctrl+Enter submits through native form validation. The shared Quiet Canvas theme is defined in `docs/design-system.md`.

The current capacity implementation is deliberately simple and scans allocations for each day. Windowing alone does not establish performance at thousands of assignments. Before the scale milestone, index allocations by person and date, fetch bounded ranges, avoid full-workspace responses, cache derived counts by revision, and measure both compute time and interaction latency.

Proposed performance gates on a documented mid-range laptop: 1,000 people / 20,000 allocations, two-week viewport, p95 input-to-paint below 100 ms, drag frames below 16.7 ms when feasible, and fewer than 2,500 schedule DOM nodes. These are targets, not benchmarks already met.

## Planned extensions

**Calendar extensions:** employment start/end dates, regional holiday feeds, policy allowances/balances, delegated leave reviews, recurring leave, and interval-based partial days. The current implementation supports manual workspace holidays, recorded time off and member leave requests with Owner/Admin approval. Historical financial snapshots remain future work.

**Project scope:** phases, milestones, staffing demands, placeholder roles, dependencies, explicit billable flags, client entities and rate cards. Separate tentative demand from approved commitments.

**Time and financials:** existing actual time entries and weekly approval locks expand into planned suggestions, timers, deadlines and audited corrections. Effective rates snapshotted on approved work, versioned budgets, currency-specific minor units, and explicit exchange-rate sources remain future work. Fixed-fee margin and time-and-materials billable value use different formulas. Never conflate planned billable value with recognized revenue.

**Identity extensions:** broader tenant quotas, human scoped API keys, richer member time-entry permissions and enterprise identity policy. A0 service credentials already have expiring project/tool delegations. Tenant RLS may add defense in depth after the application contract and connection-pool transaction settings are tested.

**Realtime extensions:** paginated snapshots and changed-range fetches, load-tested connection scaling, retention/cleanup, and optional ephemeral presence. Current replicas independently observe the durable database revision log; Redis fan-out may reduce polling at larger scale but cannot own correctness.

**Integrations:** encrypted OAuth credentials, per-tenant scopes, external ID mappings, inbound idempotency, sync cursors, backoff, explicit one-way/two-way semantics, and reconciliation. Calendar events should not create duplicate demand on each poll.

**Billing:** Stripe customer/subscription records, verified webhook signatures, an event ledger, idempotent entitlement updates, and a clear scheduled-person definition. No billing secrets or trusted entitlement decisions in the browser.

## Account onboarding and scheduling enrollment

An authenticated account starts with no tenant memberships or planning resources. An email verified by the identity provider is required to create or join a workspace. The existing organization command also enforces the creation gate; the onboarding screen is not the authorization boundary. Local development identities are explicitly verified only in development authentication mode.

`kivo-onboarding` owns setup and enrollment contracts; `postgres::onboarding` implements them and `apps/api/src/onboarding.rs` exposes thin handlers. Frontend flows live in `features/onboarding`, separate from the workspace canvas. Migration 0005 adds `member_people` with tenant-scoped foreign keys to memberships and people, unique on each side. It does not infer links for existing records.

- **Personal setup:** atomically create a workspace, owner membership, the explicitly named scheduling profile and its association. The submitted working hours become the weekday default; calendars can override this later.
- **Team setup:** atomically create a workspace and owner membership. Owners/admins add scheduling resources and invite account holders separately. Personal and team are initial setup choices, not separate permission models or permanent workspace types; a solo workspace can later invite a team.
- **Joining:** discover active invitations only for the current verified email, or follow a secret invitation link. Both routes recheck email, expiry, revocation and inviter authority in the same locked acceptance transaction. Joining grants the invited role only; it creates neither a parallel workspace nor a scheduling profile. Invitation creation defaults to Member in the UI; invitation links still need to be shared manually.
- **Enrollment:** owners/admins explicitly create a scheduling profile for a member or link an existing unlinked person in that organization. Scheduling enrollment never changes an account's role. The membership version guards concurrent role, removal and enrollment changes. A profile can link to one account per workspace; an account can have one profile per workspace. Linking by matching email is prohibited.
- **Removal:** unlinking preserves the person and all planning history. Removing a membership revokes account access and cascades only the association; the person's allocations and calendars remain. Owners/admins manage these records separately.

Setup and enrollment authorize before receipt replay, serialize on the organization before the membership, and atomically commit resources, association, membership version, audit, receipt and revision event. Existing live subscriptions invalidate on these committed events. No additional Redis authority, jobs or microservices are introduced.

| Role | View schedules | Plan projects / allocations / time off | Manage people / calendars / access / enrollment | Financial rates |
| --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes, including ownership | Yes |
| Admin | Yes | Yes | Yes; cannot grant or change Owner/Admin roles | Yes |
| Planner | Yes | Yes | No | No |
| Member | Yes | No | No | No |
| Viewer | Yes | No | No | No |

Member can now record their own time and request their own leave through the linked scheduling profile. Viewer remains read-only. A linked profile grants no project, allocation, calendar, access or financial editing authority. Last-owner protection, tenant filtering, financial redaction and permission checks apply on the server. Signup alone never grants any existing organization's role.


## Member self-service, time tracking and leave

`My work` uses the server-resolved `member_people` association to select assignments, daily capacity and upcoming approved time off. Member sign-in lands on this view. Unlinked accounts receive a specific instruction to ask an owner/admin for enrollment; accounts never choose their own person ID in a self-service mutation.

`kivo-time-tracking` owns migration 0006, weekly timesheets and project time entries. A sheet preserves both the submitting user and the linked person when it is first created. Weeks start Monday in workspace calendar dates; entry duration is stored as integer minutes, and the UI accepts hours. Owner/Admin/Planner/Member can record their own time with a current linked profile. Viewer cannot mutate time. Only Owner/Admin can read and review other people's detailed timesheets, including notes; general reporting exposes aggregates rather than notes. Financial rates are absent from the reports.

Entry insertion requires version 1, updates require the next entry version, deletion requires its current version. Every entry mutation also supplies the current sheet version (0 for a new sheet), then increments it. This prevents an entry edit from racing with submission or another edit. A day cannot exceed 1,440 total minutes across projects. Entry ownership, date/week, project tenant, versions and daily totals are checked under the organization and timesheet locks. Changing the member's scheduling association does not transfer an old sheet to the new person/account.

Timesheets move Draft → Submitted → Approved. Submission requires recorded time; submitted and approved entries are locked. A submitter can withdraw a submitted sheet; an Owner/Admin can return it to Draft with a reason. Approved sheets cannot be reopened through this contract. Owners/admins may approve their own sheets, supporting a solo workspace, and every approval is audited. Historical timesheets remain when workspace membership is removed.

`kivo-leave-requests` owns migration 0007 and the Pending → Approved/Rejected/Cancelled workflow. A member requests leave for their server-resolved linked person. Pending/rejected/cancelled requests have no capacity effect. Approval by Owner/Admin creates one planning absence in the same transaction as the request status, audit, receipt and revision event. Partial-day durations use the existing 15-minute increments and maximum-overlap capacity rule. Members can cancel pending requests; Owner/Admin can also cancel approved requests, atomically deleting the generated absence and restoring capacity. The ordinary planning editor cannot modify/delete an approved request's generated absence; approved leave is managed through its request.

`kivo-reporting` reads one repeatable-read tenant snapshot for a date range of at most 366 days. It compares confirmed calendar-aware planned hours with all recorded hours, identifies approved hours separately, and reports actual/billable utilization against capacity after approved leave and holidays. Project budget usage counts approved hours across the project's lifetime, while the other hour columns follow the selected date range. Draft/submitted actuals remain explicitly labelled as recorded rather than approved. Reports never erase scheduled effort during leave, and zero-capacity utilization is undefined. The reporting UI has daily series, project/person tables, date-range filtering and CSV export.

Frontend feature modules own their composers and storage I/O. The workspace shell only mounts My work, Timesheets and Reports. Current-role checks precede receipt replay; entry/sheet/request mutation, audit and durable invalidation stay in one PostgreSQL transaction. Live revisions refresh feature snapshots and planning capacity. No independent worker is needed for these synchronous workflows.
