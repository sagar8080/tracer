// A1 contracts through real PostgreSQL, API, worker and private S3-compatible fixture.
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { providerFixtures } from "./provider-fixtures.mjs";
import { verifyShutdown } from "./test-process-shutdown.mjs";
const root = fileURLToPath(new URL("../", import.meta.url)),
  target = join(root, "target"),
  browserQA = process.env.KIVO_IMPORT_BROWSER_QA === "1";
const token = randomBytes(32).toString("hex"),
  owner = "00000000-0000-4000-8000-000000000002";
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(AWS_|UPSTASH_|KIVO_|AUTH0_|OPENAI_|ANTHROPIC_|GEMINI_|APP_BASE_URL|NEXT_PUBLIC_|DATABASE_|PG)/.test(
        k,
      ),
  ),
);
const env = {
  ...baseEnv,
  CARGO_TARGET_DIR: target,
  CARGO_PROFILE_DEV_DEBUG: "0",
  CARGO_PROFILE_TEST_DEBUG: "0",
  CARGO_INCREMENTAL: "0",
  CARGO_BUILD_JOBS: "2",
};
const dir = await mkdtemp(join(tmpdir(), "kivo-imports-"));
const pg = new EmbeddedPostgres({
  databaseDir: join(dir, "db"),
  user: "kivo",
  password: "isolated",
  port: 55434,
  persistent: false,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
const processes = [];
let client, fixture, model;
let log = "",
  requests = [],
  mode = "valid",
  release = null;
const hint = {
  sheet: 0,
  layout: "tabular",
  person: 1,
  project: 2,
  start: 3,
  end: 4,
  effort: 5,
  rowKey: 0,
  weeks: [],
  unit: "hoursPerDay",
  dateOrder: "iso",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function start(name, args = [], extra = env, cwd = root) {
  const p = spawn(name, args, {
    cwd,
    env: extra,
    stdio: ["ignore", "pipe", "pipe"],
  });
  p.stdout.on("data", (b) => {
    log += b;
  });
  p.stderr.on("data", (b) => {
    log += b;
  });
  processes.push(p);
  return p;
}
async function waitFor(check, label) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await sleep(100);
  }
  throw Error(`Timeout: ${label}\n${log.slice(-4000)}`);
}
async function api(
  path = "/v1/workspace",
  body,
  key = randomUUID(),
  expected = 200,
) {
  const r = await fetch(`http://127.0.0.1:4300${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  assert.equal(r.status, expected, text);
  return text ? JSON.parse(text) : null;
}
async function save(kind, value) {
  await api("/v1/workspace", { kind, value }, undefined, 204);
}
const org = {
  id: randomUUID(),
  name: "Import studio",
  timezone: "America/New_York",
  currency: "USD",
  version: 1,
};
const base = `/v1/organizations/${org.id}/imports`;
const csv =
  "ID,Person,Project,Start,End,Hours per day\na1,Ada,Launch,2026-10-12,2026-10-16,4\na2,Ada,Launch,2026-10-19,2026-10-23,2\n";
async function upload(contents = csv, name = "plan.csv", orgId = org.id) {
  const file = await api(
    `/v1/organizations/${orgId}/files`,
    {
      filename: name,
      contentType: "text/csv",
      sizeBytes: Buffer.byteLength(contents),
    },
    undefined,
    201,
  );
  const r = await fetch(file.upload.url, {
    method: "PUT",
    headers: file.upload.headers,
    body: contents,
  });
  assert.equal(r.status, 200);
  await api(
    `/v1/organizations/${orgId}/files/${file.fileId}/complete`,
    {},
    undefined,
    204,
  );
  return file.fileId;
}
async function parsed(id) {
  let item;
  await waitFor(async () => {
    item = await api(`${base}/${id}`);
    return item.status !== "queued";
  }, "parse");
  assert.equal(item.status, "review");
  return item;
}
function review(item, people, projects) {
  return {
    version: item.version,
    mapping: {
      columns: item.workbook.suggestion ?? hint,
      acceptCachedFormulas: false,
      acceptCalendarDefaults: true,
    },
    people: people ?? [
      {
        label: "Ada",
        id: null,
        weeklyMinutes: [480, 480, 480, 480, 480, 0, 0],
      },
    ],
    projects: projects ?? [{ label: "Launch", id: null }],
  };
}
try {
  const build = start("cargo", ["build", "--locked", "--workspace"]);
  await new Promise((r, j) =>
    build.once("exit", (code) => (code === 0 ? r() : j(Error(log)))),
  );
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("kivo");
  fixture = await providerFixtures();
  // Browser-only local S3 fixture supports the two explicit upload request headers.
  model = createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    const body = JSON.parse(raw);
    requests.push({ path: req.url, headers: req.headers, body });
    if (mode === "hold")
      await new Promise((r) => {
        release = r;
      });
    const mapping = mode === "invalid" ? { ...hint, person: 999 } : hint;
    const text = JSON.stringify(
      mode === "extra" ? { ...mapping, grant: { role: "owner" } } : mapping,
    );
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/responses") {
      assert.equal(req.headers.authorization, "Bearer fixture-openai");
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      res.end(
        JSON.stringify({
          status: mode === "refuse" ? "incomplete" : "completed",
          output: [
            { type: "message", content: [{ type: "output_text", text }] },
          ],
        }),
      );
    } else if (req.url === "/v1/messages") {
      assert.equal(req.headers["x-api-key"], "fixture-claude");
      assert.equal(body.output_config.format.type, "json_schema");
      res.end(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text }],
        }),
      );
    } else {
      assert.match(req.url, /generateContent$/);
      assert.equal(req.headers["x-goog-api-key"], "fixture-gemini");
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      res.end(
        JSON.stringify({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text }] } },
          ],
        }),
      );
    }
  });
  await new Promise((r) => model.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${model.address().port}`;
  const runtime = {
    ...env,
    ...fixture.env,
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
    KIVO_LOAD_ENV: "0",
    KIVO_ALLOW_DEV_AUTH: "1",
    KIVO_DEV_TOKEN: token,
    DATABASE_URL: "postgres://kivo:isolated@127.0.0.1:55434/kivo",
    KIVO_API_BIND: "127.0.0.1:4300",
    KIVO_WORKER_BIND: "127.0.0.1:4302",
    KIVO_WORKER_CONCURRENCY: "2",
    OPENAI_API_KEY: "fixture-openai",
    KIVO_OPENAI_MODEL: "fixture-model",
    ANTHROPIC_API_KEY: "fixture-claude",
    KIVO_CLAUDE_MODEL: "fixture-model",
    GEMINI_API_KEY: "fixture-gemini",
    KIVO_GEMINI_MODEL: "fixture-model",
    KIVO_INFERENCE_LOCAL_TEST: "1",
    KIVO_OPENAI_TEST_ORIGIN: origin,
    KIVO_CLAUDE_TEST_ORIGIN: origin,
    KIVO_GEMINI_TEST_ORIGIN: origin,
  };
  start(join(target, "debug/kivo-api"), [], runtime);
  await waitFor(async () => {
    try {
      return (await fetch("http://127.0.0.1:4300/health")).ok;
    } catch {
      return false;
    }
  }, "API");
  client = pg.getPgClient("kivo");
  await client.connect();
  await save("organization", org);
  start(join(target, "debug/kivo-worker"), [], runtime);
  await waitFor(async () => {
    try {
      return (await fetch("http://127.0.0.1:4302/ready")).ok;
    } catch {
      return false;
    }
  }, "worker");
  const fileId = await upload();
  await api(
    base,
    { fileId, sourceId: null, provider: "openai", consent: false },
    undefined,
    422,
  );
  await api(
    `/v1/organizations/${randomUUID()}/imports`,
    { fileId, sourceId: null, provider: "manual", consent: false },
    undefined,
    403,
  );
  const startKey = randomUUID(),
    input = { fileId, sourceId: null, provider: "manual", consent: false };
  const initial = await api(base, input, startKey);
  assert.equal((await api(base, input, startKey)).id, initial.id);
  await api(base, { ...input, consent: true }, startKey, 409);
  let item = await parsed(initial.id);
  assert.equal(item.workbook.sheets[0].rows[0][1].reference, "CSV!B2");
  let preview = await api(`${base}/${item.id}/review`, review(item));
  assert.equal(preview.preview.totalMinutes, 1800);
  assert.equal(preview.preview.people.length, 1);
  assert.equal(preview.preview.additions.length, 2);
  assert.equal(preview.preview.findings.length, 0);
  const publishKey = randomUUID(),
    publishBody = { version: preview.version };
  item = await api(`${base}/${item.id}/publish`, publishBody, publishKey);
  assert.equal(item.status, "published");
  assert.deepEqual(
    await api(`${base}/${item.id}/publish`, publishBody, publishKey),
    item,
  );
  assert.equal(
    (
      await client.query("SELECT count(*) FROM memberships WHERE org_id=$1", [
        org.id,
      ])
    ).rows[0].count,
    "1",
  );
  let ws = await api();
  assert.equal(ws.people.length, 1);
  assert.equal(ws.assignments.length, 2);
  // Review's dedicated body budget accommodates mappings beyond ordinary 64 KiB commands.
  let large = await parsed(
    (
      await api(base, {
        fileId,
        sourceId: null,
        provider: "manual",
        consent: false,
      })
    ).id,
  );
  const largeReview = review(large);
  largeReview.people.push(
    ...Array.from({ length: 1500 }, (_, i) => ({
      label: `Unused ${i} ${"z".repeat(75)}`,
      id: null,
      weeklyMinutes: null,
    })),
  );
  assert.ok(Buffer.byteLength(JSON.stringify(largeReview)) > 65536);
  large = await api(`${base}/${large.id}/review`, largeReview);
  assert.ok(large.preview.findings.some((f) => f.code === "mappingIdentities"));
  await api(`${base}/${large.id}/cancel`, { version: large.version });
  // Exact refresh is a no-op for resources; stable IDs and versions survive.
  const refresh = await api(base, {
    fileId: await upload(),
    sourceId: item.sourceId,
    provider: "manual",
    consent: false,
  });
  let next = await parsed(refresh.id);
  assert.ok(next.review.people[0].id);
  next = await api(`${base}/${next.id}/review`, {
    ...next.review,
    version: next.version,
  });
  assert.equal(next.preview.additions.length, 0);
  assert.equal(next.preview.updates.length, 0);
  assert.equal(next.preview.removals.length, 0);
  next = await api(`${base}/${next.id}/publish`, { version: next.version });
  assert.equal(next.sourceVersion, 2);
  // Updated and removed rows are previewed, not automatically committed.
  let changed = await parsed(
    (
      await api(base, {
        fileId: await upload(csv.replace(",4\n", ",6\n").split("a2,")[0]),
        sourceId: item.sourceId,
        provider: "manual",
        consent: false,
      })
    ).id,
  );
  changed = await api(`${base}/${changed.id}/review`, {
    ...changed.review,
    version: changed.version,
  });
  assert.equal(changed.preview.updates.length, 1);
  assert.equal(changed.preview.removals.length, 1);
  ws = await api();
  assert.equal(ws.assignments[0].dailyMinutes, 240);
  // New human edits invalidate review and refresh can never overwrite them.
  await save("assignment", {
    ...ws.assignments[0],
    dailyMinutes: 300,
    version: ws.assignments[0].version + 1,
  });
  await api(
    `${base}/${changed.id}/publish`,
    { version: changed.version },
    undefined,
    409,
  );
  changed = await api(`${base}/${changed.id}/review`, {
    ...changed.review,
    version: changed.version,
  });
  assert.ok(changed.preview.findings.some((f) => f.code === "humanEdit"));
  await api(
    `${base}/${changed.id}/publish`,
    { version: changed.version },
    undefined,
    422,
  );
  assert.equal((await api()).assignments[0].dailyMinutes, 300);
  // Weekly matrix uses Monday columns and exact working-day distribution.
  const weeklyFile = await upload(
    "ID,Person,Project,2026-10-12,2026-10-19\nw1,Ada,Launch,20,10\n",
    "weekly.csv",
  );
  let weekly = await parsed(
    (
      await api(base, {
        fileId: weeklyFile,
        sourceId: null,
        provider: "manual",
        consent: false,
      })
    ).id,
  );
  weekly = await api(
    `${base}/${weekly.id}/review`,
    review(
      weekly,
      [{ label: "Ada", id: ws.people[0].id, weeklyMinutes: null }],
      [{ label: "Launch", id: ws.projects[0].id }],
    ),
  );
  assert.equal(weekly.preview.totalMinutes, 1800);
  assert.deepEqual(
    weekly.preview.additions.map((a) => a.dailyMinutes),
    [240, 120],
  );
  weekly = await api(`${base}/${weekly.id}/publish`, {
    version: weekly.version,
  });
  assert.equal(weekly.status, "published");
  // Role enforcement covers review/publication and reading workbook contents.
  await client.query(
    "UPDATE memberships SET role='planner' WHERE org_id=$1 AND user_id=$2",
    [org.id, owner],
  );
  let planner = await parsed(
    (
      await api(base, {
        fileId: await upload(csv.replaceAll("Ada", "New person")),
        sourceId: null,
        provider: "manual",
        consent: false,
      })
    ).id,
  );
  planner = await api(
    `${base}/${planner.id}/review`,
    review(
      planner,
      [
        {
          label: "New person",
          id: null,
          weeklyMinutes: [480, 480, 480, 480, 480, 0, 0],
        },
      ],
      [{ label: "Launch", id: ws.projects[0].id }],
    ),
  );
  assert.ok(
    planner.preview.findings.some((f) => f.code === "personPermission"),
  );
  await api(
    `${base}/${planner.id}/publish`,
    { version: planner.version },
    undefined,
    422,
  );
  await client.query(
    "UPDATE memberships SET role='viewer' WHERE org_id=$1 AND user_id=$2",
    [org.id, owner],
  );
  await api(base, undefined, undefined, 403);
  await api(`${base}/${item.id}`, undefined, undefined, 403);
  await api(`${base}/${item.id}/publish`, publishBody, publishKey, 403);
  await client.query(
    "UPDATE memberships SET role='owner' WHERE org_id=$1 AND user_id=$2",
    [org.id, owner],
  );
  // All three protocols, refusals and malicious out-of-bounds suggestions stay inert.
  for (const provider of ["openai", "claude", "gemini"]) {
    const p = await parsed(
      (await api(base, { fileId, sourceId: null, provider, consent: true })).id,
    );
    assert.equal(p.workbook.suggestionProvider, provider);
    await api(`${base}/${p.id}/cancel`, { version: p.version });
  }
  for (const bad of ["invalid", "refuse", "extra"]) {
    mode = bad;
    const p = await parsed(
      (
        await api(base, {
          fileId,
          sourceId: null,
          provider: "openai",
          consent: true,
        })
      ).id,
    );
    assert.ok(
      p.workbook.findings.some((f) => f.code === "inferenceUnavailable"),
    );
    assert.equal(p.workbook.suggestionProvider, "manual");
    await api(`${base}/${p.id}/cancel`, { version: p.version });
  }
  mode = "valid";
  const calls = requests.length;
  mode = "hold";
  const held = await api(base, {
    fileId,
    sourceId: null,
    provider: "openai",
    consent: true,
  });
  await waitFor(
    () => requests.length > calls && release,
    "held provider request",
  );
  const queuedPeer = await api(base, {
    fileId,
    sourceId: null,
    provider: "manual",
    consent: false,
  });
  await sleep(200);
  assert.equal(
    (
      await client.query(
        "SELECT count(*) FROM durable_jobs WHERE org_id=$1 AND status='running' AND lease_until>now()",
        [org.id],
      )
    ).rows[0].count,
    "1",
  );
  assert.equal((await api(`${base}/${queuedPeer.id}`)).status, "queued");
  await api(`${base}/${queuedPeer.id}/cancel`, { version: queuedPeer.version });
  const heldDoc = await api(`${base}/${held.id}`);
  await api(`${base}/${held.id}/cancel`, { version: heldDoc.version });
  mode = "valid";
  release();
  release = null;
  await sleep(600);
  assert.equal((await api(`${base}/${held.id}`)).status, "cancelled");
  // Access revoked during inference fences completion; staged state survives.
  mode = "hold";
  const revoked = await api(base, {
    fileId,
    sourceId: null,
    provider: "openai",
    consent: true,
  });
  await waitFor(() => release, "held revoked request");
  await client.query(
    "UPDATE memberships SET role='viewer' WHERE org_id=$1 AND user_id=$2",
    [org.id, owner],
  );
  mode = "valid";
  release();
  release = null;
  await sleep(700);
  const revokedData = (
    await client.query("SELECT data,status FROM workbook_imports WHERE id=$1", [
      revoked.id,
    ])
  ).rows[0];
  assert.equal(revokedData.status, "queued");
  assert.equal(revokedData.data.workbook, null);
  await client.query(
    "UPDATE memberships SET role='owner' WHERE org_id=$1 AND user_id=$2",
    [org.id, owner],
  );
  await api(`${base}/${revoked.id}/cancel`, {
    version: revokedData.data.version,
  });
  // Lease expiry/reclaim fences an older response, with one completion and no duplicate effects.
  mode = "hold";
  const leaseItem = await api(base, {
    fileId,
    sourceId: null,
    provider: "openai",
    consent: true,
  });
  await waitFor(() => release, "held lease");
  const oldRelease = release;
  release = null;
  await client.query(
    "UPDATE durable_jobs SET lease_until=now()-interval '1 second' WHERE entity_id=$1",
    [leaseItem.id],
  );
  mode = "valid";
  const reclaimed = await parsed(leaseItem.id);
  oldRelease();
  await sleep(600);
  assert.equal(
    (await api(`${base}/${leaseItem.id}`)).version,
    reclaimed.version,
  );
  const job = (
    await client.query(
      "SELECT fence,attempts,status FROM durable_jobs WHERE entity_id=$1",
      [leaseItem.id],
    )
  ).rows[0];
  assert.equal(job.attempts, 2);
  assert.equal(job.status, "done");
  // Publication rollback: force the last command to conflict after earlier inserts.
  let rollback = await parsed(
    (
      await api(base, {
        fileId: await upload(csv.replaceAll("Ada", "Rollback person")),
        sourceId: null,
        provider: "manual",
        consent: false,
      })
    ).id,
  );
  rollback = await api(
    `${base}/${rollback.id}/review`,
    review(rollback, [
      {
        label: "Rollback person",
        id: null,
        weeklyMinutes: [480, 480, 480, 480, 480, 0, 0],
      },
    ]),
  );
  const duplicate = rollback.preview.additions[1];
  await client.query(
    "INSERT INTO assignments(id,org_id,person_id,project_id,title,start_date,end_date,daily_minutes,status,version) VALUES($1,$2,$3,$4,'Conflicting record','2026-10-12','2026-10-12',60,'confirmed',1)",
    [duplicate.id, org.id, ws.people[0].id, ws.projects[0].id],
  );
  const before = (
    await client.query("SELECT count(*) FROM audit_events WHERE org_id=$1", [
      org.id,
    ])
  ).rows[0].count;
  await api(
    `${base}/${rollback.id}/publish`,
    { version: rollback.version },
    undefined,
    409,
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*) FROM people WHERE name='Rollback person'",
      )
    ).rows[0].count,
    "0",
  );
  assert.equal(
    (
      await client.query("SELECT count(*) FROM audit_events WHERE org_id=$1", [
        org.id,
      ])
    ).rows[0].count,
    before,
  );
  // Export pins the publication, not the now-edited live allocation.
  let exported = await api(`${base}/${item.id}/export`, {
    version: item.version,
  });
  await waitFor(async () => {
    exported = await api(`${base}/${item.id}`);
    return exported.exportFileId;
  }, "export");
  const download = await api(
    `/v1/organizations/${org.id}/files/${exported.exportFileId}/download`,
    {},
  );
  const exportedCSV = await (await fetch(download.download.url)).text();
  assert.match(exportedCSV, /Ada,Launch/);
  assert.match(exportedCSV, /,240,/);
  assert.doesNotMatch(exportedCSV, /,300,/);
  const summary = await api(base);
  assert.equal(summary.imports[0].workbook, null);
  assert.equal(summary.imports[0].preview, null);
  assert.equal(
    (
      await client.query(
        "SELECT count(*) FROM _sqlx_migrations WHERE success=true",
      )
    ).rows[0].count,
    "9",
  );
  console.log(
    "PASS A1: private upload, both layouts and provider boundaries, replay, review, atomic publication/rollback, refresh, human edits, RBAC, three providers, cancellation, lease reclaim and pinned CSV export.",
  );
  if (!browserQA) {
    for (const child of processes)
      if (/kivo-(api|worker)$/.test(child.spawnfile) && child.exitCode === null)
        await verifyShutdown(child);
    console.log(
      "PASS: API/worker finish with code 0 on SIGTERM; job contracts remain intact.",
    );
  }
  if (browserQA) {
    start(join(target, "debug/kivo-realtime-server"), [], {
      ...runtime,
      KIVO_REALTIME_BIND: "127.0.0.1:4301",
      KIVO_WEB_ORIGIN: "http://127.0.0.1:3002",
    });
    await waitFor(async () => {
      try {
        return (await fetch("http://127.0.0.1:4301/health")).ok;
      } catch {
        return false;
      }
    }, "realtime");
    const webDir = join(root, "output/import-web-qa");
    await rm(webDir, { recursive: true, force: true });
    await mkdir(webDir, { recursive: true });
    for (const name of [
      "src",
      "public",
      "package.json",
      "next.config.ts",
      "postcss.config.mjs",
      "tsconfig.json",
      "next-env.d.ts",
      "AGENTS.md",
    ])
      await cp(join(root, "apps/web", name), join(webDir, name), {
        recursive: true,
      });
    await writeFile(
      join(root, "output/import-browser-fixture.json"),
      JSON.stringify({
        orgId: org.id,
        webOrigin: "http://127.0.0.1:3002",
        csv,
      }),
    );
    start(
      join(root, "node_modules/.bin/next"),
      ["dev", "--hostname", "127.0.0.1", "--port", "3002"],
      {
        ...baseEnv,
        KIVO_AUTH_MODE: "development",
        NEXT_PUBLIC_STORAGE_MODE: "api",
        NEXT_PUBLIC_REALTIME_URL: "ws://127.0.0.1:4301/ws",
        KIVO_ALLOW_DEV_AUTH: "1",
        KIVO_DEV_TOKEN: token,
        KIVO_API_URL: "http://127.0.0.1:4300",
      },
      webDir,
    );
    console.log(
      "A1 browser fixture ready at http://127.0.0.1:3002/app. Press Ctrl+C to stop.",
    );
    await new Promise((r) => process.once("SIGINT", r));
  }
} finally {
  release?.();
  for (const child of processes)
    if (child.exitCode === null) {
      child.kill("SIGINT");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        sleep(2000),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  await client?.end();
  await fixture?.close();
  if (model)
    await new Promise((r) => {
      model.closeAllConnections();
      model.close(r);
    });
  await pg.stop().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
