// Isolated integration test: real PostgreSQL, real Axum HTTP, no global service changes.
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { providerFixtures, verifyProviders } from "./provider-fixtures.mjs";
import { verifyMigrationUpgrade, runMigrator } from "./test-migrations.mjs";
import { verifyCapacity } from "./test-capacity.mjs";
import { fileURLToPath } from "node:url";
const providers = process.argv.includes("--providers");
const root = fileURLToPath(new URL("../", import.meta.url));
const target = join(root, "target");
// Do not inherit developer cloud credentials, provider URLs or a local dotenv file.
const testEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(AWS_|UPSTASH_|KIVO_|AUTH0_|APP_BASE_URL|NEXT_PUBLIC_|DATABASE_|PG)/.test(key),
  ),
);
testEnv.CARGO_TARGET_DIR = target;
const dir = await mkdtemp(join(tmpdir(), "kivo-pg-"));
const pg = new EmbeddedPostgres({
  databaseDir: join(dir, "db"),
  user: "kivo",
  password: "local-test-only",
  port: 55432,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
let api;
let client;
let web;
let fixture;
const token = randomBytes(32).toString("hex");
async function request(method, body, authorized = true) {
  return fetch("http://127.0.0.1:4000/v1/workspace", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function save(kind, value, status = 204) {
  const r = await request("POST", { kind, value });
  assert.equal(r.status, status, await r.text());
}
try {
  await new Promise((resolve, reject) => {
    const build = spawn("cargo", ["build", "--locked", "--workspace"], {
      env: testEnv,
      stdio: "inherit",
    });
    build.once("error", reject);
    build.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`API build failed: ${code}`)),
    );
  });
  if (providers) fixture = await providerFixtures();
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("kivo");
  const apiEnv = {
    ...testEnv,
    ...fixture?.env,
    KIVO_LOAD_ENV: "0",
    DATABASE_URL: "postgres://kivo:local-test-only@127.0.0.1:55432/kivo",
    KIVO_ALLOW_DEV_AUTH: "1",
    KIVO_DEV_TOKEN: token,
  };
  if (providers) {
    apiEnv.DATABASE_DIRECT_URL = apiEnv.DATABASE_URL;
    client = pg.getPgClient("kivo");
    await client.connect();
    await verifyMigrationUpgrade({ root, target, client, env: apiEnv });
    const compatibility = await runMigrator(target, apiEnv, "kivo-api", [
      "migrate",
    ]);
    assert.equal(compatibility.code, 0, compatibility.output);
    // Proves the runtime can start after a separate migration step.
    apiEnv.KIVO_RUN_MIGRATIONS = "0";
  }
  api = spawn(join(target, "debug", "kivo-api"), [], {
    env: apiEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  api.stderr.on("data", (b) => {
    log += b.toString();
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      const r = await request("GET");
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    if (api.exitCode !== null) throw new Error(log);
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, log);
  await new Promise((resolve, reject) => {
    const check = spawn(process.execPath, ["scripts/check-providers.mjs"], {
      env: apiEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });
    check.once("error", reject);
    check.once("exit", (code) =>
      code === (providers ? 0 : 1)
        ? resolve()
        : reject(new Error(`Unexpected provider check status: ${code}`)),
    );
  });
  assert.equal((await request("GET", undefined, false)).status, 401);
  const org = {
    id: randomUUID(),
    name: "Integration studio",
    timezone: "America/New_York",
    currency: "USD",
  };
  await save("organization", org);
  const p = {
    id: randomUUID(),
    orgId: org.id,
    name: "Planner",
    role: "Designer",
    team: "Design",
    dailyMinutes: 480,
    costRate: 6500,
    color: "sage",
  };
  await save("person", p);
  const project = {
    id: randomUUID(),
    orgId: org.id,
    name: "Client work",
    client: "Client",
    color: "lilac",
    budgetMinutes: 9600,
    billRate: 15000,
    status: "confirmed",
  };
  await save("project", project);
  const a = {
    id: randomUUID(),
    orgId: org.id,
    personId: p.id,
    projectId: project.id,
    title: "Design",
    start: "2026-10-12",
    end: "2026-10-16",
    dailyMinutes: 240,
    status: "confirmed",
    version: 1,
  };
  await save("assignment", a);
  const read = await (await request("GET")).json();
  assert.equal(read.assignments[0].dailyMinutes, 240);
  assert.equal(read.organizations.length, 1);
  await save("assignment", { ...a, end: "2026-10-19", version: 2 });
  await save("assignment", { ...a, title: "Stale edit", version: 2 }, 409);
  await save("deleteAssignment", { id: a.id, orgId: org.id, version: 1 }, 409);
  await save(
    "assignment",
    { ...a, id: randomUUID(), start: "2026-10-10", end: "2026-10-11" },
    422,
  );
  const org2 = { ...org, id: randomUUID(), name: "Second studio" };
  await save("organization", org2);
  const otherPerson = { ...p, id: randomUUID(), orgId: org2.id };
  await save("person", otherPerson);
  await save(
    "assignment",
    { ...a, id: randomUUID(), personId: otherPerson.id },
    422,
  );
  await save(
    "person",
    { ...p, orgId: org2.id, name: "Tenant reassignment attempt" },
    409,
  );
  if (!client) {
    client = pg.getPgClient("kivo");
    await client.connect();
  }
  const outsider = randomUUID();
  await client.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    outsider,
    "outsider@local.invalid",
  ]);
  const hiddenOrg = randomUUID();
  await client.query(
    "INSERT INTO organizations(id,name,timezone) VALUES($1,'Hidden','UTC')",
    [hiddenOrg],
  );
  await client.query(
    "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')",
    [hiddenOrg, outsider],
  );
  await save("person", { ...p, id: randomUUID(), orgId: hiddenOrg }, 403);
  await save("organization", { ...org, id: hiddenOrg, name: "Takeover" }, 403);
  const after = await (await request("GET")).json();
  assert.equal(after.organizations.length, 2);
  assert.ok(!after.organizations.some((o) => o.id === hiddenOrg));
  assert.equal(after.people.find((x) => x.id === p.id).orgId, org.id);
  await client.query(
    "UPDATE memberships SET role='viewer' WHERE org_id=$1 AND user_id<>$2",
    [org.id, outsider],
  );
  await save("assignment", { ...a, version: 3 }, 403);
  await client.query(
    "UPDATE memberships SET role='owner' WHERE org_id=$1 AND user_id<>$2",
    [org.id, outsider],
  );
  await save("deleteAssignment", { id: a.id, orgId: org.id, version: 2 });
  assert.equal((await (await request("GET")).json()).assignments.length, 0);
  const audit = await client.query(
    "SELECT count(*)::int AS count FROM audit_events",
  );
  assert.equal(audit.rows[0].count, 8);
  console.log(
    "PASS: API auth, organization/person/project CRUD, allocation persistence, stale edit/delete, weekend validation, tenant foreign keys, tenant immutability, hidden memberships, role authorization, deletion, and transactional audit counts.",
  );
  await verifyCapacity({
    request,
    save,
    client,
    org,
    org2,
    p,
    otherPerson,
    project,
    hiddenOrg,
  });
  if (providers)
    await verifyProviders({ fixture, token, client, org, org2, hiddenOrg });
  else {
    const ready = await fetch("http://127.0.0.1:4000/ready", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(ready.status, 200);
    assert.deepEqual((await ready.json()).services, {
      postgres: "ok",
      redis: "disabled",
      s3: "disabled",
    });
    const unavailable = await fetch(
      `http://127.0.0.1:4000/v1/organizations/${org.id}/files`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filename: "a.csv",
          contentType: "text/csv",
          sizeBytes: 1,
        }),
      },
    );
    assert.equal(unavailable.status, 503);
  }
  if (process.env.KIVO_BROWSER_QA === "1") {
    web = spawn("npm", ["run", "dev"], {
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        NEXT_PUBLIC_STORAGE_MODE: "api",
        KIVO_ALLOW_DEV_AUTH: "1",
        KIVO_DEV_TOKEN: token,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let webReady = false;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch("http://127.0.0.1:3000/api/workspace");
        if (r.status === 200) {
          webReady = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(webReady, "Next proxy did not become ready");
    const forbidden = await fetch("http://127.0.0.1:3000/api/workspace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.invalid",
      },
      body: JSON.stringify({ kind: "person", value: p }),
    });
    assert.equal(forbidden.status, 403);
    console.log(
      "Browser API QA ready at http://127.0.0.1:3000; waiting for SIGINT.",
    );
    await new Promise((r) => process.once("SIGINT", r));
  }
} finally {
  if (web && web.exitCode === null) {
    if (process.platform === "win32") web.kill("SIGTERM");
    else process.kill(-web.pid, "SIGTERM");
    await new Promise((r) => web.once("exit", r));
  }
  if (client) await client.end();
  if (api && api.exitCode === null) {
    api.kill("SIGINT");
    await new Promise((r) => api.once("exit", r));
  }
  await pg.stop().catch(() => {});
  if (fixture) await fixture.close();
  await rm(dir, { recursive: true, force: true });
}
