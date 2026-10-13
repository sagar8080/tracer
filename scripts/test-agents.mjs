import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { runMigrator } from "./test-migrations.mjs";

export async function verifyAgentUpgrade({ root, client, target, env }) {
  await client.query(
    `CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY,description TEXT NOT NULL,installed_on TIMESTAMPTZ NOT NULL DEFAULT now(),success BOOLEAN NOT NULL,checksum BYTEA NOT NULL,execution_time BIGINT NOT NULL)`,
  );
  const folder = join(root, "apps/migrator/migrations");
  for (const file of (await readdir(folder))
    .filter((n) => /^000[1-7]_.*\.sql$/.test(n))
    .sort()) {
    const bytes = await readFile(join(folder, file));
    await client.query("BEGIN");
    await client.query(bytes.toString());
    await client.query(
      "INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,true,$3,0)",
      [
        Number(file.slice(0, 4)),
        file.slice(5, -4),
        createHash("sha384").update(bytes).digest(),
      ],
    );
    await client.query("COMMIT");
  }
  const user = randomUUID(),
    org = randomUUID(),
    receipt = randomUUID();
  await client.query(
    "INSERT INTO users(id,email,email_verified) VALUES($1,'legacy-agent-upgrade@fixture.invalid',true)",
    [user],
  );
  await client.query(
    "INSERT INTO organizations(id,name,timezone) VALUES($1,'Retained human audit','UTC')",
    [org],
  );
  await client.query(
    "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')",
    [org, user],
  );
  await client.query(
    "INSERT INTO audit_events(org_id,actor_id,entity_id,action) VALUES($1,$2,$1,'legacy.fixture')",
    [org, user],
  );
  await client.query(
    "INSERT INTO command_receipts(org_id,actor_id,request_id,request,result) VALUES($1,$2,$3,'{}','{}')",
    [org, user, receipt],
  );
  const oldAudit = (
    await client.query("SELECT * FROM audit_events WHERE org_id=$1", [org])
  ).rows[0];
  const ledger = (
    await client.query("SELECT * FROM _sqlx_migrations ORDER BY version")
  ).rows;
  const result = await runMigrator(target, env);
  assert.equal(result.code, 0, result.output);
  const after = (
    await client.query("SELECT * FROM audit_events WHERE org_id=$1", [org])
  ).rows[0];
  assert.equal(after.actor_principal_id, user);
  delete after.actor_principal_id;
  assert.deepEqual(after, oldAudit);
  assert.equal(
    (
      await client.query(
        "SELECT actor_id,actor_principal_id FROM command_receipts WHERE request_id=$1",
        [receipt],
      )
    ).rows[0].actor_principal_id,
    user,
  );
  assert.deepEqual(
    (
      await client.query(
        "SELECT * FROM _sqlx_migrations WHERE version<=7 ORDER BY version",
      )
    ).rows,
    ledger,
  );
  assert.equal(
    (
      await client.query("SELECT kind,user_id FROM principals WHERE id=$1", [
        user,
      ])
    ).rows[0].kind,
    "human",
  );
  await client.query("DELETE FROM command_receipts WHERE org_id=$1", [org]);
  await client.query("DELETE FROM audit_events WHERE org_id=$1", [org]);
  await client.query("DELETE FROM memberships WHERE org_id=$1", [org]);
  await client.query("DELETE FROM organizations WHERE id=$1", [org]);
  await client.query("DELETE FROM principals WHERE id=$1", [user]);
  await client.query("DELETE FROM users WHERE id=$1", [user]);
  console.log(
    "PASS: v7 principal migration preserves human IDs, audit content/timestamps, receipts and seven applied checksums.",
  );
}
export async function verifyAgents({ expect, request, save, client, fixture }) {
  const owner = "ian",
    viewer = "kelly",
    planner = "liam",
    admin = "jules";
  const org = randomUUID(),
    foreign = randomUUID();
  await expect(owner, "/v1/onboarding", {
    kind: "team",
    organization: {
      id: org,
      name: "Agent planning studio",
      timezone: "UTC",
      currency: "USD",
      version: 1,
    },
  });
  await expect(admin, "/v1/onboarding", {
    kind: "team",
    organization: {
      id: foreign,
      name: "Private agent studio",
      timezone: "UTC",
      currency: "USD",
      version: 1,
    },
  });
  const base = `/v1/organizations/${org}`,
    agentPath = base + "/agents",
    proposals = base + "/proposals";
  for (const [user, role] of [
    [viewer, "viewer"],
    [planner, "planner"],
    [admin, "admin"],
  ]) {
    const invited = await expect(owner, base + "/team", {
      kind: "invite",
      email: `${user}@studio.test`,
      role,
    });
    await expect(user, "/v1/invitations/accept", { token: invited.token });
  }
  const person = {
    id: randomUUID(),
    orgId: org,
    name: "Alex Planner",
    role: "Designer",
    team: "Studio",
    dailyMinutes: 480,
    costRate: 12345,
    color: "sage",
    version: 1,
  };
  const privatePerson = {
    ...person,
    id: randomUUID(),
    name: "Hidden specialist",
  };
  for (const p of [person, privatePerson]) await save(owner, "person", p);
  const project = {
    id: randomUUID(),
    orgId: org,
    name: "Allowed delivery",
    client: "Client A",
    color: "sage",
    budgetMinutes: 24000,
    billRate: 23456,
    status: "confirmed",
    version: 1,
  };
  const hiddenProject = {
    ...project,
    id: randomUUID(),
    name: "Secret acquisition",
  };
  for (const p of [project, hiddenProject]) await save(owner, "project", p);
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const iso = (d) => d.toISOString().slice(0, 10),
    plus = (s, n) => {
      const d = new Date(s + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + n);
      return iso(d);
    };
  const start = iso(date),
    end = plus(start, 4),
    next = plus(start, 7);
  const a = {
    id: randomUUID(),
    orgId: org,
    personId: person.id,
    projectId: project.id,
    title: "Design concept",
    start,
    end,
    dailyMinutes: 240,
    status: "confirmed",
    version: 1,
  };
  await save(owner, "assignment", a);
  await save(owner, "assignment", {
    ...a,
    id: randomUUID(),
    projectId: hiddenProject.id,
    title: "Confidential work",
    dailyMinutes: 120,
  });
  await save(owner, "assignment", {
    ...a,
    id: randomUUID(),
    personId: privatePerson.id,
    projectId: hiddenProject.id,
  });
  const scope = {
    projectIds: [project.id],
    capabilities: [
      "readSchedule",
      "readCapacity",
      "proposeMove",
      "readProposal",
    ],
    mode: "propose",
  };
  const reg = {
    kind: "register",
    id: randomUUID(),
    name: "Weekly planner",
    purpose: "Observe and propose future staffing changes",
    scope,
    expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(),
    parentId: null,
  };
  await expect(viewer, agentPath, reg, 403);
  await expect(planner, agentPath, reg, 403);
  const key = randomUUID(),
    issued = await expect(owner, agentPath, reg, 200, key);
  assert.ok(issued.credential.startsWith("kivo_agent_"));
  const replay = await expect(owner, agentPath, reg, 200, key);
  assert.equal(replay.credential, null);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM agent_definitions WHERE agent_id=$1",
        [reg.id],
      )
    ).rows[0].n,
    1,
  );
  const secrets = await client.query(
    "SELECT request::text,result::text FROM command_receipts WHERE request_id=$1",
    [key],
  );
  assert.ok(!JSON.stringify(secrets.rows).includes(issued.credential));
  const machine = (token, path, body, key) =>
    expect(owner, path, body, 200, key, token);
  const session = await machine(issued.credential, "/v1/agent-sessions", {
    credential: issued.credential,
  });
  const token = session.accessToken;
  await expect(owner, "/v1/workspace", undefined, 401, undefined, token);
  await expect(
    owner,
    base + "/time?week=2026-10-12",
    undefined,
    401,
    undefined,
    token,
  );
  await expect(owner, agentPath, reg, 401, undefined, token);
  await expect(
    owner,
    `/v1/organizations/${foreign}/schedule?start=${start}&end=${end}`,
    undefined,
    403,
    undefined,
    token,
  );
  const windowPath = `${base}/schedule?start=${start}&end=${plus(start, 11)}`;
  const snapshot = await machine(token, windowPath);
  assert.deepEqual(
    snapshot.assignments.map((a) => a.id),
    [a.id],
  );
  assert.deepEqual(
    snapshot.projects.map((p) => p.id),
    [project.id],
  );
  assert.ok(!JSON.stringify(snapshot).includes(hiddenProject.id));
  assert.ok(!JSON.stringify(snapshot).includes("costRate"));
  assert.ok(!JSON.stringify(snapshot).includes("billRate"));
  const cap = await machine(
    token,
    `${base}/capacity/${person.id}?start=${start}&end=${end}`,
  );
  assert.equal(cap.days[0].plannedMinutes, 360);
  assert.ok(!JSON.stringify(cap).includes(hiddenProject.id));
  await expect(
    owner,
    `${base}/capacity/${privatePerson.id}?start=${start}&end=${end}`,
    undefined,
    403,
    undefined,
    token,
  );
  await expect(
    owner,
    `${base}/schedule?start=${start}&end=${plus(start, 93)}`,
    undefined,
    422,
    undefined,
    token,
  );
  const body = {
    kind: "propose",
    id: randomUUID(),
    request: {
      assignmentId: a.id,
      expectedVersion: 1,
      sourceRevision: snapshot.revision,
      personId: person.id,
      start: next,
      end: plus(next, 4),
      reason: "Move next week to accommodate the client delay",
    },
  };
  const pkey = randomUUID(),
    proposal = await machine(token, proposals, body, pkey);
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.agentName, "Weekly planner");
  assert.equal(proposal.preview.original.start, start);
  assert.equal(proposal.preview.proposed.start, next);
  assert.ok(!JSON.stringify(proposal).includes(hiddenProject.id));
  const agentAudit = (
    await client.query(
      "SELECT actor_id,actor_principal_id FROM audit_events WHERE entity_id=$1 AND action='agent.proposal'",
      [body.id],
    )
  ).rows[0];
  assert.equal(agentAudit.actor_id, null);
  assert.equal(agentAudit.actor_principal_id, issued.agent.principalId);
  assert.deepEqual(await machine(token, proposals, body, pkey), proposal);
  assert.equal(
    (await expect(owner)).assignments.find((x) => x.id === a.id).start,
    start,
  );
  await expect(
    owner,
    proposals,
    {
      ...body,
      id: randomUUID(),
      request: { ...body.request, assignmentId: randomUUID() },
    },
    409,
    undefined,
    token,
  );
  await expect(
    owner,
    proposals,
    {
      kind: "review",
      id: proposal.id,
      version: 1,
      contentHash: proposal.contentHash,
      decision: "markReviewed",
      note: "",
    },
    403,
    undefined,
    token,
  );
  await expect(viewer, proposals, undefined, 403);
  const reviewed = await expect(planner, proposals, {
    kind: "review",
    id: proposal.id,
    version: 1,
    contentHash: proposal.contentHash,
    decision: "markReviewed",
    note: "The staffing change is sensible.",
  });
  assert.equal(reviewed.status, "reviewed");
  assert.equal(
    (await expect(owner)).assignments.find((x) => x.id === a.id).start,
    start,
  );
  const newSnapshot = await machine(token, windowPath);
  const staleBody = {
    ...body,
    id: randomUUID(),
    request: { ...body.request, sourceRevision: newSnapshot.revision },
  };
  const stale = await machine(token, proposals, staleBody);
  await save(owner, "person", { ...person, dailyMinutes: 420, version: 2 });
  await expect(
    owner,
    proposals,
    {
      kind: "review",
      id: stale.id,
      version: 1,
      contentHash: stale.contentHash,
      decision: "markReviewed",
      note: "",
    },
    409,
  );
  const observe = {
    ...reg,
    id: randomUUID(),
    name: "Read-only observer",
    scope: {
      projectIds: [project.id],
      capabilities: ["readSchedule"],
      mode: "observe",
    },
  };
  const oi = await expect(owner, agentPath, observe);
  const os = await machine(oi.credential, "/v1/agent-sessions", {
    credential: oi.credential,
  });
  await expect(
    owner,
    `${base}/capacity/${person.id}?start=${start}&end=${end}`,
    undefined,
    403,
    undefined,
    os.accessToken,
  );
  await expect(
    owner,
    proposals,
    { ...body, id: randomUUID() },
    403,
    undefined,
    os.accessToken,
  );
  const child = {
    ...reg,
    id: randomUUID(),
    name: "Delegated planner",
    parentId: reg.id,
    expiresAt: new Date(Date.now() + 86400000 * 2).toISOString(),
  };
  const ci = await expect(owner, agentPath, child);
  const cs = await machine(ci.credential, "/v1/agent-sessions", {
    credential: ci.credential,
  });
  await expect(
    owner,
    agentPath,
    {
      ...child,
      id: randomUUID(),
      scope: { ...scope, projectIds: [hiddenProject.id] },
    },
    422,
  );
  assert.equal(
    (
      await request(owner, agentPath, {
        ...reg,
        id: randomUUID(),
        scope: { ...scope, capabilities: ["readSchedule", "executeMove"] },
      })
    ).status,
    422,
  );
  // Official MCP SDK exercises initialize/list/call and ordinary transport negotiation.
  const sdk = new Client({
    name: "kivo-independent-test-client",
    version: "1.0.0",
  });
  try {
    await sdk.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:4100${base}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
      ),
    );
    const tools = await sdk.listTools();
    assert.equal(tools.tools.length, 5);
    const result = await sdk.callTool({
      name: "kivo_schedule",
      arguments: { start, end },
    });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.assignments[0].id, a.id);
    const context = await machine(token, windowPath);
    const mp = {
      id: randomUUID(),
      request: { ...body.request, sourceRevision: context.revision },
    };
    const outcome = await sdk.callTool({
      name: "kivo_propose_move",
      arguments: mp,
    });
    assert.equal(outcome.isError, false);
    assert.equal(outcome.structuredContent.status, "pending");
    const denied = await sdk.callTool({
      name: "kivo_schedule",
      arguments: { start, end, sql: "DROP TABLE users" },
    });
    assert.equal(denied.isError, true);
  } finally {
    await sdk.close();
  }
  const sample = await promisify(execFile)(
    process.execPath,
    [fileURLToPath(new URL("./agent-client.mjs", import.meta.url))],
    {
      timeout: 20_000,
      env: {
        ...process.env,
        KIVO_AGENT_API_URL: "http://127.0.0.1:4100",
        KIVO_AGENT_ORG_ID: org,
        KIVO_AGENT_CREDENTIAL: issued.credential,
        KIVO_AGENT_START: start,
        KIVO_AGENT_END: end,
        KIVO_AGENT_MOVE_JSON: "",
      },
    },
  );
  assert.match(sample.stdout, /Granted tools:.*kivo_schedule/);
  assert.match(sample.stdout, /Revision \d+: 1 people, 1 assignments/);
  assert.ok(!sample.stdout.includes(issued.credential));
  const observerSdk = new Client({ name: "scoped-observer", version: "1.0.0" });
  try {
    await observerSdk.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:4100${base}/mcp`),
        {
          requestInit: {
            headers: { Authorization: `Bearer ${os.accessToken}` },
          },
        },
      ),
    );
    assert.equal((await observerSdk.listTools()).tools.length, 1);
  } finally {
    await observerSdk.close();
  }
  const badOrigin = await fetch(`http://127.0.0.1:4100${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://untrusted.invalid",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  assert.equal(badOrigin.status, 403);
  const rotated = await expect(owner, agentPath, {
    kind: "rotate",
    id: reg.id,
    version: 1,
  });
  assert.ok(rotated.credential);
  await expect(owner, windowPath, undefined, 401, undefined, token);
  await expect(
    owner,
    "/v1/agent-sessions",
    { credential: issued.credential },
    401,
  );
  const rotatedSession = await machine(
    rotated.credential,
    "/v1/agent-sessions",
    { credential: rotated.credential },
  );
  await expect(owner, agentPath, { kind: "revoke", id: reg.id, version: 2 });
  await expect(
    owner,
    windowPath,
    undefined,
    401,
    undefined,
    rotatedSession.accessToken,
  );
  await expect(owner, windowPath, undefined, 401, undefined, cs.accessToken);
  await expect(
    owner,
    proposals,
    {
      kind: "review",
      id: stale.id,
      version: 1,
      contentHash: stale.contentHash,
      decision: "markReviewed",
      note: "",
    },
    409,
  );
  const adminIssued = await expect(admin, agentPath, {
    ...observe,
    id: randomUUID(),
    name: "Admin delegated observer",
  });
  const adminSession = await machine(
    adminIssued.credential,
    "/v1/agent-sessions",
    { credential: adminIssued.credential },
  );
  const members = await expect(owner, base + "/team");
  const target = members.members.find(
    (m) => m.email === `${admin}@studio.test`,
  );
  await expect(owner, base + "/team", {
    kind: "changeRole",
    userId: target.userId,
    role: "member",
    version: target.version,
  });
  await expect(
    owner,
    windowPath,
    undefined,
    401,
    undefined,
    adminSession.accessToken,
  );
  await expect(
    admin,
    agentPath,
    { kind: "revoke", id: adminIssued.agent.id, version: 1 },
    403,
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM audit_events WHERE actor_principal_id IS NULL",
      )
    ).rows[0].n,
    0,
  );
  const unsupported = await fetch(`http://127.0.0.1:4100${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${os.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "unknown",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  assert.equal(unsupported.status, 400);
  await client.query(
    "UPDATE agent_sessions SET expires_at=now()-interval '1 second' WHERE agent_id=$1",
    [oi.agent.id],
  );
  await expect(owner, windowPath, undefined, 401, undefined, os.accessToken);
  await assert.rejects(
    client.query("INSERT INTO principals(id,kind) VALUES($1,'human')", [
      randomUUID(),
    ]),
    { code: "23514" },
  );
  await assert.rejects(
    client.query(
      "UPDATE principals SET kind='agent',user_id=NULL,org_id=$1 WHERE id=$2",
      [org, issued.agent.ownerId],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    client.query(
      "INSERT INTO agents(id,org_id,principal_id,owner_id,name,purpose,scope,expires_at,credential_hash) VALUES($1,$2,$3,$3,'Invalid binding','Fixture',$4,now()+interval '1 day',$5)",
      [
        randomUUID(),
        org,
        issued.agent.ownerId,
        JSON.stringify(scope),
        randomUUID(),
      ],
    ),
    { code: "23503" },
  );
  const fresh = await machine(oi.credential, "/v1/agent-sessions", {
    credential: oi.credential,
  });
  assert.ok(fresh.accessToken);
  const live = await expect(owner, agentPath, {
    ...reg,
    id: randomUUID(),
    name: "Pilot planning agent",
  });
  const liveSession = await machine(live.credential, "/v1/agent-sessions", {
    credential: live.credential,
  });
  const latest = await machine(liveSession.accessToken, windowPath);
  const pending = await machine(liveSession.accessToken, proposals, {
    ...body,
    id: randomUUID(),
    request: { ...body.request, sourceRevision: latest.revision },
  });
  await expect(
    owner,
    proposals,
    {
      kind: "propose",
      id: randomUUID(),
      request: {
        ...body.request,
        sourceRevision: (await machine(liveSession.accessToken, windowPath))
          .revision,
        personId: privatePerson.id,
      },
    },
    403,
    undefined,
    liveSession.accessToken,
  );
  const roots = await expect(owner, agentPath);
  assert.equal(roots.agents.find((a) => a.id === child.id).active, false);
  console.log(
    "PASS: agent scopes, parent/owner revocation, credential rotation, redaction, inert proposals, exact retries, stale review, principal audits and official MCP client interoperability.",
  );
  return {
    org,
    project,
    person,
    start,
    end,
    agent: live.agent.id,
    proposal: pending.id,
  };
}
