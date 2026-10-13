# Kivo

A resource planning workspace for people, projects, and team capacity. Includes a local demo and PostgreSQL-backed shared workspaces with Auth0 sessions, team access, capacity planning, versioned edits and live updates. Shared workspaces include member self-service, weekly timesheets, leave approvals and planned-versus-actual hour reports. Financial forecasts and billing are later milestones. Hosted Auth0 configuration is required before shared sign-in can run against your tenant.

## Run the workspace

Requires Node.js 22+ and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The default demo starts with eight people and five projects. Changes persist in this browser. No account or database is required.

Create and edit people, projects, and organizations; click a day or drag across days to plan work; move, resize, and delete allocations; filter teams; search; inspect daily overloads; export the schedule to CSV. Use `N` to create, `Cmd/Ctrl K` to search, `Enter` to edit a focused allocation, `Alt + Left/Right` to move it, `Cmd/Ctrl Enter` to save the composer, and `Escape` to cancel a drag. Undo is available for the most recent demo edit. Schedule hours follow each person’s effective working calendar.

## Capacity planning

Open **Capacity** for daily availability and overload breakdowns. In **Working calendars**, expand a person and schedule a calendar change with its effective date and hours for each weekday. **Time off & holidays** manages full-day or partial-day leave and workspace holidays. Leave appears on the scheduling timeline and reduces capacity without erasing planned work. Calendar changes also update planned project hours.

Calendar and time-off changes persist in both local demo and API modes. API writes use tenant constraints, role checks, version checks and transactional audit records. The capacity migration runs with the existing migration command; no additional provider credentials are needed.

## Member self-service

In a shared workspace, link an account to a person through **Team access → Add to schedule**. **My work** shows that person's assignments, availability and upcoming time off. **Timesheets** records hours by project and billable status, then submits the week for review. Owners/admins use **Team time** and **Leave requests** to approve or return submissions. Approved timesheets lock; approved leave updates planning capacity. **Reports** compares plans, recorded/approved time, utilization and project hour budgets, with date filters and CSV export. Viewer remains read-only.

These workflows require the API and Auth0 shared workspace configuration. The browser-only demo continues to support scheduling and capacity.

## Run with PostgreSQL

Requires Rust 1.95+ and PostgreSQL 17. `docker compose up -d` supplies a local database if Docker is available. The dedicated migrator owns schema execution. Local API startup can invoke it automatically after both binaries are built. Set these variables in the API shell; choose a random development token at least 32 characters long.

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

API mode asks you to create a workspace and does not import demo data. Add people and projects before allocating work. The token stays in the server-side proxy. The proxy rejects production execution and the API binds to loopback. This development identity bridge is not production authentication; do not deploy it.

## Connect Neon PostgreSQL, Upstash and Neon Object Storage

Follow [the provider setup guide](docs/provider-setup.md) and copy `apps/api/.env.example` to `apps/api/.env` if it does not already exist. Neon PostgreSQL uses separate pooled/runtime and direct/migration URLs. Upstash supplies authenticated request rate limiting; Neon Object Storage supplies private file upload/verification/download through its S3-compatible API. Both optional adapters can be omitted for local PostgreSQL development. Start the API, then run `npm run check:providers` to verify all three configured dependencies.

The guide includes the exact environment variables, Neon private-bucket setup, and file API contract. Hosted credentials and account provisioning remain user configuration. Browser file controls, caching and background cleanup remain future work. For shared sign-in, invitations and live updates, follow [the Auth0 setup guide](docs/auth0-setup.md).

## Verify

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
```

`npm run dev:api` builds the workspace and starts the API. For a separate schema step, use `npm run db:migrate`, then `KIVO_RUN_MIGRATIONS=0 cargo run --locked -p kivo-api`. The migrator reads only database configuration and needs no development token or provider credentials.

`test:api` uses an isolated PostgreSQL 17 instance supplied by the development-only `embedded-postgres` package; it requires free loopback ports 4000 and 55432 and cleans up its database and processes.

See [validation evidence](docs/validation.md) for executed checks and limits. Browser captures are generated in ignored `output/playwright/`.

## Design and delivery

- [Canonical design system — Quiet Canvas](docs/design-system.md)
- [Competitive research and product direction](docs/product-strategy.md)
- [Information architecture and domain rules](docs/product-strategy.md#information-architecture)
- [Architecture, data model, and API boundaries](docs/architecture.md)
- [Crate boundaries and modular architecture](docs/architecture.md#crate-and-process-boundaries)

Next milestones are financial forecasts, integrations, billing, bounded schedule queries and scale benchmarks. Neon PostgreSQL is canonical storage; analytics and reporting remain in PostgreSQL. Upstash is optional request limiting, Neon Object Storage stores private files, and a separate realtime process delivers committed PostgreSQL changes. See [Auth0 and shared workspace setup](docs/auth0-setup.md) for configuration, role policy, retry/reconnect guarantees and operational limits.
