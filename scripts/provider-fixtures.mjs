// Protocol fixtures, not emulators of AWS IAM, SigV4 validation or Redis Lua.
// They exercise real HTTP clients without contacting hosted services.
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function providerFixtures() {
  const state = {
    redisFailure: false,
    s3Failure: false,
    count: 0,
    objects: new Map(),
  };
  const redis = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (state.redisFailure) {
      res.writeHead(503).end(JSON.stringify({ error: "fixture unavailable" }));
      return;
    }
    assert.equal(req.headers.authorization, "Bearer fixture-redis-token");
    assert.equal(req.method, "POST");
    let raw = "";
    for await (const part of req) raw += part;
    const command = JSON.parse(raw);
    if (command[0] === "PING") res.end(JSON.stringify({ result: "PONG" }));
    else {
      assert.equal(command[0], "EVAL");
      assert.equal(command[2], "1");
      assert.match(command[3], /^kivo:test:rate:[0-9a-f-]{36}$/);
      res.end(JSON.stringify({ result: [++state.count, 60] }));
    }
  });
  const s3 = createServer(async (req, res) => {
    if (state.s3Failure) {
      res.writeHead(503).end();
      return;
    }
    const path = new URL(req.url, "http://fixture").pathname;
    if (path === "/kivo-test" || path === "/kivo-test/") {
      res.writeHead(200).end();
      return;
    }
    assert.match(
      path,
      /^\/kivo-test\/kivo-test\/organizations\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}$/,
    );
    if (req.method === "PUT") {
      assert.equal(req.headers["if-none-match"], "*");
      if (state.objects.has(path)) {
        res.writeHead(412).end();
        return;
      }
      const chunks = [];
      for await (const part of req) chunks.push(part);
      state.objects.set(path, {
        body: Buffer.concat(chunks),
        type: req.headers["content-type"],
      });
      res.setHeader("ETag", '"test-etag"');
      res.writeHead(200).end();
      return;
    }
    const object = state.objects.get(path);
    if (!object) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", object.type);
    res.setHeader("Content-Length", object.body.length);
    res.setHeader("ETag", '"test-etag"');
    res.writeHead(200).end(req.method === "HEAD" ? undefined : object.body);
  });
  for (const server of [redis, s3])
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  return {
    state,
    env: {
      UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${redis.address().port}`,
      UPSTASH_REDIS_REST_TOKEN: "fixture-redis-token",
      KIVO_REDIS_PREFIX: "kivo:test",
      KIVO_RATE_LIMIT_PER_MINUTE: "120",
      KIVO_S3_BUCKET: "kivo-test",
      KIVO_S3_PREFIX: "kivo-test",
      KIVO_S3_ENDPOINT_URL: `http://127.0.0.1:${s3.address().port}`,
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "fixture-access-key",
      AWS_SECRET_ACCESS_KEY: "fixture-secret-key",
      AWS_EC2_METADATA_DISABLED: "true",
    },
    async close() {
      await Promise.all(
        [redis, s3].map(
          (server) =>
            new Promise((resolve) => {
              server.closeAllConnections();
              server.close(resolve);
            }),
        ),
      );
    },
  };
}

