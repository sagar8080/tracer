import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { mkdtemp, rm, cp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { verifyAgents, verifyAgentUpgrade } from "./test-agents.mjs";
import { verifySelfService } from "./test-self-service.mjs";
import { verifyOnboarding } from "./test-onboarding.mjs";
import { auth0Fixture } from "./auth0-fixture.mjs";
import { runMigrator } from "./test-migrations.mjs";
import { verifyShutdown } from "./test-process-shutdown.mjs";
const root = fileURLToPath(new URL("../", import.meta.url)),
  target = join(root, "target");
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(AWS_|UPSTASH_|KIVO_|AUTH0_|OPENAI_|ANTHROPIC_|GEMINI_|APP_BASE_URL|NEXT_PUBLIC_|DATABASE_|PG)/.test(
        key,
      ),
  ),
);
const dir = await mkdtemp(join(tmpdir(), "kivo-shared-"));
const pg = new EmbeddedPostgres({
  databaseDir: join(dir, "db"),
  user: "kivo",
  password: "isolated",
  port: 55433,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
const processes = [],
  sockets = [];
const webPort = process.env.KIVO_QA_WEB_PORT ?? "3000";
assert.ok(
  /^\d+$/.test(webPort) && Number(webPort) >= 1024 && Number(webPort) <= 65535,
);
const webOrigin = `http://127.0.0.1:${webPort}`;
let fixture, client;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let log = "";
function start(name, env, args = []) {
  const child = spawn(name, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (b) => {
    log += b;
  });
  child.stdout.on("data", (b) => {
    log += b;
  });
  processes.push(child);
  return child;
}
async function waitFor(url, child) {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    if (child.exitCode !== null) throw Error(log);
    await sleep(100);
  }
  throw Error(`Startup failed: ${url}\n${log}`);
}
async function request(user, path = "/v1/workspace", body, key, bearer) {
  return fetch(`http://127.0.0.1:4100${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer ?? fixture.token(user)}`,
      ...(body !== undefined ? { "Idempotency-Key": key ?? randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function expect(user, path, body, status = 200, key, bearer) {
  const r = await request(user, path, body, key, bearer);
  const text = await r.text();
  assert.equal(r.status, status, text);
  return text ? JSON.parse(text) : null;
}
const save = (user, kind, value, status = 204, key) =>
  expect(user, "/v1/workspace", { kind, value }, status, key);
const teamPath = (org) => `/v1/organizations/${org}/team`;
async function invite(org, user, role = "planner", by = "alice") {
  return expect(by, teamPath(org), {
    kind: "invite",
    email: `${user}@studio.test`,
    role,
  });
}
async function accept(user, token, status = 200) {
  return expect(user, "/v1/invitations/accept", { token }, status);
}
async function ws(ticket, after = 0, origin = "http://127.0.0.1:3000") {
  const socket = new WebSocket("ws://127.0.0.1:4101/ws", {
    headers: { Origin: origin },
  });
  sockets.push(socket);
  const messages = [];
  let pending;
  socket.on("message", (data) => {
    const value = JSON.parse(data);
    if (pending) {
      const p = pending;
      pending = null;
      p(value);
    } else messages.push(value);
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ ticket, afterRevision: after }));
  return {
    socket,
    next: () =>
      messages.length
        ? Promise.resolve(messages.shift())
        : new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pending = null;
              reject(Error("No WebSocket message"));
            }, 8000);
            pending = (value) => {
              clearTimeout(timer);
              resolve(value);
            };
          }),
  };
}
async function ticket(user, org, bearer) {
  return (
    await expect(
      user,
      `/v1/organizations/${org}/realtime-ticket`,
      {},
      200,
      undefined,
      bearer,
    )
  ).ticket;
}
try {
  await new Promise((resolve, reject) => {
    const build = spawn("cargo", ["build", "--locked", "--workspace"], {
      cwd: root,
      env: { ...baseEnv, CARGO_TARGET_DIR: target },
      stdio: "inherit",
    });
    build.once("error", reject);
    build.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`Build failed ${code}`)),
    );
  });
  fixture = await auth0Fixture({ webOrigin });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("kivo");
  client = pg.getPgClient("kivo");
  await client.connect();
  const env = {
    ...baseEnv,
    KIVO_LOAD_ENV: "0",
    DATABASE_URL: "postgres://kivo:isolated@127.0.0.1:55433/kivo",
    KIVO_AUTH_MODE: "auth0",
    AUTH0_ISSUER: fixture.issuer,
    AUTH0_AUDIENCE: fixture.audience,
    KIVO_AUTH0_LOCAL_TEST: "1",
    KIVO_API_BIND: "127.0.0.1:4100",
    KIVO_REALTIME_BIND: "127.0.0.1:4101",
    KIVO_WEB_ORIGIN: "http://127.0.0.1:3000",
    RUST_LOG: "warn",
  };
  await verifyAgentUpgrade({ root, client, target, env });
  const migration = await runMigrator(target, env);
  assert.equal(migration.code, 0, migration.output);
  const api = start(join(target, "debug/kivo-api"), env);
  await waitFor("http://127.0.0.1:4100/health", api);
  const live = start(join(target, "debug/kivo-realtime-server"), env);
  await waitFor("http://127.0.0.1:4101/health", live);
  assert.equal((await expect("alice")).organizations.length, 0);
  for (const claims of [
    { aud: "wrong" },
    { iss: "https://wrong.example/" },
    { exp: 1 },
    { sub: "" },
    { nbf: Math.floor(Date.now() / 1000) + 100 },
  ])
    await expect(
      "alice",
      "/v1/workspace",
      undefined,
      401,
      undefined,
      fixture.token("alice", claims),
    );
  await expect(
    "alice",
    "/v1/workspace",
    undefined,
    401,
    undefined,
    fixture.token("alice", {}, { alg: "HS256" }),
  );
  const signed = fixture.token();
  await expect(
    "alice",
    "/v1/workspace",
    undefined,
    401,
    undefined,
    signed.slice(0, -10) + "invalidsig",
  );
  const beforeRequests = fixture.state.jwksRequests;
  await Promise.all(
    Array.from({ length: 12 }, () =>
      expect(
        "alice",
        "/v1/workspace",
        undefined,
        401,
        undefined,
        fixture.token("alice", {}, { kid: randomUUID() }),
      ),
    ),
  );
  assert.equal(
    fixture.state.jwksRequests,
    beforeRequests,
    "Unknown kids bypassed refresh throttling",
  );
  fixture.rotate();
  await sleep(5100);
  await expect("alice");
  fixture.state.outage = true;
  await sleep(5100);
  await expect(
    "alice",
    "/v1/workspace",
    undefined,
    503,
    undefined,
    fixture.token("alice", {}, { kid: "missing" }),
  );
  fixture.state.outage = false;
  await expect("alice");
  const sameEmail = await expect(
    "alice",
    "/v1/workspace",
    undefined,
    200,
    undefined,
    fixture.token("same-email", {
      "https://kivo.app/email": "alice@studio.test",
    }),
  );
  const alice = await expect("alice");
  assert.notEqual(sameEmail.actorId, alice.actorId);
  console.log(
    "PASS: RS256, issuer/audience/expiry/nbf/signature validation, bounded JWKS refresh, key rotation, provider outage, issuer-subject account isolation.",
  );
  const org = {
    id: randomUUID(),
    name: "Shared studio",
    timezone: "America/New_York",
    currency: "USD",
    version: 1,
  };
  const orgKey = randomUUID();
  await Promise.all([
    save("alice", "organization", org, 204, orgKey),
    save("alice", "organization", org, 204, orgKey),
  ]);
  assert.equal(
    (await client.query("SELECT count(*)::int n FROM audit_events")).rows[0].n,
    1,
  );
  const p = {
    id: randomUUID(),
    orgId: org.id,
    name: "Olivia Chen",
    role: "Design lead",
    team: "Design",
    dailyMinutes: 480,
    costRate: 8500,
    color: "sage",
    version: 1,
  };
  const project = {
    id: randomUUID(),
    orgId: org.id,
    name: "Orbit rebrand",
    client: "Orbit",
    color: "lilac",
    budgetMinutes: 9600,
    billRate: 15000,
    status: "confirmed",
    version: 1,
  };
  await save("alice", "person", p);
  await save("alice", "project", project);
  const bobInvite = await invite(org.id, "bob");
  await accept("carol", bobInvite.token, 403);
  await expect(
    "bob",
    "/v1/invitations/accept",
    { token: bobInvite.token },
    422,
    undefined,
    fixture.token("bob", { "https://kivo.app/email_verified": false }),
  );
  await accept("bob", bobInvite.token);
  await accept("bob", bobInvite.token);
  const bob = await expect("bob");
  assert.equal(bob.people[0].costRate, null);
  assert.equal(bob.projects[0].billRate, null);
  assert.equal(bob.access[0].role, "planner");
  await save("bob", "person", { ...p, name: "Forbidden", version: 2 }, 403);
  await save("bob", "project", { ...project, version: 2 }, 403);
  await save("bob", "project", {
    ...project,
    billRate: null,
    name: "Orbit launch",
    version: 2,
  });
  assert.equal((await expect("alice")).projects[0].billRate, 15000);
  await expect("bob", teamPath(org.id), undefined, 403);
  const carolInvite = await invite(org.id, "carol", "admin");
  await accept("carol", carolInvite.token);
  const carol = await expect("carol");
  assert.equal(carol.people[0].costRate, 8500);
  await invite(org.id, "dave", "viewer", "carol");
  await expect(
    "carol",
    teamPath(org.id),
    { kind: "invite", email: "dave@studio.test", role: "admin" },
    403,
  );
  await expect(
    "carol",
    teamPath(org.id),
    { kind: "changeRole", userId: alice.actorId, role: "viewer", version: 1 },
    403,
  );
  await expect(
    "alice",
    teamPath(org.id),
    { kind: "remove", userId: alice.actorId, version: 1 },
    422,
  );
  const revoked = await invite(org.id, "dave", "viewer");
  await expect("alice", teamPath(org.id), {
    kind: "revoke",
    id: revoked.invitation.id,
  });
  await accept("dave", revoked.token, 422);
  const expired = await invite(org.id, "dave", "viewer");
  await client.query(
    "UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.invitation.id],
  );
  await accept("dave", expired.token, 422);
  const issuedByAdmin = await invite(org.id, "dave", "viewer", "carol");
  await expect("alice", teamPath(org.id), {
    kind: "changeRole",
    userId: carol.actorId,
    role: "viewer",
    version: 1,
  });
  await accept("dave", issuedByAdmin.token, 422);
  await save(
    "carol",
    "project",
    { ...project, version: 3, billRate: null },
    403,
  );
  const hidden = { ...org, id: randomUUID(), name: "Private workspace" };
  await save("dave", "organization", hidden);
  assert.equal((await expect("bob")).organizations.length, 1);
  await expect(
    "bob",
    `/v1/organizations/${hidden.id}/realtime-ticket`,
    {},
    403,
  );
  console.log(
    "PASS: onboarding, email-bound single-use/expired/revoked invites, invitation authority revocation, role administration, last-owner protection, financial redaction and tenant isolation.",
  );
  const concurrent = await Promise.all([
    request("alice", "/v1/workspace", {
      kind: "person",
      value: { ...p, name: "First edit", version: 2 },
    }),
    request("alice", "/v1/workspace", {
      kind: "person",
      value: { ...p, name: "Second edit", version: 2 },
    }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [204, 409]);
  await save("alice", "organization", {
    ...org,
    name: "Shared studio updated",
    version: 2,
  });
  await save("alice", "organization", { ...org, version: 2 }, 409);
  const projectRace = await Promise.all([
    request("alice", "/v1/workspace", {
      kind: "project",
      value: { ...project, name: "Project winner A", version: 3 },
    }),
    request("bob", "/v1/workspace", {
      kind: "project",
      value: {
        ...project,
        billRate: null,
        name: "Project winner B",
        version: 3,
      },
    }),
  ]);
  assert.deepEqual(projectRace.map((r) => r.status).sort(), [204, 409]);
  const assignment = {
    id: randomUUID(),
    orgId: org.id,
    personId: p.id,
    projectId: project.id,
    title: "Creative direction",
    start: "2026-10-12",
    end: "2026-10-16",
    dailyMinutes: 360,
    status: "confirmed",
    version: 1,
  };
  const key = randomUUID();
  await save("bob", "assignment", assignment, 204, key);
  await save("bob", "assignment", assignment, 204, key);
  await save(
    "bob",
    "assignment",
    { ...assignment, title: "Different command" },
    409,
    key,
  );
  const expiredTicket = await ticket("bob", org.id);
  await client.query(
    "UPDATE realtime_tickets SET expires_at=now()-interval '1 second'",
  );
  const dead = await ws(expiredTicket);
  assert.equal((await dead.next()).type, "denied");
  dead.socket.close();
  const short = await ws(
    await ticket(
      "bob",
      org.id,
      fixture.token("bob", { exp: Math.floor(Date.now() / 1000) + 3 }),
    ),
    0,
  );
  await short.next();
  assert.equal((await short.next()).type, "expired");
  short.socket.close();
  const snapshot = await expect("bob");
  const revision = snapshot.access[0].revision;
  const oneUse = await ticket("bob", org.id);
  const stream = await ws(oneUse, revision);
  assert.equal((await stream.next()).batch.revision, revision);
  const reused = await ws(oneUse, revision);
  assert.equal((await reused.next()).type, "denied");
  reused.socket.close();
  await assert.rejects(
    ws(await ticket("bob", org.id), revision, "http://evil.example"),
  );
  await save("alice", "assignment", {
    ...assignment,
    dailyMinutes: 420,
    version: 2,
  });
  const event = await stream.next();
  assert.equal(event.batch.revision, revision + 1);
  assert.equal(event.batch.changes[0].kind, "assignment.save");
  assert.ok(!JSON.stringify(event).includes("15000"));
  stream.socket.close();
  await save("bob", "assignment", { ...assignment, version: 3 });
  const replay = await ws(await ticket("bob", org.id), revision);
  const recovered = await replay.next();
  assert.equal(recovered.batch.changes.length, 2);
  replay.socket.close();
  const future = await ws(await ticket("bob", org.id), 999999);
  assert.equal((await future.next()).batch.reset, true);
  future.socket.close();
  const current = (await expect("bob")).access[0].revision;
  const removed = await ws(await ticket("bob", org.id), current);
  await removed.next();
  await expect("alice", teamPath(org.id), {
    kind: "remove",
    userId: bob.actorId,
    version: 1,
  });
  assert.equal((await removed.next()).type, "denied");
  removed.socket.close();
  await save("bob", "assignment", assignment, 403, key);
  assert.equal((await expect("bob")).organizations.length, 0);
  await accept("bob", bobInvite.token, 422);
  const rows = (
    await client.query(
      "SELECT o.revision,count(e.*)::bigint n FROM organizations o LEFT JOIN workspace_events e ON e.org_id=o.id WHERE o.id=$1 GROUP BY o.id",
      [org.id],
    )
  ).rows[0];
  assert.equal(rows.revision, rows.n);
  const duplicate = (
    await client.query(
      "SELECT count(*)::int n FROM audit_events WHERE entity_id=$1 AND action='assignment.save'",
      [assignment.id],
    )
  ).rows[0].n;
  assert.equal(duplicate, 3);
  console.log(
    "PASS: simultaneous version conflicts, exact-request retry receipts, single-use tickets, Origin enforcement, committed events, reconnect replay, cursor reset and live access revocation.",
  );
  const ownersOrg = { ...org, id: randomUUID(), name: "Concurrent ownership" };
  await save("alice", "organization", ownersOrg);
  const ownerInvite = await invite(ownersOrg.id, "carol", "admin");
  await accept("carol", ownerInvite.token);
  await expect("alice", teamPath(ownersOrg.id), {
    kind: "changeRole",
    userId: carol.actorId,
    role: "owner",
    version: 1,
  });
  const ownersRace = await Promise.all([
    request("alice", teamPath(ownersOrg.id), {
      kind: "remove",
      userId: alice.actorId,
      version: 1,
    }),
    request("carol", teamPath(ownersOrg.id), {
      kind: "remove",
      userId: carol.actorId,
      version: 2,
    }),
  ]);
  assert.deepEqual(ownersRace.map((r) => r.status).sort(), [200, 422]);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM memberships WHERE org_id=$1 AND role='owner'",
        [ownersOrg.id],
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "PASS: expired subscription credentials, token-limited connections, concurrent project versions and concurrent last-owner protection.",
  );
  await verifyOnboarding({ expect, request, save, fixture, client });
  const selfService = await verifySelfService({
    expect,
    request,
    save,
    fixture,
    client,
  });
  await verifyAgents({ expect, request, save, client, fixture });
  assert.equal(
    (await fetch("http://127.0.0.1:4100/internal/ready")).status,
    200,
  );
  assert.equal((await fetch("http://127.0.0.1:4100/ready")).status, 401);
  if (process.env.KIVO_BROWSER_QA !== "1") {
    for (const socket of sockets) socket.terminate();
    await verifyShutdown(live);
    await verifyShutdown(api);
    console.log(
      "PASS: authenticated readiness preserved, loopback dependency probe and clean API/realtime SIGTERM exits.",
    );
  }
  // Leave a useful fixture for manual desktop/mobile verification when requested.
  if (process.env.KIVO_BROWSER_QA === "1") {
    await invite(org.id, "grace", "viewer");
    await accept("bob", (await invite(org.id, "bob")).token);
    await expect("alice", teamPath(org.id), {
      kind: "changeRole",
      userId: carol.actorId,
      role: "admin",
      version: 2,
    });
    const currentPerson = (await expect("alice")).people[0];
    await save("alice", "person", {
      ...currentPerson,
      name: "Olivia Chen",
      version: currentPerson.version + 1,
    });
    for (const socket of sockets) socket.terminate();
    live.kill("SIGINT");
    await Promise.race([
      new Promise((resolve) => live.once("exit", resolve)),
      sleep(4000),
    ]);
    if (live.exitCode === null) {
      live.kill("SIGKILL");
      await new Promise((resolve) => live.once("exit", resolve));
    }
    const qaLive = start(join(target, "debug/kivo-realtime-server"), {
      ...env,
      KIVO_WEB_ORIGIN: webOrigin,
    });
    await waitFor("http://127.0.0.1:4101/health", qaLive);
    const webEnv = {
      ...baseEnv,
      KIVO_AUTH_MODE: "auth0",
      KIVO_AUTH0_LOCAL_TEST: "1",
      AUTH0_DOMAIN: fixture.issuer,
      AUTH0_CLIENT_ID: fixture.clientId,
      AUTH0_CLIENT_SECRET: fixture.clientSecret,
      AUTH0_SECRET: randomBytes(32).toString("hex"),
      AUTH0_AUDIENCE: fixture.audience,
      APP_BASE_URL: webOrigin,
      KIVO_API_URL: "http://127.0.0.1:4100",
      NEXT_PUBLIC_STORAGE_MODE: "api",
      NEXT_PUBLIC_REALTIME_URL: "ws://127.0.0.1:4101/ws",
    };
    const webFolder = join(root, "output", "agent-web-qa");
    await rm(webFolder, { recursive: true, force: true });
    await mkdir(webFolder, { recursive: true });
    for (const item of [
      "src",
      "next.config.ts",
      "postcss.config.mjs",
      "tsconfig.json",
      "package.json",
      "next-env.d.ts",
    ])
      await cp(join(root, "apps/web", item), join(webFolder, item), {
        recursive: true,
      });
    const web = start(process.execPath, { ...webEnv }, [
      join(root, "node_modules/next/dist/bin/next"),
      "dev",
      webFolder,
      "--hostname",
      "127.0.0.1",
      "--port",
      webPort,
    ]);
    await waitFor(`${webOrigin}/`, web);
    console.log(
      `READY: isolated Auth0 browser QA at ${webOrigin} (ian owner, liam planner, kelly viewer; no cloud credentials). Ctrl+C to clean up.`,
    );
    await new Promise((resolve) => process.once("SIGINT", resolve));
  }
} finally {
  for (const s of sockets) s.terminate();
  for (const child of processes.reverse()) {
    if (child.exitCode === null) {
      child.kill("SIGINT");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        sleep(4000),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
  if (client) await client.end();
  if (fixture) await fixture.close();
  await pg.stop().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
