# First milestone validation

Evidence below is chronological. The latest shared-workspace checks are recorded in [Auth0 and collaboration verification](#auth0-and-collaboration-verification); earlier limitations describe those earlier milestones.

Verified October 13, 2026 on macOS with Node 22 and Rust 1.95. This evidence covers a development milestone, not a production release.

## Automated checks

| Check                                                   | Result   | Coverage                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                     | Passed   | Strict TypeScript across browser UI, domain model, and Next proxy                                                                                                                                                                                                                            |
| `npm test`                                              | 5 passed | Weekend and DST date arithmetic, daily overload despite low average utilization, tentative exclusion, move versioning, lane packing, cross-organization and invalid-date rejection                                                                                                           |
| `npm run build`                                         | Passed   | Optimized Next.js production build and route generation                                                                                                                                                                                                                                      |
| `cargo test --manifest-path apps/api/Cargo.toml`        | 3 passed | Weekend-only allocation rejection, invalid timezone, reversed dates and quarter-hour rules                                                                                                                                                                                                   |
| `cargo fmt --manifest-path apps/api/Cargo.toml --check` | Passed   | Rust formatting                                                                                                                                                                                                                                                                              |
| `npm run test:api`                                      | Passed   | Real PostgreSQL 17, SQL migrations, Axum HTTP, auth rejection, organization/person/project persistence, allocation updates and deletes, stale version conflicts, cross-tenant foreign keys, immutable tenant ownership, hidden tenant membership, viewer write denial, and exact audit count |

The API suite starts its own temporary database and service on loopback ports 55432 and 4000. It does not require Docker or a system database. Temporary data and owned processes are cleaned up afterward.

## Browser checks

Playwright drove a dedicated browser session against the actual application.

- Rendered the optimized production build and visually inspected the schedule and project views at 1440 × 1150, plus the schedule at 390 × 844.
- Created an allocation, verified browser storage, and reloaded to confirm persistence.
- Moved an allocation with the keyboard; pointer drag and end-date resize both persisted updated dates.
- Undid a resize and checked that the original end date was restored.
- Filtered Engineering, searched Emma, navigated date windows, and returned to Today.
- Created a person and a project through their forms; both appeared in their views.
- Created a separate organization; confirmed that existing people and projects were absent there and restored when switching back.
- Downloaded schedule CSV and inspected its headers and record content.
- Checked a 390 × 844 mobile viewport for page-level horizontal overflow; the timeline scrolls inside its own container. Adjusted the pinned people column after visual inspection to leave more room for dates.
- In database mode, created an allocation through the browser and verified it through the API, reloaded it, edited it, and deleted it. No browser-local fallback was used.
- The database-mode smoke exposed a Next.js origin-normalization mismatch in the proxy. The fix checks a validated loopback Host against the browser Origin. The create/edit/delete flow passed after the fix; a foreign Origin was rejected.

Local screenshots and the exported CSV are in ignored `output/playwright/`. These artifacts contain only demo or test data.

## Limits

No large-data latency benchmark, full accessibility audit, cross-browser matrix, database backup/restore exercise, production deployment, authenticated multi-user session, WebSocket reconnection test, or billing/integration test was performed. Row windowing is implemented, but thousands-of-assignments performance remains a measured acceptance gate for the next milestone.

The development API has real tenant-scoped persistence and allocation version checks. It uses an explicit development identity, allows authorized workspace readers to see rates, and uses last-write-wins for organization, person, and project edits. Production identity, finer authorization, and version checks for the remaining records are required before a shared pilot.

## Interface redesign

The October 13 visual refresh replaces the original serif and pastel theme with self-hosted Geist typography, charcoal surfaces, compact navigation, a denser schedule, and project rows. The system is applied to Schedule, Projects, People, Capacity, dialogs, menus, and mobile layouts. Design references were [Vercel Geist](https://vercel.com/geist/introduction) and [Linear's interface redesign](https://linear.app/now/how-we-redesigned-the-linear-ui).

Strict TypeScript and the production build passed. Browser checks against that build covered allocation creation, keyboard movement, pointer dragging, resizing, undo, sidebar project filters, and no page overflow at 390 × 844. Desktop views and the allocation editor were visually inspected. Current captures use the `output/playwright/redesign-` prefix. No API or domain-rule changes were part of this refresh.

## Quiet Canvas theme and interaction redesign

Adopted October 13, 2026 following feedback that the previous dark interface still felt fragmented and mechanical. `docs/design-system.md` now defines the canonical theme, and root `AGENTS.md` directs future interface work to follow it.

Replaced the stacked heading, metrics, filters, date controls, and framed work area with one continuous canvas, a location header, a contextual toolbar, and a compact capacity status line. Schedule, Projects, People, Capacity, menus, help, notifications, and the new centered composer use the same tokens. New interactions include date-range creation, pointer-following two-axis allocation movement, a destination-person highlight, Escape cancellation, sidebar collapse, title autofocus, submit shortcuts, and explicit focus restoration.

Executed checks:

- Strict TypeScript, all five scheduling/domain tests, and the optimized production build passed.
- Browser interaction checks verified range selection preview and persisted inclusive dates; composer title focus and Cmd/Ctrl+Enter submit; cross-person movement and date changes; Escape cancellation without persistence or accidental editor opening; resize; keyboard movement; local undo; team filtering; sidebar collapse; and focus restoration.
- Production-build browser checks inspected all four desktop views at 1440 × 1000 and all four mobile views at 390 × 844. Search shortcuts/filtering, reduced-motion rendering, and composer viewport containment passed.
- Project, person, and organization composers were also visually inspected; project/person title autofocus and the relocated CSV export action passed.
- The mobile People check found an absolutely positioned accessibility label escaping its scroll container. Positioning the work-area containing block fixed the page overflow; all four views passed the final viewport check.
- Screenshots in `output/playwright/canvas-*.png` cover the four desktop views, four mobile views, and desktop/mobile composers. Screenshots use reduced motion to capture settled states; interaction checks used normal motion. The dedicated QA browser was restored to its original demo records afterward.

No API, database, or domain-rule changes were made. This work does not establish production authentication, real-time collaboration, a full accessibility audit, or large-data performance. Those milestone limits remain unchanged.

## Backend provider integration

Verified October 13, 2026 after adding Neon connection handling, Upstash REST rate limiting, and private S3 file endpoints.

- `cargo test --locked --manifest-path apps/api/Cargo.toml`: eight tests passed, including remote TLS verification, direct migration endpoint checks, partial configuration rejection, file validation, and signed upload length/type/overwrite conditions.
- `cargo clippy --locked --manifest-path apps/api/Cargo.toml --all-targets -- -D warnings` and Rust formatting checks passed. One existing nested conditional in organization creation was collapsed without changing its behavior.
- `npm run test:api`: passed against temporary PostgreSQL 17 with Redis/S3 disabled. Existing scheduling persistence, tenant authorization, conflict handling and audit checks still pass; readiness reports optional providers as disabled and file endpoints return an explicit service-unavailable response.
- `npm run test:providers`: passed against temporary PostgreSQL and local Upstash/S3 HTTP fixtures. Covers the standalone migration command followed by startup with migrations disabled, the provider-check CLI, readiness, rate-limit responses, Redis/S3 outages and recovery, private file reservation/upload/verification/download, metadata mismatch rejection, conditional overwrite rejection, cross-tenant access, viewer permissions, membership revocation, and idempotent completion audits.
- Tests use a project-local Cargo target, strip inherited cloud configuration, disable dotenv loading, and clean up their database, servers and temporary files. Port 4000 was free after completion.

These checks do not establish connectivity to a real Neon project, execute Lua on Upstash, verify AWS IAM/CORS, or validate signatures at AWS. Hosted account configuration and a live upload/download smoke remain outstanding. There were no frontend changes or browser checks in this integration milestone. Production authentication, Redis caching/presence/fan-out, file cleanup, content scanning and a browser file interface remain future work. See [provider setup](provider-setup.md).

## Live provider verification

Verified October 13, 2026 using the user-supplied backend environment. No credentials or signed URLs are included in this evidence.

- Normalized the supplied direct/pooled database variable names and bucket alias in the ignored `apps/api/.env`; generated the missing development token and enabled loopback development authentication. Existing provider credentials were preserved, and the file permissions were restricted to the owner.
- Neon PostgreSQL: migrations 1 and 2 succeeded, the pooled SQLx connection passed readiness, and a real workspace read/write flow succeeded. The direct connection also verified removal of temporary records.
- Upstash Redis: live `PING` and the authenticated endpoint's actual Lua rate-limiter command succeeded.
- The supplied storage endpoint is **Neon Object Storage**, using its S3-compatible API. Its CLI bucket check succeeded while the original backend check failed. Explicitly parsing `AWS_ENDPOINT_URL_S3` and using path-style addressing corrected the backend connection. Conflicting/insecure custom endpoint settings are now rejected.
- The complete backend file flow passed: reservation, signed PUT (`200`), repeated PUT rejected (`412`), S3 metadata verification and completion (`204`), signed GET (`200`), and a byte-for-byte match for the 57-byte CSV payload. An unsigned object request returned `403`.
- The test object was deleted, and a subsequent object HEAD confirmed absence. The temporary organization, file metadata, memberships and audit rows were removed; follow-up database counts were zero for all four. The temporary API process was stopped and port 4000 was free afterward. Schema migrations and the normal development identity remain available for the application.
- Nine Rust tests, strict Clippy, formatting, and the local provider integration suite passed after the endpoint fix.

The safe live report is `output/live-provider-smoke.json` (ignored). Its SHA-256 records the downloaded test payload. This verifies Neon Object Storage, not native AWS S3 or AWS IAM. Browser CORS and production authentication remain unverified; the browser interface was not changed or exercised.


## Capacity planning milestone — October 13, 2026

Implemented effective-dated weekly calendars (including weekend work), full/partial-day time off, manual workspace holidays, a daily capacity grid with source breakdowns, timeline leave indicators, and calendar-aware project/assignment effort. Browser-local and API storage both support the new entities; old local workspaces gain empty collections without losing existing data.

Executed checks:

- `npm test`: 11 passing domain/schema tests, including effective boundaries, weekend/DST dates, overlapping leave, holidays, tenant references, zero denominators, and legacy local-data compatibility.
- `npm run build`: successful Next.js production build and TypeScript check after the final functional changes.
- `cargo test --locked --manifest-path apps/api/Cargo.toml`: 9 passing Rust tests; strict Clippy and formatting also passed.
- `KIVO_BROWSER_QA=1 npm run test:api`: original API checks plus new real-PostgreSQL capacity tests passed, then the harness served the app for browser QA. It was stopped with SIGINT after verification and released its ports/database. Coverage includes calendar and leave CRUD, simultaneous updates (one success/one conflict), stale deletion, calendar-aware allocation validation, tenant immutability, malformed SQL data, owner/planner/viewer rules and audit counts.
- `npm run test:providers`: passed the same capacity checks plus existing Redis/S3 fixture regressions; hosted credentials were excluded from the test environment.
- Playwright against the actual Next.js → Axum → isolated PostgreSQL flow at 1440×960 and 390×844: created a calendar, allocation, partial leave and holiday; edited leave via Cmd+Enter; reloaded and checked exact persisted capacity; edited/deleted a calendar; deleted leave from the timeline; checked keyboard tab navigation and reduced-motion mode. The mobile document remained 390px wide. No browser errors occurred during normal flows; the explicitly simulated HTTP 503 produced the expected error state, and reload retained the prior stored record.
- Browser-local mode: time-off creation, undo, and persistence across reload passed with the eight-person demo.
- Applied migration `0003_capacity.sql` using the configured Neon direct URL. A separate read verified migration 3 succeeded and both new tables exist. All workflow test records were in isolated local databases or the dedicated test browser, not the hosted application workspace.

Representative captures are in ignored `output/playwright/`: `capacity-team-desktop.png`, `capacity-overload-desktop.png`, `capacity-mobile.png`, `time-off-editor-mobile.png`, `working-calendar-mobile.png`, and `timeline-time-off.png`.

Current boundary: authentication remains the existing development bridge. Leave is recorded by a planner/admin, not requested/approved through an HR workflow; holidays are manually entered for the workspace. Partial days have a daily reduction rather than clock-time intervals, and overlaps take the maximum. Calendar edits recalculate plans; immutable historical financial snapshots, regional holiday feeds, contract dates, pagination and large-team performance gates remain unimplemented.

## Crate extraction verification

October 13, 2026. The backend now has eight workspace crates: `kivo-api`, `kivo-migrator`, `kivo-tenancy`, `kivo-planning`, `kivo-files`, `kivo-postgres`, `kivo-rate-limit`, and `kivo-object-storage-s3`. HTTP handlers compose typed services; capability contracts contain no SQLx, Axum or cloud SDK types. The Postgres adapter retains repeatable-read workspace snapshots and atomic authorization/version/mutation/audit transactions. No frontend implementation changed in this extraction.

Executed verification:

- `cargo test --locked --workspace`: 14 passing tests, including all previous Rust checks plus role-policy and replacement-adapter workflow tests. File tests cover signing failure after reservation, denied access before storage calls, verification failure, authorization revocation between verification and finalization, and ready/pending lifecycle behavior.
- `cargo clippy --locked --workspace --all-targets -- -D warnings`, `cargo fmt --all --check`, and `npm run check:boundaries`: passed. The metadata check enforces the eight declared ownership boundaries, rejects cycles, excludes provider/runtime dependencies from capability contracts, and keeps direct SQL/cloud clients out of the API process.
- `npm test`: all 11 scheduling/schema/capacity tests passed. `npm run build`: production Next.js compilation and TypeScript validation passed.
- `npm run test:api`: passed with temporary PostgreSQL 17, exercising local startup through the separate migrator, API auth, planning persistence, stale versions, concurrent calendar edits, tenant constraints, working-day rules, role checks, deletion and exact audit counts.
- `npm run test:providers` (with `KIVO_BROWSER_QA=1` to retain the isolated stack for browser checks): all assertions passed. The migrator upgraded a v2 database without resetting an existing record, preserved the original ledger/checksums, reran idempotently, and rejected checksum drift. It ran without API authentication or optional provider configuration. The legacy `kivo-api migrate` launcher and API startup with migrations disabled passed. Upstash/S3 fixtures passed readiness, outages, throttling, private-file lifecycle, metadata and conditional-write checks, tenant permissions and completion audit idempotency.
- The three migration files match the pre-extraction SHA-384 checksums frozen in `scripts/test-migrations.mjs`. The ordered SQL now lives in `apps/migrator/migrations`.
- Real Chromium at 1440×960 and 390×844: created a project and allocation using keyboard submission; reloaded persisted data; recorded full-day time off and confirmed that four planned hours remained visible as a four-hour overload against zero capacity. On mobile with reduced motion, a simulated POST 503 showed the recovery screen; reload restored the original record, then a successful edit survived another reload. Demo allocation creation and Undo also survived reload. Captures: `output/playwright/refactor-desktop-api.png`, `refactor-mobile-api.png`, and `refactor-demo-undo.png`.

The browser harness was intentionally interrupted after verification and cleaned up its API, Next.js, provider fixtures and temporary PostgreSQL. The separate demo server and dedicated test browser were also stopped. No live cloud writes or credential changes were needed for this refactor. The GitHub verification workflow is configured in `.github/workflows/verify.yml`; its remote execution has not been observed in this local session. Existing production identity, collaboration and scale limits remain as documented above.

## Auth0 and collaboration verification

October 13, 2026. Shared workspaces now add Auth0 sessions, organization onboarding, invitations and membership management; role-specific controls and financial redaction; optimistic versions and transactional retry receipts; and a separate authorized WebSocket process backed by committed PostgreSQL events. The workspace contains 12 crates (three executables and nine libraries). New frontend behavior lives in identity, tenancy and realtime feature modules using Quiet Canvas.

Executed checks:

- `npm run check:boundaries`: 12 crates, acyclic dependencies, pure capability contracts and separate provider/process ownership.
- `cargo fmt --all --check`, workspace Clippy with `-D warnings`, and workspace Rust tests. Auth0 configuration tests cover unsafe issuers and explicit rejection of fallback to a development token.
- `npm run typecheck`, `npm test` (15 passing tests), and `npm run build`. New tests check identical keys/bodies across transport retries, no retry on authorization/version errors, role-specific editing, redacted financial values, and migration of old browser demo records to version 1.
- `npm run test:api`: existing CRUD, capacity, calendar concurrency, tenant constraints, roles, deletion and exact audit counts passed against isolated PostgreSQL 17.
- `npm run test:providers`: existing provider contracts and outages passed. The migration test retains a v2 database record, verifies the original three frozen checksums, upgrades through v4, reruns idempotently and rejects checksum drift. File reservation retries now return the same file ID without a second audit/event; reusing the key with different metadata returns 409.
- `npm run test:shared`: passed against isolated PostgreSQL and a local RSA/JWKS/OIDC fixture. Covers signature/algorithm, issuer, audience, expiry and `nbf`; bounded key refresh, rotation and outages; distinct issuer/subject accounts sharing an email; workspace onboarding; wrong/unverified-email invitations, expiration, reuse, revocation and inviter authority loss; role restrictions, financial redaction and preserved hidden rates; simultaneous people/project version conflicts, stale organization updates, exact-request idempotency and reauthorization on replay; single-use/expired socket tickets, Origin rejection, access-token expiry, committed invalidations, reconnect replay, invalid cursor reset, live membership removal, and concurrent last-owner protection. Revision and audit assertions prove rejected/duplicate writes do not create extra events.

Browser checks used three isolated Playwright sessions against `KIVO_BROWSER_QA=1 npm run test:shared`:

- Real SDK authorization redirect, PKCE/code exchange and encrypted session flow through the local OIDC fixture. The session cookie was HttpOnly/SameSite=Lax; the browser access-token endpoint returned 404; a cross-origin mutation returned 403.
- Owner and planner signed in separately. The planner's project list and editor omitted financial rates, and workspace/person administration was disabled. The owner edited a project; the planner received it live while retaining their original open draft. Saving that stale draft returned 409 and preserved its text instead of overwriting the owner's change.
- Owner created a viewer invitation in Team access. A third browser preserved the fragment token through sign-in, accepted the invitation, and opened the intended workspace with read-only controls. Workspace switching respected a different role in another organization. Logout returned to sign-in and subsequent BFF reads returned 401.
- Changing the planner to Viewer while connected closed its editor and disabled mutations without a reload. Team settings refresh from committed workspace revisions.
- Desktop and 390 × 844 mobile rendering inspected. Mobile document width remained 390px; the dialog scrolls internally. Reduced-motion mode retained a working live connection. Existing Radix dialogs/menus preserve keyboard focus behavior. A hot-refresh warning while changing an effect's dependency list during development was cleared by a fresh reload; intentional denied/conflict requests produced their expected console network errors.

Captures are local and ignored: `output/playwright/shared-sign-in-desktop.png`, `shared-team-desktop.png`, `shared-team-mobile.png`, and `shared-planner-projects.png`. Test browsers and isolated web/API/realtime/OIDC/PostgreSQL processes were stopped after inspection.

Evidence limits: no real Auth0 tenant credentials were supplied or tested in this milestone, and the new migration was not applied to hosted Neon. Existing credentials were not changed. These tests establish local protocol/transaction/UI behavior, not a deployed security audit, live Auth0 configuration, or a throughput benchmark. Invitations are shared links rather than sent emails. Event/receipt retention, tenant quotas, large-workspace pagination and load testing remain future work. [Setup and operating limits](auth0-setup.md) include the concrete configuration and migration steps.

## Live Auth0 configuration and migration check

October 13, 2026, following the user-supplied Auth0 environment settings. Normalized the API issuer's missing trailing slash to match the tenant's discovery document, removed a duplicate `KIVO_RUN_MIGRATIONS` entry, and created the missing ignored realtime environment file using the API's Neon database and the web origin. The launched services use their own environment files; unrelated inherited AWS credentials do not override the configured storage credentials.

- The real tenant's OpenID discovery and JWKS endpoints returned 200, with matching issuer, authorization-code/refresh-token support, RS256, and two RSA signing keys. This verifies the tenant endpoints, not the application's refresh-token grant or Client Secret.
- Ran the dedicated migrator against the configured Neon direct endpoint over verified TLS. Migration 4 succeeded. A subsequent read confirmed all four migration checksums match local SQL, all five new shared-workspace tables exist, and organization/people/project/assignment counts are unchanged (all were zero).
- Started the API on loopback port 4000, realtime on 4001, and Next.js on 3000. API health, realtime readiness and the web page returned 200; an unauthenticated browser workspace request returned 401.
- In a dedicated Chromium session, the actual Sign in link reached Auth0 but returned `invalid_request`: the configured application is not authorized to access resource server `https://api.kivo.app`. The setup guide now includes this required dashboard step. After authorizing User-Delegated Access, the user confirmed that sign-in worked and an invitation was accepted. A subsequent database check confirmed two workspace memberships and the accepted invitation; refresh-token behavior was not independently exercised against the live tenant.

## Signup, team onboarding and resource enrollment — October 13, 2026

Implemented in the separate `kivo-onboarding` capability with PostgreSQL, HTTP and frontend adapters. Signup offers personal planning, team creation and invitation discovery. Workspace creation and invitation acceptance require a provider-verified email; joining retains the invited role. Owner/Admin enrollment explicitly creates or links a scheduling person without changing account permissions. Member/Viewer remain read-only; self-service timesheets and leave requests are not implemented.

Validation completed:

- `cargo test --locked --workspace`: 17 tests passed; `cargo clippy --locked --workspace --all-targets -- -D warnings` and formatting passed. `npm run check:boundaries` validates all 13 crates and their acyclic dependency directions.
- `npm test`: 15 frontend tests passed. TypeScript and the optimized Next.js build passed, including the new onboarding and enrollment BFF routes.
- `npm run test:api`, `npm run test:providers`, and `npm run test:shared` passed using isolated local providers/PostgreSQL. The new `scripts/test-onboarding.mjs` runs as part of `test:shared`: unverified creation through both API paths, personal/team setup, concurrent idempotent setup, exact-request retries, email-scoped invitation discovery/acceptance, role preservation, no implicit profiles, role/tenant denials, version races, duplicate/cross-tenant profile associations, unlinking/removal with preserved allocation history, and revoked-admin retry denial.
- Desktop (1440px) and mobile (390px) browser checks used signed local OIDC fixtures. Verified personal creation with seven-hour weekdays, team creation with no automatic scheduling people, default Member invitation, invitation discovery and joining, unverified signup gate, explicit profile creation, linking an existing person, and returning from additional-workspace setup. Member controls stayed read-only and financial columns stayed hidden. Screenshots are under ignored `output/playwright/onboarding-*`, `enrollment-mobile.png`, `team-access-mobile.png`, `team-link-desktop.png`, `invited-member-mobile.png` and `unverified-signup-mobile.png`.
- Applied additive migration **0005** to hosted Neon through the dedicated migrator. All five migration checksums match the repository; existing organization/user/membership/person/project/allocation/invitation counts were preserved, and no existing account was automatically linked to a person.
- Restored the configured local services: web on 3000, API on 4000, realtime on 4001. Web/API/realtime health checks passed; anonymous onboarding/workspace BFF requests returned 401. Hosted enrollment itself was not exercised with a user's authenticated session; the complete workflows above were verified against isolated real PostgreSQL.

For an already accepted invitation whose person count remains zero: open the workspace switcher → **Team access** → **Add to schedule** next to the member. Choose a new scheduling person or link an existing one. Invitation links still require manual sharing; automated invitation email delivery is outside this implementation.

## Member self-service and time tracking — October 13, 2026

Implemented My work, weekly timesheets, leave requests/approval and planned-versus-actual hour reporting. Time tracking, leave workflow and reporting each have their own capability crate; PostgreSQL implements their atomic ports. The browser-only demo retains its scheduling/capacity scope; these new features use shared API workspaces.

| Requirement | Current evidence |
| --- | --- |
| My work uses the signed-in member's linked scheduling profile | API resolves `member_people` from the verified actor; isolated Hannah Member browser lands on My work and displays only Hannah's assignments, weekday capacity, recorded time and upcoming approved leave. Unlinked Viewer shows enrollment guidance. |
| Hours by project, billable status, weekly submission | Browser records 2.5h, persists through reload, submits the week, and displays the recorded project/note/billable state. Keyboard save, non-billable entry, edit and delete also passed. |
| Members edit own time; Owner/Admin approve; Viewer read-only | `scripts/test-self-service.mjs` verifies ownership, other-user entry denial, tenant/project constraints, missing-profile errors, review privacy and the role matrix. An independent Jules Admin browser approves Hannah's submission; Hannah's view locks through a committed live revision. Kelly Viewer has no Record/Submit/Review controls and API write attempts return 403. |
| Versions, approval locks, retries and transactional audits | Real PostgreSQL integration covers concurrent entry versions, aggregate sheet versions, daily 24-hour limit, submit/withdraw, return with a reason, approved-sheet lock, stale changes, exact-request receipts and revoked-admin retry denial. Duplicate approvals produce one audit row. The Rust week-boundary test covers year transitions and date-limit rejection without panicking. |
| Leave requests affect capacity only after approval | Browser requests 3h partial leave while capacity remains 37h. Admin approval reduces member capacity to 34h, shows upcoming leave and exposes a 2h overload without erasing the 30h plan. API tests verify rejection/cancellation, approved cancellation restoring capacity, and denial of direct planning edits to generated approved absences. A pending 1.5h browser request was cancelled without changing capacity. |
| Planned/actual hours, utilization and project budgets | The API test independently checks daily/person/project totals, billable and approved time, adjusted capacity and lifetime approved budget consumption. Browser report shows 30h planned / 8h recorded, period-filtered 2.5h, actual/billable utilization, person tables and 10.5/40h lifetime budget usage after another week is approved. CSV download contents match the displayed project totals. |
| Modular production-oriented integration | `npm run check:boundaries` passes all 16 crates. API/BFF handlers remain thin; frontend composers and storage I/O live in feature modules. Tenant/range-bound requests reject stale responses, and composers retain their original entry/sheet versions. |

Validation: 18 Rust tests and 15 frontend tests passed; strict Clippy, formatting, TypeScript and the optimized Next.js build passed. `npm run test:shared` passed on the final backend, including all existing identity, onboarding, collaboration and new self-service cases. `npm run test:providers` also passed the existing API/capacity/provider cases and the migration upgrade/rerun/checksum-drift checks through migration 7. Desktop 1440px and mobile 390px browser checks verified the workflows, focus placement, Cmd+Enter, contained scrolling and absence of document horizontal overflow.

Local ignored captures: `output/playwright/my-work-desktop.png`, `time-entry-mobile.png`, `timesheet-submitted-mobile.png`, `timesheet-review-desktop.png`, `my-work-approved-leave-mobile.png`, `leave-request-hours-desktop.png`, `reports-desktop.png`, `reports-mobile.png`, `viewer-timesheets-mobile.png` and `time-report.csv`. All agent test browsers and isolated OIDC/PostgreSQL/API/realtime/web processes were stopped after verification.

Applied additive migrations **0006** and **0007** to hosted Neon with the dedicated migrator over verified TLS. All seven SQLx ledger checksums match the repository. Existing organization/user/membership/person/project/allocation/invitation/calendar/absence counts were preserved; the three new workflow tables started empty. Restored configured web/API/realtime services on 3000/4000/4001; health/readiness returned 200 and anonymous time/leave/report BFF requests returned 401.

Evidence limits: authenticated self-service writes were exercised against isolated real PostgreSQL with signed local OIDC identities, not a user's hosted Auth0 session. Reports concern hours and hour budgets; historical financial rate snapshots, financial profitability and throughput benchmarks remain separate milestones. Approving one's own timesheet is permitted for Owner/Admin (including solo workspaces); reopening approved periods requires a future explicit audited correction workflow.
