// Real production Next standalone + Caddy HTTPS/WSS + local OIDC/API fixtures.
// No cloud account, hosted credentials, database or trust-store installation.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, cp, readFile, writeFile, readdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { auth0Fixture } from "./auth0-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder = join(root, "output/self-hosted-qa"),
  origin = "https://localhost:3443";
const source = process.env.KIVO_WEB_BUILD_DIR ?? join(root, "apps/web");
const caddy = process.env.KIVO_CADDY_BINARY ?? "caddy";
const processes = [];
let fixture,
  api,
  live,
  sockets,
  log = "",
  apiTokens = 0,
  upgrades = 0;
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(AWS_|UPSTASH_|KIVO_|AUTH0_|OPENAI_|ANTHROPIC_|GEMINI_|APP_BASE_URL|NEXT_PUBLIC_|DATABASE_|PG|NODE_EXTRA_CA_CERTS)/.test(
        k,
      ),
  ),
);
function start(file, args, extra = {}) {
  const child = spawn(file, args, {
    cwd: root,
    env: { ...baseEnv, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.push(child);
  child.stdout.on("data", (b) => {
    log += b;
  });
  child.stderr.on("data", (b) => {
    log += b;
  });
  return child;
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function execute(file, args, env = {}) {
  const result = spawnSync(file, args, {
    cwd: root,
    env: { ...baseEnv, ...env },
    encoding: "utf8",
  });
  if (result.error || result.status !== 0)
    throw Error(
      `${file} failed: ${result.stderr?.slice(-1000) ?? result.error?.message}`,
    );
  return result.stdout;
}
async function noEnvFiles(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    assert.ok(
      !item.name.startsWith(".env"),
      "Standalone build must not contain environment files",
    );
    if (item.isDirectory()) await noEnvFiles(join(dir, item.name));
  }
}
try {
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const key = join(folder, "key.pem"),
    cert = join(folder, "cert.pem");
  await writeFile(
    join(folder, "openssl.cnf"),
    `[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,DNS:www.localhost,DNS:auth.kivo.test,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyCertSign\nextendedKeyUsage=serverAuth\n`,
  );
  execute("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    key,
    "-out",
    cert,
    "-config",
    join(folder, "openssl.cnf"),
  ]);
  const ca = await readFile(cert),
    tls = { key: await readFile(key), cert: ca };
  fixture = await auth0Fixture({ webOrigin: origin, tls });
  const jar = new Map();
  function request(
    path,
    {
      host = "localhost:3443",
      cookies = true,
      method = "GET",
      headers = {},
      body,
    } = {},
  ) {
    return new Promise((resolveRequest, reject) => {
      const req = httpsRequest(
        new URL(path, origin),
        {
          ca,
          method,
          headers: {
            Host: host,
            ...(cookies
              ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }
              : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (b) => chunks.push(b));
          res.on("end", () => {
            for (const cookie of res.headers["set-cookie"] ?? []) {
              const pair = cookie.split(";", 1)[0],
                i = pair.indexOf("=");
              if (pair.slice(i + 1))
                jar.set(pair.slice(0, i), pair.slice(i + 1));
              else jar.delete(pair.slice(0, i));
            }
            resolveRequest({
              status: res.statusCode,
              headers: res.headers,
              text: Buffer.concat(chunks).toString(),
            });
          });
        },
      );
      req.setTimeout(15000, () => req.destroy(Error("HTTPS request timeout")));
      req.once("error", reject);
      req.end(body);
    });
  }
  api = createServer((req, res) => {
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      res.writeHead(401).end();
      return;
    }
    apiTokens++;
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end('{"ok":true}');
  });
  await new Promise((r) => api.listen(4400, "127.0.0.1", r));
  live = createServer();
  sockets = new WebSocketServer({ noServer: true });
  live.on("upgrade", (req, socket, head) => {
    if (req.headers.origin !== origin) {
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      upgrades++;
      ws.send('{"type":"fixture"}');
    });
  });
  await new Promise((r) => live.listen(4401, "127.0.0.1", r));
  await cp(join(source, ".next/standalone"), join(folder, "app"), {
    recursive: true,
  });
  await noEnvFiles(join(folder, "app"));
  const app = join(folder, "app/apps/web");
  await cp(join(source, ".next/static"), join(app, ".next/static"), {
    recursive: true,
  });
  await cp(join(source, "public"), join(app, "public"), { recursive: true });
  // Production Auth0 requires a public-style issuer on HTTPS port 443. Redirect
  // only this reserved fixture hostname to our trusted local TLS transport.
  // SDK domain/state/PKCE validation remains enabled; no OS DNS/trust changes.
  const transport = join(folder, "fixture-transport.cjs");
  await writeFile(
    transport,
    `const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "auth.kivo.test") { url.hostname = "localhost"; url.port = "4455"; }
  else if (url.origin === "http://api:4000") { url.hostname = "127.0.0.1"; url.port = "4400"; }
  else return original(input, init);
  return original(input instanceof Request ? new Request(url, input) : url, init);
};\n`,
  );
  start(process.execPath, [join(app, "server.js")], {
    NODE_ENV: "production",
    NODE_EXTRA_CA_CERTS: cert,
    NODE_OPTIONS: `--require ${transport}`,
    HOSTNAME: "127.0.0.1",
    PORT: "3004",
    NEXT_PUBLIC_STORAGE_MODE: "api",
    KIVO_AUTH_MODE: "auth0",
    APP_BASE_URL: origin,
    AUTH0_DOMAIN: fixture.issuer,
    AUTH0_CLIENT_ID: fixture.clientId,
    AUTH0_CLIENT_SECRET: fixture.clientSecret,
    AUTH0_AUDIENCE: fixture.audience,
    AUTH0_SECRET: randomBytes(32).toString("hex"),
    KIVO_API_URL: "http://api:4000",
    KIVO_INTERNAL_API_ORIGIN: "http://api:4000",
  });
  // Adapt the actual production routes. Only listeners, upstream addresses and
  // the test certificate change; automatic public ACME is disabled in this test.
  const json = JSON.parse(
    execute(
      caddy,
      ["adapt", "--config", "deploy/Caddyfile", "--adapter", "caddyfile"],
      { SITE_HOST: "localhost:3443", ACME_EMAIL: "ops@kivo.test" },
    ),
  );
  for (const server of Object.values(json.apps.http.servers)) {
    server.listen = ["127.0.0.1:3443"];
    server.automatic_https = { disable: true };
    server.tls_connection_policies = [
      { certificate_selection: { any_tag: ["fixture"] } },
    ];
  }
  json.apps.tls = {
    certificates: {
      load_files: [{ certificate: cert, key, tags: ["fixture"] }],
    },
  };
  let encoded = JSON.stringify(json)
    .replaceAll("web:3000", "127.0.0.1:3004")
    .replaceAll("api:4000", "127.0.0.1:4400")
    .replaceAll("realtime:4001", "127.0.0.1:4401");
  await writeFile(join(folder, "caddy.json"), encoded);
  start(caddy, ["run", "--config", join(folder, "caddy.json")], {
    XDG_DATA_HOME: join(folder, "data"),
    XDG_CONFIG_HOME: join(folder, "config"),
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request("/health")).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, `Production startup timed out\n${log.slice(-1500)}`);
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.text, /Kivo/);
  const asset = /src="([^"]*\/_next\/static\/[^\"]+)"/.exec(page.text)?.[1];
  assert.ok(asset, "Production page must reference a real JS asset");
  assert.equal((await request(asset)).status, 200);
  assert.equal((await request("/import-examples/allocations.csv")).status, 200);
  assert.equal(
    (await request("/api/workspace", { cookies: false })).status,
    401,
  );
  assert.equal(apiTokens, 0, "Anonymous browser must not reach the API");
  assert.equal(
    (await request("/v1/workspace", { cookies: false })).status,
    401,
  );
  const alias = await request("/join?source=fixture", {
    host: "www.localhost:3443",
    cookies: false,
  });
  assert.equal(alias.status, 308);
  assert.equal(alias.headers.location, `${origin}/join?source=fixture`);
  assert.equal(alias.headers["set-cookie"], undefined);
  const login = await request("/auth/login?returnTo=%2Fjoin");
  assert.equal(login.status, 307);
  assert.ok(
    login.headers["set-cookie"].some(
      (c) => /;\s*Secure(?:;|$)/i.test(c) && /;\s*HttpOnly(?:;|$)/i.test(c),
    ),
  );
  const authorize = new URL(login.headers.location);
  authorize.searchParams.set("fixture_user", "alice");
  assert.equal(
    authorize.searchParams.get("redirect_uri"),
    `${origin}/auth/callback`,
  );
  // Use the fixture issuer with the same trusted local certificate.
  const callback = await new Promise((r, reject) => {
    const req = httpsRequest(
      authorize,
      { ca, hostname: "localhost", port: 4455 },
      (res) => {
        res.resume();
        assert.equal(res.statusCode, 302);
        r(res.headers.location);
      },
    );
    req.once("error", reject);
    req.end();
  });
  assert.ok(callback, "Fixture must return a callback");
  const before = fixture.state.tokenRequests;
  const lost = await request(callback, { cookies: false });
  assert.equal(lost.headers.location, `${origin}/auth/recover?reason=state`);
  assert.equal(fixture.state.tokenRequests, before);
  const accepted = await request(callback);
  assert.equal(accepted.status, 307);
  assert.equal(accepted.headers.location, `${origin}/join`);
  assert.ok(
    accepted.headers["set-cookie"].some(
      (c) => c.startsWith("__session") && /;\s*Secure(?:;|$)/i.test(c),
    ),
  );
  const profile = await request("/auth/profile");
  assert.equal(profile.status, 200);
  assert.ok(JSON.parse(profile.text).email);
  const forwarded = await request("/api/workspace");
  assert.equal(forwarded.status, 200);
  assert.deepEqual(JSON.parse(forwarded.text), { ok: true });
  assert.equal(apiTokens, 1);
  const rejected = await request("/api/workspace", {
    method: "POST",
    headers: {
      Origin: "https://other.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(rejected.status, 403);
  assert.equal(apiTokens, 1);
  await new Promise((r, reject) => {
    const ws = new WebSocket(`${origin.replace("https:", "wss:")}/ws`, {
      ca,
      origin,
    });
    ws.once("error", reject);
    ws.once("message", (data) => {
      assert.match(data.toString(), /fixture/);
      ws.close();
      r();
    });
  });
  await new Promise((r, reject) => {
    const ws = new WebSocket(`${origin.replace("https:", "wss:")}/ws`, {
      ca,
      origin: "https://other.invalid",
    });
    ws.once("open", () => {
      ws.close();
      reject(Error("Cross-origin WSS accepted"));
    });
    ws.once("unexpected-response", (_req, res) => {
      try {
        assert.equal(res.statusCode, 403);
        res.resume();
        r();
      } catch (e) {
        reject(e);
      }
    });
    ws.once("error", () => {});
  });
  assert.equal(upgrades, 1);
  console.log(
    "PASS: production standalone assets, Caddy HTTPS/canonical routing, secure SDK cookies, PKCE login/state recovery, private BFF token forwarding/CSRF and WSS origin checks. Fixtures only; no hosted deployment claim.",
  );
  if (process.env.KIVO_SELF_HOSTED_BROWSER_QA === "1") {
    console.log(
      `READY: production fixture at ${origin}. Browser uses an isolated untrusted test certificate. Ctrl+C to stop.`,
    );
    await new Promise((r) => process.once("SIGINT", r));
  }
} finally {
  await writeFile(join(folder, "process-logs.txt"), log);
  for (const ws of sockets?.clients ?? []) ws.terminate();
  for (const child of processes.reverse())
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        delay(3000),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  await fixture?.close();
  for (const server of [api, live])
    if (server)
      await new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      });
}
