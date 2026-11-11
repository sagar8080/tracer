# Tracer (previously Kivo)

**Make room for better work.**

Tracer brings people, projects and team capacity into one planning workspace. Schedule work on a shared timeline, see where capacity is tight, compare plans with recorded time, and bring supported spreadsheets into a reviewed plan.

**Early access:** scheduling, capacity, shared member workflows, scoped agent proposals and reviewed workbook onboarding are implemented development features. Hosted pilot preparation is available; production operations and scale validation remain open. See [validation evidence](docs/validation.md) for what has been exercised.

## What you can do

| Capability                 | Available today                                                                                                                         | Workspace       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Schedule work              | Create, move, resize, reassign and delete allocations; confirmed/tentative work, search, team filters, keyboard controls and CSV export | Demo and shared |
| Understand capacity        | Effective working calendars, full/partial-day time off, holidays and daily overload explanations                                        | Demo and shared |
| Coordinate a team          | Auth0 sign-in, invitations, membership roles, account-to-person enrollment, versioned edits and live updates                            | Shared          |
| Record and review time     | My work, project time entries, weekly submission/approval, leave requests and planned/recorded/approved hour reports                    | Shared          |
| Review spreadsheet imports | Private CSV/XLSX upload, mapping and identity review, reconciliation preview, publication, source refresh and pinned CSV export         | Shared + worker |
| Work with scoped agents    | Project/tool-scoped schedule and capacity reads, move proposals and human review through the UI, API and MCP                            | Shared          |

The browser demo stores scheduling and capacity changes locally. Shared workspaces use PostgreSQL and require the API; shared sign-in requires your Auth0 configuration. Reports cover hours and hour budgets. Financial forecasts and billing remain future milestones.

## See Kivo in action

These captures use disposable local fixture data. Animated previews play twice; each has a companion WebM video. [View still images and capture details](docs/media/README.md).

### Plan work on the timeline

Create and move allocations in the running workspace, then inspect the updated plan. Daily effort follows each person's effective working calendar.

![Kivo scheduling: create and move work on the timeline](docs/media/scheduling.gif)

[Watch the scheduling video · 15 seconds](docs/media/scheduling.webm)

### See the impact on capacity

Inspect daily availability and overloads alongside working calendars and time off. Leave reduces capacity without removing planned work.

![Kivo capacity: review availability and daily overloads](docs/media/capacity.gif)

[Watch the capacity video · 18 seconds](docs/media/capacity.webm)

### Turn a spreadsheet into a reviewed plan

Review a supported workbook with manual mapping, inspect the reconciliation preview and publish the accepted changes. Manual mapping requires no AI key.

![Kivo spreadsheet onboarding: manual review, preview and publication](docs/media/spreadsheet-import.gif)

[Watch the spreadsheet import video · 20 seconds](docs/media/spreadsheet-import.webm)

### Review a scoped agent proposal

Inspect a proposed allocation move and its capacity evidence. Marking a proposal reviewed records the human decision; it does not alter the live schedule.

![Kivo agent review: inspect a scoped proposal and its evidence](docs/media/agent-review.gif)

[Watch the agent review video · 25 seconds](docs/media/agent-review.webm)

## Quick start

Requires **Node.js 22+** and npm.

```sh
npm ci
npm run dev
```