export async function verifyProviders({
  fixture,
  token,
  client,
  org,
  org2,
  hiddenOrg,
}) {
  const api = async (path, method = "POST", body, authenticated = true, key) =>
    fetch(`http://127.0.0.1:4000${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const base = `/v1/organizations/${org.id}/files`;
  const upload = {
    filename: "schedule.csv",
    contentType: "text/csv",
    sizeBytes: 7,
  };
  assert.equal((await api("/ready", "GET", undefined, false)).status, 401);
  const health = await api("/ready", "GET");
  assert.equal(health.status, 200);
  assert.deepEqual((await health.json()).services, {
    postgres: "ok",
    redis: "ok",
    s3: "ok",
  });
  assert.equal((await api(base, "POST", upload, false)).status, 401);
  assert.equal(
    (await api(`/v1/organizations/${hiddenOrg}/files`, "POST", upload)).status,
    403,
  );
  assert.equal(
    (await api(base, "POST", { ...upload, sizeBytes: 10485761 })).status,
    422,
  );
  assert.equal(
    (await api(base, "POST", { ...upload, filename: "../leak" })).status,
    422,
  );
  assert.equal(
    (await api(base, "POST", { ...upload, objectKey: "someone-elses-file" }))
      .status,
    422,
  );
  const requestId = randomUUID();
  const reservation = await api(base, "POST", upload, true, requestId);
  assert.equal(reservation.status, 201, await reservation.clone().text());
  assert.equal(reservation.headers.get("cache-control"), "private, no-store");
  const { fileId, upload: signed } = await reservation.json();
  const retried = await api(base, "POST", upload, true, requestId);
  assert.equal(retried.status, 201);
  assert.equal((await retried.json()).fileId, fileId);
  assert.equal(
    (
      await api(
        base,
        "POST",
        { ...upload, filename: "different.csv" },
        true,
        requestId,
      )
    ).status,
    409,
  );
  assert.equal(signed.expiresInSeconds, 300);
  assert.equal(signed.method, "PUT");
  assert.equal((await api(`${base}/${fileId}/download`)).status, 422);
  assert.equal((await api(`${base}/${fileId}/complete`)).status, 422);
  assert.equal(
    (await api(`/v1/organizations/${org2.id}/files/${fileId}/download`)).status,
    404,
  );
  const put = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: "a,b\n1,2",
  });
  assert.equal(put.status, 200);
  assert.equal(
    (
      await fetch(signed.url, {
        method: "PUT",
        headers: signed.headers,
        body: "a,b\n1,2",
      })
    ).status,
    412,
  );
  // HEAD metadata disagreement must not advance the SQL record to ready.
  const object = fixture.state.objects.get(new URL(signed.url).pathname);
  object.type = "application/pdf";
  assert.equal((await api(`${base}/${fileId}/complete`)).status, 422);
  object.type = "text/csv";
  fixture.state.s3Failure = true;
  assert.equal((await api(`${base}/${fileId}/complete`)).status, 503);
  assert.equal((await api("/ready", "GET")).status, 503);
  fixture.state.s3Failure = false;
  assert.equal((await api(`${base}/${fileId}/complete`)).status, 204);
  assert.equal((await api(`${base}/${fileId}/complete`)).status, 204);
  const download = await api(`${base}/${fileId}/download`);
  assert.equal(download.status, 200);
  const body = await download.json();
  assert.equal(body.file.status, "ready");
  assert.equal(body.file.objectKey, undefined);
  assert.equal(await (await fetch(body.download.url)).text(), "a,b\n1,2");
  await client.query("UPDATE memberships SET role='viewer' WHERE org_id=$1", [
    org.id,
  ]);
  assert.equal((await api(base, "POST", upload)).status, 403);
  assert.equal((await api(`${base}/${fileId}/download`)).status, 200);
  await client.query("DELETE FROM memberships WHERE org_id=$1", [org.id]);
  assert.equal((await api(`${base}/${fileId}/download`)).status, 403);
  const audit = await client.query(
    "SELECT action FROM audit_events WHERE entity_id=$1 ORDER BY action",
    [fileId],
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ["file.complete", "file.reserve"],
  );
  fixture.state.count = 120;
  const limited = await api("/v1/workspace", "GET");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  fixture.state.count = 0;
  fixture.state.redisFailure = true;
  assert.equal((await api("/v1/workspace", "GET")).status, 503);
  assert.equal((await api("/ready", "GET")).status, 503);
  fixture.state.redisFailure = false;
  assert.equal((await api("/v1/workspace", "GET")).status, 200);
  console.log(
    "PASS: provider HTTP contracts, readiness, rate limits and outage recovery; private file lifecycle, conditional uploads, metadata verification, tenant isolation, role checks and idempotent completion.",
  );
}
