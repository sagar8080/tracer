// Read-only public checks; does not complete OAuth or create workspace data.
import assert from "node:assert/strict";
import { request as httpsRequest } from "node:https";
import { randomBytes } from "node:crypto";
try {
  const base = new URL(process.argv[2] ?? "");
  assert.equal(
    process.argv.length,
    3,
    "Usage: npm run deploy:smoke -- https://kivolabs.pro",
  );
  assert.equal(base.protocol, "https:", "Use the canonical HTTPS origin");
  assert.equal(
    base.href,
    `${base.origin}/`,
    "Use an origin without a path/query",
  );
  assert.ok(
    !base.username && !base.password,
    "Credentials must not be in the URL",
  );
  const get = (path, headers = {}) =>
    fetch(new URL(path, base), {
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(15000),
    });
  for (const path of ["/", "/health", "/import-examples/allocations.csv"]) {
    const response = await get(path);
    assert.equal(response.status, 200, `${path}: expected 200`);
    assert.ok(
      response.headers.get("strict-transport-security"),
      `${path}: missing HTTPS policy`,
    );
    await response.body?.cancel();
  }
  for (const path of ["/api/workspace", "/v1/workspace"]) {
    const response = await get(path);
    assert.equal(
      response.status,
      401,
      `${path}: anonymous access must be denied`,
    );
    await response.body?.cancel();
  }
  const login = await get("/auth/login?returnTo=%2Fapp");
  assert.equal(login.status, 307, "Login must redirect to Auth0");
  const target = new URL(login.headers.get("location"));
  assert.equal(target.protocol, "https:");
  assert.equal(
    target.searchParams.get("redirect_uri"),
    `${base.origin}/auth/callback`,
  );
  assert.ok(
    login.headers
      .getSetCookie()
      .some(
        (c) =>
          c.startsWith("__txn_") &&
          /;\s*Secure(?:;|$)/i.test(c) &&
          /;\s*HttpOnly(?:;|$)/i.test(c),
      ),
    "Login must issue a secure HttpOnly transaction cookie",
  );
  const alias = await fetch(`https://www.${base.host}/join?source=smoke`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(alias.status, 308);
  assert.equal(
    alias.headers.get("location"),
    `${base.origin}/join?source=smoke`,
  );
  assert.equal(
    alias.headers.getSetCookie().length,
    0,
    "Alias must redirect before setting auth cookies",
  );
  // Exercise the real WSS upgrade without creating a ticket or subscription.
  const upgrade = (origin, expected) =>
    new Promise((resolve, reject) => {
      const req = httpsRequest(new URL("/ws", base), {
        headers: {
          Origin: origin,
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        },
      });
      const timer = setTimeout(() => {
        req.destroy();
        reject(Error("WebSocket upgrade timed out"));
      }, 10000);
      req.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      req.once("response", (response) => {
        clearTimeout(timer);
        response.resume();
        try {
          assert.equal(response.statusCode, expected);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      req.once("upgrade", (response, socket) => {
        clearTimeout(timer);
        socket.destroy();
        try {
          assert.equal(response.statusCode, expected);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      req.end();
    });
  await upgrade(base.origin, 101);
  await upgrade("https://other.invalid", 403);
  console.log(
    "PASS: public HTTPS/assets, canonical alias, secure Auth0 redirect cookies, anonymous API denial and WSS routing. Hosted sign-in, authorized workflows and restore still require operator checks.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
