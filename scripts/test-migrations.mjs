// Frozen pre-extraction SQLx SHA-384 checksums. New migrations may extend this list;
// editing an applied migration must never silently update its baseline here.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
const baseline = [
  [
    "0001_foundation.sql",
    "92efc732766426cf7a56cd062a7aee7d7c0bdf198d0736e5baaa4e0677c205e10c87ca3b147b7b5fbb76299dfd225073",
  ],
  [
    "0002_files.sql",
    "9878b858a4ee6bafa6326b12829e2bae31928ca7eb5ad28068ffb568a02e69023c407769826f20ab98c8e5fb35084205",
  ],
  [
    "0003_capacity.sql",
    "68b3f8fa6e0b3f681166f87ec6aef5dd7c5d3ca9316278badc7bfdcc92b58fd30e1af70a81f7fbc82cb2139ee370a753",
  ],
];
export async function runMigrator(
  target,
  env,
  binary = "kivo-migrator",
  args = [],
) {
  return new Promise((resolve, reject) => {
    const process = spawn(join(target, "debug", binary), args, {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let output = "";
    process.stderr.on("data", (b) => {
      output += b;
    });
    process.once("error", reject);
    process.once("exit", (code) => resolve({ code, output }));
  });
}
export async function verifyMigrationUpgrade({ root, target, client, env }) {
  const sql = await Promise.all(
    baseline.map(async ([name, checksum]) => {
      const bytes = await readFile(
        join(root, "apps/migrator/migrations", name),
      );
      assert.equal(
        createHash("sha384").update(bytes).digest("hex"),
        checksum,
        `Applied SQL changed: ${name}`,
      );
      return bytes.toString();
    }),
  );
  // Represent an existing installation at v2 with the original SQLx ledger.
  await client.query(`CREATE TABLE _sqlx_migrations (
    version BIGINT PRIMARY KEY, description TEXT NOT NULL,
    installed_on TIMESTAMPTZ NOT NULL DEFAULT now(), success BOOLEAN NOT NULL,
    checksum BYTEA NOT NULL, execution_time BIGINT NOT NULL)`);
  for (let i = 0; i < 2; i++) {
    await client.query("BEGIN");
    await client.query(sql[i]);
    await client.query(
      "INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,true,$3,0)",
      [i + 1, baseline[i][0].slice(5, -4), Buffer.from(baseline[i][1], "hex")],
    );
    await client.query("COMMIT");
  }
  const id = randomUUID();
  await client.query(
    "INSERT INTO organizations(id,name,timezone) VALUES($1,'Retained upgrade fixture','UTC')",
    [id],
  );
  const migrationEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) =>
      /^(PATH|HOME|DYLD_.*|LD_.*|DATABASE_.*|KIVO_LOAD_ENV)$/.test(key),
    ),
  );
  // The dedicated executable needs no API token or Redis/S3 configuration.
  const first = await runMigrator(target, migrationEnv);
  assert.equal(first.code, 0, first.output);
  const before = (
    await client.query(
      "SELECT version,checksum,installed_on FROM _sqlx_migrations ORDER BY version",
    )
  ).rows;
  assert.deepEqual(
    before.slice(0, 3).map((row) => row.checksum.toString("hex")),
    baseline.map(([, checksum]) => checksum),
  );
  assert.equal(
    (await client.query("SELECT name FROM organizations WHERE id=$1", [id]))
      .rows[0].name,
    "Retained upgrade fixture",
  );
  const second = await runMigrator(target, migrationEnv);
  assert.equal(second.code, 0, second.output);
  assert.deepEqual(
    (
      await client.query(
        "SELECT version,checksum,installed_on FROM _sqlx_migrations ORDER BY version",
      )
    ).rows,
    before,
  );
  await client.query(
    "UPDATE _sqlx_migrations SET checksum='\\x00'::bytea WHERE version=3",
  );
  const changed = await runMigrator(target, migrationEnv);
  assert.notEqual(changed.code, 0, "Migrator accepted checksum drift");
  await client.query(
    "UPDATE _sqlx_migrations SET checksum=$1 WHERE version=3",
    [before[2].checksum],
  );
  await client.query("DELETE FROM organizations WHERE id=$1", [id]);
  console.log(
    "PASS: frozen migration checksums, v2 upgrade without reset, independent migrator, idempotent rerun and checksum-drift rejection.",
  );
}
