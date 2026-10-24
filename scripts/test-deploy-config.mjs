import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  chmod,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseConfig,
  validateConfig,
  loadDeployment,
} from "./deploy-config.mjs";

function fixture() {
  const config = {
    SITE_HOST: "kivolabs.pro",
    ACME_EMAIL: "ops@kivolabs.pro",
    KIVO_IMAGE_PREFIX: "ghcr.io/sagar8080/kivo",
    KIVO_RELEASE: "a".repeat(40),
    KIVO_ENV_DIR: "/etc/kivo",
  };
  const db = {
    DATABASE_URL:
      "postgresql://runtime:isolated@ep-fixture-pooler.us-east-2.aws.neon.tech/neondb?sslmode=verify-full",
    KIVO_DB_MAX_CONNECTIONS: "5",
  };
  const storage = {
    KIVO_S3_BUCKET: "kivo-pilot",
    KIVO_S3_PREFIX: "kivo-pilot",
    AWS_ENDPOINT_URL_S3: "https://storage.neon.tech",
    AWS_REGION: "us-east-2",
    AWS_ACCESS_KEY_ID: "isolated-key",
    AWS_SECRET_ACCESS_KEY: "literal$secret#retained",
  };
  const services = {
    web: {
      AUTH0_DOMAIN: "fixture.us.auth0.com",
      AUTH0_CLIENT_ID: "fixture-client",
      AUTH0_CLIENT_SECRET: "isolated-client-secret",
      AUTH0_SECRET: "b".repeat(64),
      AUTH0_AUDIENCE: "https://api.kivo.app",
    },
    api: {
      ...db,
      ...storage,
      AUTH0_ISSUER: "https://fixture.us.auth0.com/",
      AUTH0_AUDIENCE: "https://api.kivo.app",
    },
    realtime: { ...db },
    worker: { ...db, ...storage, KIVO_WORKER_CONCURRENCY: "2" },
    migrator: {
      ...db,
      DATABASE_DIRECT_URL: db.DATABASE_URL.replace("-pooler.", "."),
    },
  };
  return { config, services };
}
test("Literal credentials are preserved and duplicate/quoted assignments rejected", () => {
  assert.equal(
    parseConfig("# comment\nTOKEN=literal$secret#retained\n").TOKEN,
    "literal$secret#retained",
  );
  for (const text of [
    "TOKEN=one\nTOKEN=two",
    "export TOKEN=x",
    'TOKEN="secret"',
    "TOKEN= secret",
  ])
    assert.throws(() => parseConfig(text));
});
test("Deployment rejects auth drift, wrong databases, leaked credentials and unsafe releases", () => {
  const valid = fixture();
  assert.equal(validateConfig(valid.config, valid.services), valid.config);
  const changes = [
    (c, s) => {
      c.SITE_HOST = "www.kivolabs.pro";
    },
    (c, s) => {
      c.KIVO_RELEASE = "latest";
    },
    (c, s) => {
      s.web.AUTH0_SECRET = "short";
    },
    (c, s) => {
      s.api.AUTH0_ISSUER = "https://wrong.auth0.com/";
    },
    (c, s) => {
      s.web.AUTH0_AUDIENCE = "different";
    },
    (c, s) => {
      s.realtime.DATABASE_URL = s.realtime.DATABASE_URL.replace(
        "neondb?",
        "another?",
      );
    },
    (c, s) => {
      s.migrator.DATABASE_DIRECT_URL = s.migrator.DATABASE_URL;
    },
    (c, s) => {
      s.api.KIVO_ALLOW_DEV_AUTH = "1";
    },
    (c, s) => {
      s.realtime.AWS_SECRET_ACCESS_KEY = "must-not-reach-realtime";
    },
    (c, s) => {
      s.worker.KIVO_S3_PREFIX = "different";
    },
    (c, s) => {
      s.worker.OPENAI_API_KEY = "without-model";
    },
  ];
  for (const change of changes) {
    const { config, services } = fixture();
    change(config, services);
    assert.throws(() => validateConfig(config, services));
  }
});
test("File checks require owner-only permissions and never print credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kivo-deploy-config-"));
  try {
    const { config, services } = fixture();
    config.KIVO_ENV_DIR = dir;
    const encode = (v) =>
      Object.entries(v)
        .map(([k, value]) => `${k}=${value}`)
        .join("\n");
    for (const [name, values] of Object.entries({
      deploy: config,
      ...services,
    }))
      await writeFile(join(dir, `${name}.env`), encode(values), {
        mode: 0o600,
      });
    const loaded = await loadDeployment(join(dir, "deploy.env"));
    assert.equal(
      loaded.services.worker.AWS_SECRET_ACCESS_KEY,
      services.worker.AWS_SECRET_ACCESS_KEY,
    );
    await chmod(join(dir, "worker.env"), 0o644);
    await assert.rejects(
      loadDeployment(join(dir, "deploy.env")),
      /mode 0600 or 0400/,
    );
    await chmod(join(dir, "worker.env"), 0o600);
    services.web.AUTH0_SECRET = "private-invalid-secret";
    await writeFile(join(dir, "web.env"), encode(services.web));
    try {
      await loadDeployment(join(dir, "deploy.env"));
      assert.fail("Invalid secret accepted");
    } catch (error) {
      assert.ok(!error.message.includes("private-invalid-secret"));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "Compose preserves literal credentials and isolates runtime ports/configuration",
  {
    skip: !process.env.KIVO_COMPOSE_BINARY,
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "kivo-compose-config-"));
    try {
      const { config, services } = fixture();
      config.KIVO_ENV_DIR = dir;
      for (const [name, values] of Object.entries({
        deploy: config,
        ...services,
      }))
        await writeFile(
          join(dir, `${name}.env`),
          Object.entries(values)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n"),
          { mode: 0o600 },
        );
      const binary = process.env.KIVO_COMPOSE_BINARY;
      const prefix = binary.endsWith("docker") ? ["compose"] : [];
      const result = spawnSync(
        binary,
        [
          ...prefix,
          "--env-file",
          join(dir, "deploy.env"),
          "-f",
          fileURLToPath(new URL("../deploy/compose.yaml", import.meta.url)),
          "--profile",
          "release",
          "config",
          "--format",
          "json",
        ],
        { encoding: "utf8", env: { ...process.env, ...config } },
      );
      assert.equal(
        result.status,
        0,
        "Compose configuration rejected (render intentionally not logged)",
      );
      const rendered = JSON.parse(result.stdout).services;
      for (const name of ["web", "api", "realtime", "worker", "migrator"]) {
        assert.equal(
          rendered[name].image,
          `${config.KIVO_IMAGE_PREFIX}-${name}:${config.KIVO_RELEASE}`,
        );
        assert.equal(
          rendered[name].ports,
          undefined,
          `${name} must not publish a host port`,
        );
      }
      assert.deepEqual(rendered.edge.ports.map((p) => p.published).sort(), [
        "443",
        "80",
      ]);
      // Compose escapes dollars in rendered output for re-reading as config;
      // releases consume the original raw env_file, never this serialization.
      assert.equal(
        rendered.api.environment.AWS_SECRET_ACCESS_KEY.replaceAll("$$", "$"),
        services.api.AWS_SECRET_ACCESS_KEY,
      );
      assert.equal(rendered.api.environment.KIVO_RUN_MIGRATIONS, "0");
      assert.equal(rendered.api.environment.KIVO_AUTH_MODE, "auth0");
      assert.ok(
        rendered.api.healthcheck.test.some((v) =>
          v.includes("/internal/ready"),
        ),
      );
      assert.equal(
        rendered.worker.environment.KIVO_WORKER_BIND,
        "127.0.0.1:4002",
      );
      assert.equal(
        rendered.web.environment.KIVO_INTERNAL_API_ORIGIN,
        "http://api:4000",
      );
      for (const name of ["realtime", "migrator"]) {
        assert.ok(
          !Object.keys(rendered[name].environment).some(
            (k) => k.startsWith("AWS_") || k.startsWith("AUTH0_"),
          ),
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("Release validates candidates before stopping and never starts after migration failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kivo-release-contract-"));
  try {
    const { config, services } = fixture();
    config.KIVO_ENV_DIR = dir;
    const bin = join(dir, "bin"),
      calls = join(dir, "calls.jsonl");
    await mkdir(bin);
    for (const [name, values] of Object.entries({
      deploy: config,
      ...services,
    }))
      await writeFile(
        join(dir, `${name}.env`),
        Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n"),
        { mode: 0o600 },
      );
    const stub = `#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path');
const args=process.argv.slice(2), command=path.basename(process.argv[1]);
if(command==='git') {
  if(args[0]==='rev-parse') console.log(process.env.FIXTURE_SHA);
  else if(process.env.FIXTURE_FAILURE==='dirty') console.log(' M example');
} else {
  fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify(args)+'\\n');
  if(args[0]==='image' && args[1]==='inspect') console.log(process.env.FIXTURE_FAILURE==='label'?'different':process.env.FIXTURE_SHA);
  if(process.env.FIXTURE_FAILURE==='validate' && args.includes('validate')) process.exit(1);
  if(process.env.FIXTURE_FAILURE==='migration' && args.includes('migrator') && args.includes('run')) process.exit(1);
}
`;
    for (const command of ["git", "docker"])
      await writeFile(join(bin, command), stub, { mode: 0o755 });
    for (const failure of ["none", "dirty", "label", "validate", "migration"]) {
      await writeFile(calls, "");
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("./deploy-release.mjs", import.meta.url)),
          join(dir, "deploy.env"),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            FIXTURE_SHA: config.KIVO_RELEASE,
            FIXTURE_CALLS: calls,
            FIXTURE_FAILURE: failure,
          },
        },
      );
      assert.equal(
        result.status,
        failure === "none" ? 0 : 1,
        `Release gate: ${failure}`,
      );
      const commands = (await readFile(calls, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const stop = commands.findIndex((c) => c.includes("stop")),
        migration = commands.findIndex(
          (c) => c.includes("run") && c.includes("migrator"),
        ),
        up = commands.findIndex((c) => c.includes("up"));
      if (failure === "none") {
        assert.ok(stop >= 0 && migration > stop && up > migration);
        assert.ok(commands.findIndex((c) => c.includes("validate")) < stop);
        assert.ok(
          commands.at(-1).includes("--force-recreate") &&
            commands.at(-1).includes("edge"),
        );
      } else if (failure === "migration") {
        assert.ok(stop >= 0 && migration > stop);
        assert.equal(up, -1);
      } else {
        assert.equal(stop, -1);
        assert.equal(migration, -1);
        assert.equal(up, -1);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
