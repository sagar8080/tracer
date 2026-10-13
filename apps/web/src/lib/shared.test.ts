import test from "node:test";
import assert from "node:assert/strict";
import { request, ApiError } from "./http";
import { seed } from "./seed";
import { workspaceSchema } from "./model";
import {
  permissions,
  mayEdit,
  type Role,
} from "../features/tenancy/permissions";

test("transport retries preserve a mutation's body and idempotency key", async () => {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init!);
    if (calls.length === 1) throw new TypeError("Connection lost after commit");
    return new Response(null, { status: 204 });
  };
  try {
    await request("/api/workspace", {
      kind: "person",
      value: { name: "Olivia" },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].headers, calls[1].headers);
    assert.equal(calls[0].body, calls[1].body);
    assert.match(
      (calls[0].headers as Record<string, string>)["Idempotency-Key"],
      /^[0-9a-f-]{36}$/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("permission errors and version conflicts are never blindly retried", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 409, 422]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return new Response(JSON.stringify({ error: "Changed" }), { status });
      };
      await assert.rejects(
        request("/api/workspace", {}),
        (e: unknown) => e instanceof ApiError && e.status === status,
      );
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("role controls distinguish finance, planning, administration and onboarding", () => {
  const data = seed(),
    orgId = data.organizations[0].id;
  for (const role of [
    "owner",
    "admin",
    "planner",
    "member",
    "viewer",
  ] as Role[]) {
    data.access = [{ orgId, role, revision: 4 }];
    const access = permissions(data, orgId, true);
    assert.equal(access.finance, ["owner", "admin"].includes(role));
    assert.equal(
      mayEdit({ kind: "assignment", value: {} }, access),
      ["owner", "admin", "planner"].includes(role),
    );
    assert.equal(
      mayEdit({ kind: "absence", value: { category: "holiday" } }, access),
      ["owner", "admin"].includes(role),
    );
    assert.equal(mayEdit({ kind: "organization", value: {} }, access), true);
  }
  assert.equal(permissions(data, crypto.randomUUID(), true).plan, false);
});

test("redacted finance is valid data and legacy demo records acquire versions", () => {
  const data = seed();
  data.people[0].costRate = null;
  data.projects[0].billRate = null;
  assert.equal(workspaceSchema.parse(data).people[0].costRate, null);
  const legacy = JSON.parse(JSON.stringify(seed()));
  for (const key of ["organizations", "people", "projects"])
    for (const record of legacy[key]) delete record.version;
  delete legacy.access;
  delete legacy.actorId;
  const restored = workspaceSchema.parse(legacy);
  assert.equal(restored.organizations[0].version, 1);
  assert.equal(restored.people[0].version, 1);
  assert.equal(restored.projects[0].version, 1);
});