Open [the workspace](http://127.0.0.1:3000/app). The default browser demo starts with eight people and five projects, needs no account or database, and persists changes in this browser. The [public product page](http://127.0.0.1:3000/) includes an illustrative interactive tour and signup/login.

<details>
<summary>Demo controls and capacity workflows</summary>

Create and edit people, projects and organizations. Click a day or drag across days to plan work; move, resize and delete allocations; filter teams, search, inspect daily overloads and export the schedule to CSV. Undo is available for the most recent demo edit.

| Shortcut           | Action                    |
| ------------------ | ------------------------- |
| `N`                | Create                    |
| `Cmd/Ctrl K`       | Search                    |
| `Enter`            | Edit a focused allocation |
| `Alt + Left/Right` | Move a focused allocation |
| `Cmd/Ctrl Enter`   | Save the composer         |
| `Escape`           | Cancel a drag             |

Open **Capacity** for daily availability and overload breakdowns. In **Working calendars**, expand a person to schedule a calendar change with an effective date and hours for each weekday. **Time off & holidays** manages full-day or partial-day leave and workspace holidays. Leave appears on the timeline and reduces capacity without erasing planned work. Calendar changes also update planned project hours.

Calendar and time-off changes persist in both demo and API modes. API writes enforce tenant constraints, roles and versions with transactional audit records. Capacity schema changes use the existing migration command and require no additional provider credentials.

</details>

## Shared workspaces

Shared workspaces add persistent collaboration, team access, member self-service, spreadsheet imports and scoped agents. Start with [Auth0 and shared workspace setup](docs/auth0-setup.md) and [provider setup](docs/provider-setup.md).

### Local PostgreSQL development

Requires **Rust 1.95+** and **PostgreSQL 17**. If Docker is available, `docker compose up -d` supplies a local database. The dedicated migrator owns schema execution; local API startup can invoke it after both binaries are built.

Set these variables in the API shell, choosing a random development token of at least 32 characters:

```sh
export DATABASE_URL='postgres://kivo:kivo_local_only@127.0.0.1:5432/kivo'
export KIVO_ALLOW_DEV_AUTH=1
export KIVO_DEV_TOKEN='replace-with-a-random-token-at-least-32-characters'
RUST_LOG=info npm run dev:api
```

Create `apps/web/.env.local` with the same token, then restart `npm run dev`:

```dotenv
NEXT_PUBLIC_STORAGE_MODE=api
KIVO_ALLOW_DEV_AUTH=1
KIVO_DEV_TOKEN=replace-with-the-same-random-development-token
```

API mode starts with workspace creation and does not import demo data. Add people and projects before allocating work. The token stays in the server-side proxy. This development identity bridge binds the API to loopback and rejects production execution; do not deploy it as authentication.

For a separate schema step, run `npm run db:migrate`, then `KIVO_RUN_MIGRATIONS=0 cargo run --locked -p kivo-api`. The migrator reads only database configuration and needs no development token or provider credentials. Run `npm run dev:realtime` for live updates.

<details>
<summary>Neon PostgreSQL, Upstash and private object storage</summary>

Follow [provider setup](docs/provider-setup.md) and copy `apps/api/.env.example` to `apps/api/.env` if it does not already exist. Neon PostgreSQL uses separate pooled/runtime and direct/migration URLs. Upstash supplies authenticated request rate limiting; Neon Object Storage supplies private upload, verification and download through its S3-compatible API. Both optional adapters can be omitted for local PostgreSQL development.

Start the API, then run `npm run check:providers` to verify all three configured dependencies. The guide documents environment variables, private-bucket setup and the file API contract. Hosted credentials and account provisioning remain user configuration. Reviewed workbook file controls are available in A1; caching and background cleanup remain future work.

</details>

### Member self-service and reporting

Link an account to a person through **Team access → Add to schedule**. **My work** shows that person's assignments, availability and upcoming time off. **Timesheets** records project hours and billable status, then submits the week for review. Owners/admins use **Team time** and **Leave requests** to approve or return submissions. Approved timesheets lock; approved leave updates planning capacity. **Reports** compares plans, recorded/approved time, utilization and project hour budgets, with date filters and CSV export. Viewer remains read-only.

These workflows require the API and Auth0 shared workspace configuration.

### Reviewed spreadsheet onboarding

After `npm run db:migrate`, run `npm run dev:worker` alongside API/web/realtime. Owners, admins and planners can open **workspace menu → Spreadsheet imports**, upload a supported CSV/XLSX, review columns and identities, preview reconciliation and publish. Published sources support refreshed-file comparison and a pinned CSV export. The original workbook remains privately downloadable.

A1 supports allocation rows and weekly matrices within [declared parsing and reconciliation limits](docs/a1-implementation.md). Configure optional, explicitly consented OpenAI/Claude/Gemini mapping assistance through [import setup](docs/import-setup.md). Manual mapping requires no AI keys. Customer workbook quality, live model accuracy and onboarding-time gates remain open.

### Scoped agent proposals

Owners/admins register agents through **workspace switcher → Agent activity**. A0 provides distinct service principals, expiring project delegations, short sessions and bounded non-financial schedule/capacity tools through the API and MCP. Owners, admins and planners review proposals there. Proposals never change live assignments. See [agent setup](docs/agent-setup.md) for connection steps and tested limits.

## Hosted pilot

Follow [the deployment runbook](docs/deployment.md) for `kivolabs.pro`, Linux server/DNS setup, production Auth0, isolated runtime credentials, SHA-tagged image builds, controlled migrations and recovery. `deploy/` keeps web/API/realtime/worker separate; the migrator runs once before runtime startup. Validate configuration offline with:

```sh
npm run deploy:check -- /etc/kivo/deploy.env
```

The repository prepares deployment. Domain purchase, hosting provisioning and hosted workflow/restore checks remain operator steps. With Caddy installed and a standalone build compiled in API mode, `npm run test:self-hosted` verifies the production web server behind real HTTPS/WSS routing against local fixtures. CI installs a pinned Caddy binary and runs this check before publishing pilot images.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run check:boundaries
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace
npm run test:api
npm run test:providers
npm run test:shared
npm run test:imports
npm run test:web-auth
npm run test:deploy
```

<details>
<summary>Isolated integration fixtures and browser QA</summary>

- `test:api` uses PostgreSQL 17 through the development-only `embedded-postgres` package. It requires free loopback ports 4000 and 55432 and cleans up its database and processes. Use `KIVO_TEST_API_PORT=4200` when your configured API is running on 4000.
- `test:shared` runs identity, self-service and agent/MCP contracts on isolated ports 4100/4101/4455/55433. `KIVO_BROWSER_QA=1 KIVO_QA_WEB_PORT=3002 npm run test:shared` serves a generated browser-QA checkout without hosted environment files.
- `test:imports` runs PostgreSQL/API/worker/storage/model fixtures on ports 4300/4302/55434 and strips hosted credentials. `KIVO_IMPORT_BROWSER_QA=1 npm run test:imports` additionally serves an isolated frontend on 3002 until Ctrl+C. Fixture checks do not establish live model accuracy or the customer onboarding-time target.

Executed checks and their limits are recorded in [validation](docs/validation.md). Additional browser-QA captures are generated in ignored `output/playwright/`.

</details>

## Architecture and delivery

The Rust workspace has separate API, migrator, realtime and worker executables composing capability libraries. PostgreSQL owns application truth, analytics, authorization/version checks, audit records and committed events. Upstash provides optional rate limiting; private files use S3-compatible Neon Object Storage. Frontend feature modules share the **Quiet Canvas** design system.

The public page at `/` uses illustrative examples that never read or write workspace data. The workspace and account onboarding live at `/app`. Auth0 callback URLs are unchanged; login returns to `/app` and invitation acceptance retains its selected organization.

A0 agent contracts and the supported A1 workbook slice are implemented within their declared limits. Continuous runs (A2), delegated publication (A3) and mixed delivery (A4) remain planned. C0/C1 performance evidence and the C1–C14 capability roadmap remain obligations.

| Documentation                                                                                                | Purpose                                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [Product design and iteration plan](docs/product-design.md)                                                  | Scope, delivery sequence and release gates                   |
| [Feature coverage and Float parity](docs/feature-parity.md)                                                  | Traceable implemented, partial and planned requirements      |
| [Human and agent system design](docs/agentic-system-design.md)                                               | Principal identities, delegation and A0–A4 workflows         |
| [A1 implementation](docs/a1-implementation.md)                                                               | Workbook contracts, safety limits and transaction boundaries |
| [Architecture and API boundaries](docs/architecture.md)                                                      | Data ownership, processes and contracts                      |
| [Crate boundaries](docs/architecture.md#crate-and-process-boundaries)                                        | Modular backend architecture                                 |
| [Quiet Canvas design system](docs/design-system.md)                                                          | Shared visual and interaction principles                     |
| [Information architecture and user journeys](docs/product-design.md#product-surfaces-and-interaction-design) | Product surfaces and human workflows                         |
| [Product strategy](docs/product-strategy.md)                                                                 | Competitive research and direction                           |
| [Validation evidence](docs/validation.md)                                                                    | Executed checks and outstanding limits                       |
