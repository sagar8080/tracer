# Connect a planning agent

A0 supports external agents reading scoped planning data and submitting inert move proposals. It does not run a model or autonomously change live allocations. Auth0 remains human login; agents receive distinct service principals and their own credentials.

## Register and connect

In a shared workspace, open the workspace switcher → **Agent activity**. An Owner or Admin can register an agent, select its projects, purpose, expiry and authority. Read schedules is the default; aggregate capacity requires an explicit grant. Read and propose includes the read tools needed to check a move. A child delegation can only narrow an active parent's projects, tools, mode and expiry.

Copy the one-time credential into your agent's secret configuration. Kivo stores only its hash. It is never stored in browser persistence or returned by receipt replay. Rotate a lost credential; rotation invalidates existing sessions. Revocation blocks the agent and its descendants. Delegations also stop when their accountable owner loses Owner/Admin access.

Exchange the credential through `POST /v1/agent-sessions` with JSON `{"credential":"…"}`. The response contains `accessToken`, `tokenType`, `expiresAt` and `agentId`. Send the token as `Authorization: Bearer …`. Sessions last at most five minutes and cannot outlive an ancestor. Re-exchange on expiry; do not retry revoked authority. Use HTTPS outside loopback development. Never put credentials in URLs, prompts, source documents or logs.

The API is normally `http://127.0.0.1:4000`; MCP is `/v1/organizations/{orgId}/mcp`. This release supports clients configured with a custom bearer token. Automatic OAuth discovery/connection from hosted assistant applications is future integration work.

An executable SDK example is [scripts/agent-client.mjs](../scripts/agent-client.mjs). After `npm ci`, supply these environment variables through a secret manager or an ignored environment file (Node 22+):

```dotenv
KIVO_AGENT_API_URL=http://127.0.0.1:4000
KIVO_AGENT_ORG_ID=YOUR-WORKSPACE-UUID
KIVO_AGENT_CREDENTIAL=YOUR-ONE-TIME-CREDENTIAL
KIVO_AGENT_START=2026-10-26
KIVO_AGENT_END=2026-11-08
```

```sh
node --env-file=/path/to/ignored-agent.env scripts/agent-client.mjs
```

The sample prints only granted tool names and result counts. It opens one short session; a long-running client must renew sessions before expiry. It does not automatically paginate or choose a move. Use `nextCursor` for subsequent pages and supply a reviewed, explicit request to propose.

## Tool and HTTP contracts

| MCP tool | HTTP equivalent | Grant and bounds |
| --- | --- | --- |
| `kivo_schedule` | `GET /v1/organizations/{org}/schedule?start=…&end=…&cursor=…` | `readSchedule`; inclusive 1–93 days, 200 assignments per page |
| `kivo_capacity` | `GET /v1/organizations/{org}/capacity/{person}?start=…&end=…` | `readCapacity`; one scoped person, inclusive 1–93 days |
| `kivo_proposals` | `GET /v1/organizations/{org}/proposals?cursor=…` | `readProposal`; own proposals, 20 per page |
| `kivo_proposal` | `GET /v1/organizations/{org}/proposals/{id}` | `readProposal`; own proposal |
| `kivo_propose_move` | `POST /v1/organizations/{org}/proposals` | `proposeMove` in Propose mode; current source revision/version |

MCP is stateless Streamable HTTP with JSON responses and a capability-filtered tool catalog. It supports protocol versions `2025-11-25`, `2025-06-18` and `2025-03-26`. POST requires an Accept header permitting both JSON and SSE; GET streaming and DELETE session termination are not supported. The official SDK manages this protocol handshake. Unknown tool parameters are rejected; source text cannot grant authority.

Schedule results contain project/person metadata for the permitted scope and assignments in the window. Financial rates are omitted even for owners using these tool contracts. A person is eligible for agent capacity/moves only if assigned to a delegated project. Capacity includes **aggregate workload across their other projects**, but never those projects' identities, titles or private notes. The registration UI discloses this separately. Calendar/absence details are not exposed by capacity tools. Extremely dense capacity sources are rejected rather than silently truncated (1,000 calendar/absence records and 2,000 intersecting assignments).

Human roles retain existing organization-wide visibility; machine scopes do not retrofit project scopes onto humans. Owner/Admin manage registration; Owner/Admin/Planner review proposals. Member/Viewer cannot access the agent activity surface. Machine tokens cannot access human workspace administration, timesheets, leave or identity endpoints.

## Propose and review

Fetch the schedule and retain its `revision` and the selected assignment's `version`. A move contains `assignmentId`, `expectedVersion`, `sourceRevision`, `personId`, ISO `start`/`end`, and a nonempty `reason` of at most 1,000 characters. It preserves calendar duration and daily effort, uses an active scoped project, and moves work from today onward. Original/proposed ranges must fit a 93-day comparison window. Kivo validates the proposed assignment and computes before/after daily capacity and overload using deterministic planning rules.

HTTP payload:

```json
{
  "kind": "propose",
  "id": "STABLE-PROPOSAL-UUID",
  "request": {
    "assignmentId": "ASSIGNMENT-UUID",
    "expectedVersion": 1,
    "sourceRevision": 24,
    "personId": "SCOPED-PERSON-UUID",
    "start": "2026-11-02",
    "end": "2026-11-06",
    "reason": "The client moved the delivery date."
  }
}
```

Supply a UUID `Idempotency-Key` header for HTTP writes. The MCP move tool accepts `{id, request}` and uses `id` as the receipt key. Reuse the same key and exact payload when recovering an uncertain response. Replays recheck authority; a different payload cannot reuse the key. The sample accepts an optional `KIVO_AGENT_MOVE_JSON` containing the request object and `KIVO_AGENT_PROPOSAL_ID` for this explicitly requested operation.

The proposal stores its preview, content hash and source fingerprint. A human sees it in Agent activity and can mark it reviewed or reject with a reason. A review supplies the original `version` and `contentHash`. Mark-reviewed also rechecks current delegation and the capacity source fingerprint; changed work, calendars, leave or person capacity require a new proposal. Rejection does not require unchanged planning context. Agents may cancel their own pending proposals through the HTTP command (`kind: cancel`, `id`, `version`). These decisions are audited and **never publish a schedule mutation**. Live publication, durable runs, model budgets and cancellation fences belong to A2/A3.

## Run and configure

Migration `0008_agent_foundation.sql` adds principals, registry/version history, hashed sessions and proposals. Human principal IDs equal their existing user IDs, and old audit/receipt identity is preserved. Apply migrations once with `npm run db:migrate` before updated API replicas start. Existing Neon/Auth0 settings suffice; no inference provider key is needed for A0.

`KIVO_WEB_ORIGIN` in the API environment defaults to `http://127.0.0.1:3000`. Set it to your browser origin when deploying elsewhere; machine requests without Origin remain valid, while an unexpected Origin is rejected for credential exchange and MCP. Optional Upstash limiting remains non-authoritative. PostgreSQL owns the current delegation and transaction decisions.

Validation and operating limits are recorded in [validation.md](validation.md). This milestone is a development integration, not evidence of the C1 large-team throughput or A3 autonomous-write release gates.
