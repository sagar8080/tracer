# Kivo hosted pilot

This milestone prepares a single Linux server deployment for **kivolabs.pro**. The domain is proposed, not purchased or confirmed available. The public page is `/`, the workspace is `/app`, invitations use `/join`, Auth0 uses `/auth/*`, WebSockets use `/ws`, and the typed agent API uses `/v1/*`. `www.kivolabs.pro` redirects before authentication. One canonical origin avoids splitting session/transaction cookies across hosts.

The Next.js app, API, realtime server and import worker run in separate containers. The migrator is an explicit one-shot release task. Neon PostgreSQL and private Neon Object Storage remain the data services; no Redis, new warehouse or local database is required. Existing business authorization, receipts and database transaction boundaries remain intact.

## What you need to obtain

1. Register `kivolabs.pro` with a registrar of your choice after checking availability and renewal cost. Enable account MFA and renewal notifications.
2. Create a hosting account. A [Hetzner Cloud server](https://www.hetzner.com/cloud/regular-performance/) is a reasonable first pilot target; the setup also works on another provider's Linux VPS. Choose **x86-64/AMD64, Ubuntu 24.04, at least 2 vCPU, 4 GB RAM and 40 GB disk**, with a public IPv4 address. Choose a region close to Neon and your pilot users; [Hetzner locations](https://docs.hetzner.com/cloud/general/locations/) lists the available options. This is a starting allocation, not a measured capacity guarantee. Builds run in GitHub Actions, not on the small server.
3. Add your SSH public key to the server and configure the provider firewall: TCP 80/443 from the internet, TCP 22 only from your administration IP. Do not expose 3000, 4000, 4001, 4002 or PostgreSQL. Docker publishes only Caddy's 80/443; provider-level firewall rules also avoid relying on Docker/UFW interaction.
4. Have access to the repository's GitHub Actions and packages. Private source/image pulls require a read-only repository deploy key and a GHCR token with `read:packages`. The image workflow publishes using its own GitHub token; no hosting SSH key or runtime secret belongs in that workflow.

## DNS and HTTPS

At your domain's DNS provider:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | Your server's public IPv4 address |
| CNAME | `www` | `kivolabs.pro` |

Start with a 300-second TTL. Add AAAA only if server IPv6 and its firewall are working. If using Cloudflare DNS, start with **DNS only** while verifying certificates and callbacks. You can evaluate proxying later without caching authenticated routes. You do not need an `api` subdomain, wildcard certificate or Auth0 custom domain for this pilot.

Caddy obtains and renews certificates and redirects HTTP to HTTPS when DNS, reachable 80/443 and persistent certificate storage are configured. Preserve the `caddy-data` volume across releases. See [Caddy automatic HTTPS prerequisites](https://caddyserver.com/docs/automatic-https). Do not use `docker compose down -v` in routine deployment or recovery.

Set `SITE_HOST=kivolabs.pro` and your real `ACME_EMAIL` in `/etc/kivo/deploy.env`. Caddy preserves the canonical Host header for Next.js and [handles WebSocket upgrades](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). It caps request bodies at 2 MB; workbook bytes upload directly to private storage rather than through that route. Runtime error logging strips request URI/headers and response headers; access logging is not enabled. Docker logs are bounded to 30 MB per runtime container.

## Auth0 production application

Prefer a separate **Regular Web Application** for the pilot in the existing Auth0 tenant, keeping local URLs on the development application. Keeping the tenant and API identifier preserves identity issuer/subjects; switching tenants is an identity migration, not just a domain edit.

Configure the pilot application's exact values:

| Auth0 setting | Value |
| --- | --- |
| Application Login URI | `https://kivolabs.pro/auth/login` |
| Allowed Callback URLs | `https://kivolabs.pro/auth/callback` |
| Allowed Logout URLs | `https://kivolabs.pro` |
| Allowed Web Origins | `https://kivolabs.pro` |

Do not add the `www` alias, wildcard callbacks or temporary preview hosts. The production SDK base URL is fixed to `https://kivolabs.pro`; successful login returns to `/app`, and invitation login returns through `/join`. Use a fresh login link after changing hosts. See [Auth0's SDK configuration](https://github.com/auth0/nextjs-auth0#customizing-the-client) and the existing [Kivo Auth0 guide](auth0-setup.md).

For the existing **Kivo API**:

- Keep its identifier as the same `AUTH0_AUDIENCE` used locally, such as `https://api.kivo.app`. It is a logical audience, not a DNS endpoint. Buying `kivolabs.pro` does not require changing it.
- Keep RS256 signing. Authorize the new application's **User-Delegated Access**; granting machine-to-machine access alone does not enable browser login.
- Enable the application's Refresh Token grant and the API's Allow Offline Access. Use refresh-token rotation. Kivo requests `openid profile email offline_access`.
- Enable your chosen login connection for the pilot application and verify the email verification flow.
- Deploy and attach the existing Post Login Action from [auth0-setup.md](auth0-setup.md#1-configure-auth0). Its claim namespace stays **`https://kivo.app/email`** and **`https://kivo.app/email_verified`**, because these are the claims the Rust API verifies. Do not substitute the purchased domain into these claim names.

For an invite-only pilot, restrict login at Auth0 **before opening customer access**. With a database connection, disable public signup, create pilot accounts explicitly and disable unused social/enterprise connections that can create users. If you use social login, use an application-scoped Post Login Action with a verified-email allowlist and deny users outside it. Kivo's workspace invitations alone do not prevent a new authenticated person from creating a separate workspace. Recheck the chosen restriction with a non-pilot account.

For the social-login option, create a separate Post Login Action, configure its secrets `KIVO_PILOT_CLIENT_ID` (the production application's ID) and `KIVO_PILOT_EMAILS` (comma-separated verified pilot emails), then deploy and attach it alongside the existing email-claims Action:

```js
exports.onExecutePostLogin = async (event, api) => {
  const pilotClient = event.secrets.KIVO_PILOT_CLIENT_ID;
  if (!pilotClient) {
    api.access.deny('Pilot access is not configured.');
    return;
  }
  if (event.client.client_id !== pilotClient) return;
  const allowed = new Set((event.secrets.KIVO_PILOT_EMAILS || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const email = (event.user.email || '').toLowerCase();
  if (event.user.email_verified !== true || !allowed.has(email)) {
    api.access.deny('This application is currently available to invited pilots.');
  }
};
```

Set both secrets before deploying the Action. Add a teammate to the allowlist before sending their Kivo invitation. Existing development applications bypass this restriction when the production client ID is configured correctly; Kivo still independently checks workspace membership and invitation authority.

Put the production client ID/secret/domain/audience in `web.env`. Generate a distinct, stable `AUTH0_SECRET` with `openssl rand -hex 32`; retain it across releases and web replicas. The API needs the issuer with its trailing slash and the same audience, not the client/session secrets. No OAuth access-token endpoint is exposed to browser JavaScript.

## Neon and private file configuration

Use a dedicated pilot database/branch and its private storage credentials, or deliberately reuse your configured branch. Inspect data before choosing: creating a branch from an existing database can copy its records. Do not silently migrate local demo fixtures into customer workspaces.

- API, realtime and worker use **pooled** Neon URLs with `sslmode=verify-full`.
- Migrator uses the matching **direct** URL, with a role authorized to alter the schema. Runtime roles should have only the DML permissions their services need. For the initial experiment you can use one role, but that does not establish least-privilege database roles.
- Use one private bucket/storage endpoint/namespace for API and worker. `AWS_*` names are SDK conventions: values come from **Neon**, not a newly provisioned AWS account. Keep the bucket private.
- Configure storage CORS for `https://kivolabs.pro`, PUT/GET/HEAD/OPTIONS, and `content-type`, `if-none-match`, `x-amz-server-side-encryption`, plus content-length where configurable. Verify a browser upload/download after deployment. Signed URLs expire and are not public object links.
- Optional model keys and explicit model IDs must be configured consistently in API/worker. Leave them absent for deterministic/manual imports. Avoid keys in realtime, migrator or the web server.

See [provider configuration](provider-setup.md) and [import configuration](import-setup.md). The checker validates configuration consistency, not live credentials or CORS.

## Server configuration files

Install [Docker Engine and the Compose plugin](https://docs.docker.com/engine/install/ubuntu/) and [Node.js 22](https://nodejs.org/en/download) on the server. Compose must be **2.30 or newer** because runtime files use `env_file.format: raw`, preserving literal `$`/`#` in secrets. The release scripts use Node's standard library; `npm ci` is not required on the deployment server.

Clone the repository and check out the exact release commit. A deploy user needs Docker access; membership in the Docker group is equivalent to root access. Keep that access restricted.

From a clean release checkout:

```sh
sudo install -d -m 0700 -o "$USER" -g "$(id -gn)" /etc/kivo
for service in deploy web api realtime worker migrator; do
  install -m 0600 "deploy/config/$service.env.example" "/etc/kivo/$service.env"
done
```

Edit the six files on the server. Examples contain no credentials. Use literal, unquoted `KEY=value` lines; comments go on their own line. Do not source these files as shell scripts. `deploy.env` contains only hostname, operations email, image prefix, Git SHA and configuration directory. Each other file supplies credentials only to its owning process. The checker rejects extra variables, placeholders, mismatched providers and group/world-readable files. Compose fixes authentication mode, origins, binds and migration policy rather than trusting local development settings.

```sh
npm run deploy:check -- /etc/kivo/deploy.env
```

This is offline and does not print secrets. Avoid `docker compose config` without `--quiet`, because it renders environment values. Existing `apps/*/.env` files are not deployment inputs and are excluded from the image build context.

## Build and release

The current feature/deployment changes must be committed and pushed before remote images can be built. In GitHub **Actions → Build pilot images → Run workflow**, enter the full 40-character commit SHA. The workflow runs the verification suite for that commit, builds five Linux AMD64 images, publishes SHA tags with matching OCI revision labels, and checks Rust runtime startup and the Caddy configuration. It does not deploy or run hosted migrations. Treat a failed or partially published workflow as an unusable release; all five images must pass together.

Set the workflow's `KIVO_IMAGE_PREFIX` and `KIVO_RELEASE` outputs in `/etc/kivo/deploy.env`. Authenticate the server to GHCR if packages are private (`docker login ghcr.io` with the read-only package token). From a **clean checkout of that same SHA**:

```sh
npm run deploy:check -- /etc/kivo/deploy.env
npm run deploy:release -- /etc/kivo/deploy.env
npm run deploy:smoke -- https://kivolabs.pro
```

Release validates and pulls all images and checks their revision labels before touching running services. It validates Caddy, stops the four runtime processes, runs the migrator once, then starts the services and waits for private readiness checks. API/realtime accept SIGTERM; worker allows bounded in-flight completion with recoverable leases. Caddy persists certificates. This pilot has a short maintenance window, not a zero-downtime or high-availability claim.

The public smoke checks landing/assets, anonymous API denial, canonical alias, secure transaction cookies and the Auth0 callback address, plus WSS upgrades/origin rejection. It does not complete login, create accounts/workspaces, publish plans or test restore. The private readiness probes verify database and configured storage dependencies; the worker's probe remains loopback-only. The API's `/internal/ready` checks its actual TCP peer and permits only loopback, without exposing dependency details. Existing `/ready` still requires authentication; no static monitoring token is introduced.

For local verification, `npm run test:deploy` exercises config/credential/release failure contracts; set `KIVO_COMPOSE_BINARY=docker` to include the real Compose render check. After a secret-free `NEXT_PUBLIC_STORAGE_MODE=api npm run build`, `KIVO_CADDY_BINARY=caddy npm run test:self-hosted` stages the standalone bundle and exercises the actual Caddy routes with isolated TLS/OIDC/API fixtures. It uses a reserved test issuer and a test-process-only transport redirect; SDK production validation stays enabled, and the OS trust store/DNS are unchanged. Set `KIVO_WEB_BUILD_DIR` to an isolated built `apps/web` directory to avoid replacing an active local development build. Fixture results establish packaging/protocol behavior, not hosted provider connectivity.

## Launch checks and monitoring

Before customer invitations:

1. Verify public DNS/HTTPS and run the public smoke above. Monitor `https://kivolabs.pro/health` from outside the server; this is web liveness, not a full dependency check. Configure alert delivery to an address you monitor and test the alert. The repository does not provision an external monitor or send alerts.
2. Complete hosted login/logout in a real browser and test recovery from an expired callback. Check an authorized pilot account and a denied non-pilot account.
3. Create a pilot workspace, invite a verified teammate, and verify owner/planner/member/viewer permissions. In two browser sessions, change an allocation and confirm the other session refreshes over WSS.
4. Upload a supported CSV/XLSX, review/publish, refresh without overwriting a human edit, export CSV and download the private original. Confirm another workspace cannot access the file.
5. Check all four containers report healthy. Inspect bounded logs with `docker compose --env-file /etc/kivo/deploy.env -f deploy/compose.yaml ps` and `logs --tail=100`. An unhealthy container is not automatically restarted by Compose's health status; restart policy handles process exits. Dependency outage alerts/inspection need an operator or monitoring system.
6. Confirm the actual Neon recovery window/backup features for your plan. Rehearse restoring into an isolated target, check record/migration counts and file access, and record the elapsed recovery time. Storage recovery/retention must be checked separately; a database restore alone does not prove original workbooks can be recovered. See [Neon recovery guidance](https://neon.com/docs/introduction/branch-restore).

The hosted pilot is not approved by packaging alone. File retention/cleanup, inbound abuse quotas, customer workbook/model quality, workload saturation and broader observability remain open operational/product work. Keep customer enrollment bounded while these are measured.

## Failure and recovery

- A pull, revision or Caddy validation failure leaves running services untouched.
- Migration failure stops the release before restarting runtimes. Inspect the migration ledger and logs; applied earlier migrations may already be committed. Fix forward or restore a rehearsed backup. Never edit an applied migration or run a destructive schema reset.
- Startup/readiness failure may leave a partially running deployment. Use the same Compose file to inspect and stop runtimes while repairing settings. Do not repeatedly rotate the session secret as a login fix.
- Before each update, record the previous Git SHA and configuration version in a private operations log. To return to prior binaries, check out the previous clean SHA, set `KIVO_RELEASE` to it, pull those images and start them **only if the current schema remains compatible**. Stop runtimes before changing configuration; do not run an older migrator against a newer ledger. A schema-breaking release needs an explicit forward repair or tested restore.
- Changing database/storage branches must be a coordinated restore/migration of metadata and objects. Copying environment variables alone can orphan original files. Preserve Caddy certificate volumes and avoid broad Docker pruning during incidents.

For troubleshooting sign-in, check the canonical base URL, callback/logout settings, issuer/audience and user-delegated grant first. Do not log authorization codes, cookies, tokens, workbook contents or signed object URLs.
