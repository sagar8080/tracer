# Auth0 and shared workspaces

Kivo uses Auth0 for sign-in and encrypted browser sessions. Kivo stores organizations, invitations and roles in Neon PostgreSQL. Auth0 Organizations and Auth0 role provisioning are not required. The API verifies RS256 access tokens independently; OAuth tokens stay in the Next.js server session, outside browser JavaScript.

## 1. Configure Auth0

Create a **Regular Web Application** for Kivo and an **API** with an identifier such as `https://api.kivo.app`. Select **RS256** for the API's signing algorithm. The identifier is an audience string, not a URL that Kivo needs to serve.

For local development, use these exact application URLs consistently:

- Allowed Callback URLs: `http://127.0.0.1:3000/auth/callback`
- Allowed Logout URLs: `http://127.0.0.1:3000`
- Allowed Web Origins: `http://127.0.0.1:3000`

Enable your desired login connection for this application. Enable the Refresh Token grant for the application and **Allow Offline Access** for the API; Kivo requests `openid profile email offline_access`. Configure refresh-token rotation in Auth0. Use HTTPS versions of these URLs for deployment. Do not mix `localhost` and `127.0.0.1` in one session.

Invitations require a verified email address. Add and deploy a **Post Login Action**, then attach it to the Login flow:

```js
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://kivo.app';
  if (event.user.email) {
    api.accessToken.setCustomClaim(`${namespace}/email`, event.user.email);
    api.accessToken.setCustomClaim(
      `${namespace}/email_verified`,
      event.user.email_verified === true,
    );
  }
};
```

These signed claims let the API verify the invitation recipient. The API never trusts an email forwarded by the browser or links accounts by matching email. Configure Auth0's verification email flow for your connection. After changing verification or the Action, sign in again to obtain updated claims.

## 2. Configure the web server

Use `apps/web/.env.local` (see `.env.example`). Keep all credentials server-side:

```dotenv
KIVO_AUTH_MODE=auth0
NEXT_PUBLIC_STORAGE_MODE=api
AUTH0_DOMAIN=YOUR-TENANT.us.auth0.com
AUTH0_CLIENT_ID=YOUR-APPLICATION-CLIENT-ID
AUTH0_CLIENT_SECRET=YOUR-APPLICATION-CLIENT-SECRET
AUTH0_SECRET=YOUR-64-HEX-CHARACTER-SESSION-SECRET
AUTH0_AUDIENCE=https://api.kivo.app
APP_BASE_URL=http://127.0.0.1:3000
KIVO_API_URL=http://127.0.0.1:4000
NEXT_PUBLIC_REALTIME_URL=ws://127.0.0.1:4001/ws
```

Generate `AUTH0_SECRET` with `openssl rand -hex 32`. Use the same session secret across web replicas; changing it signs users out. Only the storage mode and WebSocket URL are public. Do not put an Auth0 client secret, Neon URL, access token, or S3 credential in a `NEXT_PUBLIC_*` variable.

## 3. Configure the API

Keep existing Neon/S3 settings in `apps/api/.env`. Change/add:

```dotenv
KIVO_AUTH_MODE=auth0
AUTH0_ISSUER=https://YOUR-TENANT.us.auth0.com/
AUTH0_AUDIENCE=https://api.kivo.app
KIVO_RUN_MIGRATIONS=0
KIVO_API_BIND=127.0.0.1:4000
```

The issuer must match the Auth0 domain used by the web app, including the trailing slash. Use the custom domain on both sides if you configure one. `KIVO_DEV_TOKEN` is ignored in Auth0 mode. Missing or invalid Auth0 settings fail closed; there is no fallback to development authentication.

## 4. Configure and run realtime

Create `apps/realtime/.env` from its example. It needs the Neon pooled database URL and the **exact** web origin, but no Auth0 client secret, Redis token, or S3 credentials:

```dotenv
DATABASE_URL=YOUR-NEON-POOLED-POSTGRES-URL
KIVO_DB_MAX_CONNECTIONS=5
KIVO_WEB_ORIGIN=http://127.0.0.1:3000
KIVO_REALTIME_BIND=127.0.0.1:4001
```

Run from the repository root:

```sh
npm ci
cargo build --locked --workspace
npm run db:migrate
# Separate terminals:
npm run dev:api
npm run dev:realtime
npm run dev
```

The additive migration preserves existing planning records and the first three migration checksums. In Auth0 mode migrations default off. Run the migrator once as a release step, before starting the API and realtime processes.

Open Kivo, sign in, and create a workspace. The creator becomes its owner. Use the workspace menu → **Team access** to invite a teammate, copy the expiring link, or manage roles. Links are single-use and tied to a verified email; Kivo does not send invitation emails yet. A lost invitation link can be revoked and reissued. People scheduled in a plan are separate from user accounts that can access it.

