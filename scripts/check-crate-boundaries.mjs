// Keep dependency direction reviewable as capabilities and executables grow.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const { packages, workspace_members: members } = JSON.parse(
  execFileSync(
    "cargo",
    ["metadata", "--locked", "--no-deps", "--format-version", "1"],
    { cwd: root, encoding: "utf8" },
  ),
);
const graph = new Map(
  packages.filter((p) => members.includes(p.id)).map((p) => [p.name, p]),
);
const edges = {
  "kivo-onboarding": ["kivo-tenancy", "kivo-planning"],
  "kivo-tenancy": [],
  "kivo-identity": ["kivo-tenancy"],
  "kivo-auth0": ["kivo-identity"],
  "kivo-realtime": ["kivo-tenancy"],
  "kivo-realtime-server": ["kivo-realtime", "kivo-postgres"],
  "kivo-planning": ["kivo-tenancy"],
  "kivo-files": ["kivo-tenancy"],
  "kivo-postgres": [
    "kivo-onboarding",
    "kivo-tenancy",
    "kivo-planning",
    "kivo-files",
    "kivo-identity",
    "kivo-realtime",
  ],
  "kivo-object-storage-s3": ["kivo-files"],
  "kivo-rate-limit": [],
  "kivo-api": [
    "kivo-onboarding",
    "kivo-identity",
    "kivo-auth0",
    "kivo-realtime",
    "kivo-tenancy",
    "kivo-planning",
    "kivo-files",
    "kivo-postgres",
    "kivo-object-storage-s3",
    "kivo-rate-limit",
  ],
  "kivo-migrator": ["kivo-postgres"],
};
const pureDependencies = new Set([
  "serde",
  "uuid",
  "chrono",
  "chrono-tz",
  "thiserror",
]);
for (const [name, pkg] of graph) {
  assert.ok(edges[name], `Declare the boundary for new crate ${name}`);
  for (const dep of pkg.dependencies) {
    if (graph.has(dep.name))
      assert.ok(
        edges[name].includes(dep.name),
        `Forbidden dependency ${name} -> ${dep.name}`,
      );
    if (
      [
        "kivo-onboarding",
        "kivo-tenancy",
        "kivo-planning",
        "kivo-files",
        "kivo-identity",
        "kivo-realtime",
      ].includes(name) &&
      dep.kind !== "dev" &&
      !graph.has(dep.name)
    ) {
      assert.ok(
        pureDependencies.has(dep.name),
        `Provider/runtime dependency ${dep.name} in pure capability ${name}`,
      );
    }
    if (name === "kivo-api")
      assert.ok(
        !/^(sqlx|aws-|reqwest)/.test(dep.name),
        `HTTP process must use adapters, not ${dep.name}`,
      );
  }
  assert.equal(
    pkg.targets.some((t) => t.kind.includes("bin")),
    ["kivo-api", "kivo-migrator", "kivo-realtime-server"].includes(name),
    `Unexpected process boundary: ${name}`,
  );
}
function visit(name, path = []) {
  assert.ok(
    !path.includes(name),
    `Dependency cycle: ${[...path, name].join(" -> ")}`,
  );
  for (const dep of graph.get(name).dependencies)
    if (graph.has(dep.name)) visit(dep.name, [...path, name]);
}
for (const name of graph.keys()) visit(name);
console.log(
  `PASS: ${graph.size} crates; acyclic capability/provider/process boundaries.`,
);
