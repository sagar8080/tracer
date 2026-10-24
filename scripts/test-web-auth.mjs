// Real Next.js/Auth0 SDK cookie and callback contracts with a local OIDC issuer.
// No hosted environment, cloud credentials or database mutations.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auth0Fixture } from "./auth0-fixture.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:3002",
  alias = "http://localhost:3002";
const fixture = await auth0Fixture({ webOrigin: origin });
const folder = join(root, "output/auth-web-qa");
let web,
  log = "";
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(AWS_|UPSTASH_|KIVO_|AUTH0_|OPENAI_|ANTHROPIC_|GEMINI_|APP_BASE_URL|NEXT_PUBLIC_|DATABASE_|PG)/.test(
        key,
      ),
  ),
);
const sessionSecret = randomBytes(32).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jar = new Map();
function cookiesFor(url) {
  return [...(jar.get(new URL(url).hostname) ?? new Map())]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
async function request(url, options = {}) {
  const r = await fetch(url, {
    redirect: "manual",
    ...options,
    headers: {
      ...(options.cookies === false ? {} : { Cookie: cookiesFor(url) }),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  const host = new URL(url).hostname,
    cookies = jar.get(host) ?? new Map();
  for (const cookie of r.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0],
      split = pair.indexOf("="),
      name = pair.slice(0, split),
      value = pair.slice(split + 1);
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
  jar.set(host, cookies);
  return r;
}
function destination(r, url) {
  return new URL(r.headers.get("location"), url);
}
async function freshLogin(returnTo = "/app") {
  const login = await request(
    `${alias}/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  );
  assert.equal(login.status, 307);
  assert.equal(login.headers.getSetCookie().length, 0);
  const canonical = destination(login, alias);
  assert.equal(canonical.origin, origin);
  assert.equal(canonical.pathname, "/auth/login");
  const authorization = await request(canonical);
  assert.equal(authorization.status, 307);
  assert.ok(
    authorization.headers.getSetCookie().some((c) => c.startsWith("__txn_")),
  );
  const authorize = destination(authorization, origin);
  assert.equal(authorize.origin, new URL(fixture.issuer).origin);
  assert.equal(
    authorize.searchParams.get("redirect_uri"),
    `${origin}/auth/callback`,
  );
  authorize.searchParams.set("fixture_user", "alice");
  const accepted = await request(authorize);
  assert.equal(accepted.status, 302);
  return destination(accepted, fixture.issuer);
}
try {
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  for (const name of [
    "src",
    "public",
    "next.config.ts",
    "postcss.config.mjs",
    "tsconfig.json",
    "package.json",
    "next-env.d.ts",
  ])
    await cp(join(root, "apps/web", name), join(folder, name), {
      recursive: true,
    });
  web = spawn(
    process.execPath,
    [
      join(root, "node_modules/next/dist/bin/next"),
      "dev",
      folder,
      "--hostname",
      "127.0.0.1",
      "--port",
      "3002",
    ],
    {
      cwd: root,
      env: {
        ...baseEnv,
        KIVO_AUTH_MODE: "auth0",
        KIVO_AUTH0_LOCAL_TEST: "1",
        AUTH0_DOMAIN: fixture.issuer,
        AUTH0_CLIENT_ID: fixture.clientId,
        AUTH0_CLIENT_SECRET: fixture.clientSecret,
        AUTH0_SECRET: sessionSecret,
        AUTH0_AUDIENCE: fixture.audience,
        APP_BASE_URL: origin,
        NEXT_PUBLIC_STORAGE_MODE: "api",
        KIVO_API_URL: "http://127.0.0.1:4999",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  web.stdout.on("data", (b) => {
    log += b;
  });
  web.stderr.on("data", (b) => {
    log += b;
  });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if (
        (await fetch(`${origin}/`, { signal: AbortSignal.timeout(1000) })).ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    if (web.exitCode !== null) throw Error("Isolated frontend did not start");
    await sleep(100);
  }
  assert.ok(ready, "Frontend startup timed out");
  const callback = await freshLogin("/join");
  // Losing the transaction cookie must not exchange a code or establish a session.
  const tokensBefore = fixture.state.tokenRequests;
  const rejected = await request(callback, { cookies: false });
  assert.equal(
    destination(rejected, origin).href,
    `${origin}/auth/recover?reason=state`,
  );
  assert.equal(fixture.state.tokenRequests, tokensBefore);
  assert.ok(
    !rejected.headers.getSetCookie().some((c) => c.startsWith("__session")),
  );
  const recovered = await request(`${origin}/auth/recover?reason=state`, {
    cookies: false,
  });
  assert.equal(recovered.status, 200);
  assert.match(await recovered.text(), /Sign in again/);
  // The original valid transaction still completes, preserving invitation navigation.
  const completed = await request(callback);
  assert.equal(completed.status, 307);
  assert.equal(destination(completed, origin).href, `${origin}/join`);
  assert.equal(fixture.state.tokenRequests, tokensBefore + 1);
  const profile = await request(`${origin}/auth/profile`);
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).email, "alice@studio.test");
  // Replaying a consumed callback cannot mint a session; an existing one can return to app.
  const replay = await request(callback);
  assert.equal(destination(replay, origin).pathname, "/auth/recover");
  assert.equal(fixture.state.tokenRequests, tokensBefore + 1);
  const resume = await request(destination(replay, origin));
  assert.equal(destination(resume, origin).href, `${origin}/app`);
  const crossHost = await request(
    `${alias}/auth/callback?state=expired&code=expired`,
  );
  assert.equal(
    destination(crossHost, alias).href,
    `${origin}/auth/recover?reason=state`,
  );
  assert.equal(fixture.state.tokenRequests, tokensBefore + 1);
  const missingState = await request(`${origin}/auth/callback?code=expired`, {
    cookies: false,
  });
  assert.equal(
    destination(missingState, origin).href,
    `${origin}/auth/recover?reason=state`,
  );
  const mutation = await request(`${alias}/api/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: alias },
    body: "{}",
  });
  assert.equal(mutation.status, 403);
  assert.equal(mutation.headers.get("location"), null);
  // Parallel logins retain separate state cookies and normal login still succeeds.
  const one = await freshLogin(),
    two = await freshLogin();
  for (const cb of [one, two]) {
    const r = await request(cb);
    assert.equal(destination(r, origin).href, `${origin}/app`);
  }
  assert.equal(fixture.state.tokenRequests, tokensBefore + 3);
  console.log(
    "PASS: alias normalization, valid SDK login/session, PKCE, missing/invalid/consumed state, safe recovery, invitation return path, parallel logins and cross-origin mutation denial.",
  );
  if (process.env.KIVO_AUTH_BROWSER_QA === "1") {
    console.log(
      "READY: isolated sign-in recovery at http://127.0.0.1:3002/auth/recover?reason=state. Ctrl+C to stop.",
    );
    await new Promise((r) => process.once("SIGINT", r));
  }
} finally {
  if (web?.exitCode === null) {
    web.kill("SIGINT");
    await Promise.race([new Promise((r) => web.once("exit", r)), sleep(2000)]);
    if (web.exitCode === null) web.kill("SIGKILL");
  }
  await fixture.close();
}