Existing development workspaces retain their original memberships. A newly signed-in Auth0 user does not automatically gain access to them. To retain a development workspace, an operator can explicitly grant its ownership in Neon's SQL editor after the first authenticated API request. Resolve the new user by the exact trusted issuer and Auth0 subject (`auth0|...` or the connection's subject), inspect the IDs, and insert the membership:

```sql
SELECT e.issuer, e.subject, e.user_id, u.email
FROM external_identities e JOIN users u ON u.id = e.user_id;
SELECT id, name FROM organizations;
-- Substitute the verified UUIDs; never infer identity from an email match.
INSERT INTO memberships(org_id, user_id, role)
VALUES ('WORKSPACE-UUID', 'AUTH0-USER-UUID', 'owner');
```

Do this with the runtime stopped, then restart and reload. The original development membership can be removed through Team access once the Auth0 owner is verified. Local browser demo data is separate and is not silently imported.

## Role policy

| Capability | Owner | Admin | Planner | Member / Viewer |
| --- | --- | --- | --- | --- |
| Read plans and capacity | Yes | Yes | Yes | Yes |
| Projects, allocations, individual time off, files | Yes | Yes | Yes | Read only |
| People, working calendars, workspace holidays/settings | Yes | Yes | No | No |
| Read/write financial rates | Yes | Yes | No | No |
| Manage planner/member/viewer access | Yes | Yes | No | No |
| Manage owners/admins | Yes | No | No | No |

The last owner cannot be demoted or removed. Member and Viewer have identical permissions for the capabilities currently shipped; time-entry permissions are a later milestone. Role changes are checked in PostgreSQL for every request and subscription. Rates are `null` in unauthorized workspace responses and cannot be set by a planner.

## Operational contract

- Browser sessions are HttpOnly encrypted cookies with one-day inactivity and seven-day absolute limits; the SDK handles callback state, PKCE, renewal and logout. The browser access-token endpoint is disabled.
- Auth0 JWKS refresh is bounded and cached for five minutes. Unknown key IDs cannot trigger unbounded fetches; a rotated key may take up to five seconds to become usable after a refresh attempt. The adapter validates issuer, audience, RS256 signature, expiration, subject and `nbf`.
- All planning entities have versions. Inserts use version 1; updates send the next version; deletes send the current version. Stale changes return 409. The browser retains the original editor version, refreshes current data, and asks the user to reopen a stale draft.
- Browser mutations carry an `Idempotency-Key` UUID and retry transport/503 failures once with the same request. The receipt is committed with mutation, audit and event. Reusing a key for a different payload returns 409; retries are reauthorized. Invitation receipts never store the raw invitation link.
- API-issued subscription tickets expire after 30 seconds and are consumed once. They travel in the first WebSocket frame, never a URL. Each connection is tenant-authorized and expires with its access token. It reconnects with a new ticket. Role loss closes the connection; role changes require a fresh snapshot.
- The separate realtime process polls revisions for active organizations in one batch per second, coalesces notifications, and reads committed events to replay gaps. Each connection rechecks membership at least every five seconds. No LISTEN session, Redis fan-out, or connection-specific database polling loop is needed for ordinary revision detection.
- A process allows 256 concurrent connections, bounds frames and send timeouts, and retains no unbounded socket queue. Replay is limited to 256 events; a larger gap or invalid cursor requires a snapshot. This is a bounded experiment, not a demonstrated thousand-user throughput result.
- Mutation transactions serialize within one organization, including authorization, version checks, receipts and monotonic revision allocation. Different organizations do not share that row lock. PostgreSQL is the durable source; Redis remains optional request limiting.
- Outbox events and receipts are currently retained. A retention worker, rate limiting of unauthenticated network traffic, deployment monitoring, paginated snapshots, and load testing remain deployment work. Terminate HTTPS/WSS at a reverse proxy and allow WebSocket upgrades; use exact origins, private database networking and separate least-privilege runtime roles as appropriate.
- Auth0 logout ends the browser session; already-issued access tokens remain valid until their expiration. Membership removal is enforced independently and promptly by Kivo.

## Verification and references

`npm run test:shared` starts a local RSA/JWKS/OIDC fixture, PostgreSQL, API and realtime process. It uses no cloud credentials. `KIVO_BROWSER_QA=1 npm run test:shared` also retains the fixture web app for browser checks until Ctrl+C. The local HTTP issuer override is loopback-only and unavailable in release Rust builds; never configure it against a hosted tenant.

Live Auth0 tenant configuration and sign-in must be checked after your credentials and Action are configured. Local fixture tests do not establish a live Auth0 connection or a deployed system.

Primary references: [Auth0 Next.js SDK](https://auth0.github.io/nextjs-auth0/), [v4 configuration](https://github.com/auth0/nextjs-auth0/blob/main/V4_MIGRATION_GUIDE.md), [API access tokens](https://auth0.com/docs/secure/tokens/access-tokens/get-access-tokens), [custom claims](https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims).
