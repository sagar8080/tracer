import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalLocalTarget,
  callbackTarget,
} from "../features/identity/auth-navigation";
const base = "http://127.0.0.1:3000";
test("local login aliases converge before a transaction cookie is created", () => {
  assert.equal(
    canonicalLocalTarget(
      "/auth/login",
      "?returnTo=%2Fjoin",
      "localhost:3000",
      base,
    )?.href,
    `${base}/auth/login?returnTo=%2Fjoin`,
  );
  assert.equal(canonicalLocalTarget("/app", "", "127.0.0.1:3000", base), null);
  assert.equal(canonicalLocalTarget("/", "", "localhost:3001", base), null);
  assert.equal(canonicalLocalTarget("/", "", "evil.test:3000", base), null);
  assert.equal(
    canonicalLocalTarget("/", "", "localhost:3000@evil.test", base),
    null,
  );
  assert.equal(
    canonicalLocalTarget("/", "", "localhost:3000", "https://kivo.example"),
    null,
  );
});
test("alias callback recovery drops the old authorization code and state", () => {
  assert.equal(
    canonicalLocalTarget(
      "/auth/callback",
      "?code=sensitive&state=expired",
      "localhost:3000",
      base,
    )?.href,
    `${base}/auth/recover?reason=state`,
  );
  assert.equal(
    canonicalLocalTarget("//evil.test/path", "", "localhost:3000", base)
      ?.origin,
    base,
  );
});
test("callback failures recover without trusting error text or an external return path", () => {
  for (const code of ["invalid_state", "missing_state"])
    assert.equal(
      callbackTarget(base, code, "https://evil.test").href,
      `${base}/auth/recover?reason=state`,
    );
  assert.equal(
    callbackTarget(base, "other_error_with_secret", "/app").href,
    `${base}/auth/recover?reason=signin`,
  );
  assert.equal(callbackTarget(base, null, "/join").href, `${base}/join`);
  for (const path of ["https://evil.test", "//evil.test", "http://[invalid"])
    assert.equal(callbackTarget(base, null, path).href, `${base}/app`);
});
