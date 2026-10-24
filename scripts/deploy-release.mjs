// Operator-invoked release only: images -> validation -> stop -> migrate -> start.
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployment } from "./deploy-config.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
function run(command, args, env, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error || result.status !== 0)
    throw Error(
      `${command} failed; runtime may remain stopped. Follow docs/deployment.md recovery instructions.`,
    );
  return result.stdout?.trim();
}
try {
  if (process.argv.length !== 3)
    throw Error("Usage: npm run deploy:release -- /etc/kivo/deploy.env");
  const file = resolve(process.argv[2]);
  const { config } = await loadDeployment(file);
  // Control values from the checked file override inherited shell variables.
  const env = { ...process.env, ...config };
  const head = run("git", ["rev-parse", "HEAD"], env, true);
  if (
    head !== config.KIVO_RELEASE ||
    run("git", ["status", "--porcelain"], env, true)
  )
    throw Error(
      "Use a clean checkout of KIVO_RELEASE so routing, scripts and images belong to the same release.",
    );
  const compose = [
    "compose",
    "--project-name",
    "kivo",
    "--env-file",
    file,
    "-f",
    join(root, "deploy/compose.yaml"),
  ];
  run("docker", [...compose, "config", "--quiet"], env);
  run("docker", [...compose, "--profile", "release", "pull"], env);
  for (const service of ["web", "api", "realtime", "worker", "migrator"]) {
    const image = `${config.KIVO_IMAGE_PREFIX}-${service}:${config.KIVO_RELEASE}`;
    const revision = run(
      "docker",
      [
        "image",
        "inspect",
        "--format",
        '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
        image,
      ],
      env,
      true,
    );
    if (revision !== config.KIVO_RELEASE)
      throw Error(`${service}: image revision does not match KIVO_RELEASE`);
  }
  run(
    "docker",
    [
      ...compose,
      "run",
      "--rm",
      "--no-deps",
      "--entrypoint",
      "caddy",
      "edge",
      "validate",
      "--config",
      "/etc/caddy/Caddyfile",
      "--adapter",
      "caddyfile",
    ],
    env,
  );
  // Planned pilot maintenance window. Do not mutate a schema under old workers.
  run("docker", [...compose, "stop", "web", "api", "realtime", "worker"], env);
  run(
    "docker",
    [
      ...compose,
      "--profile",
      "release",
      "run",
      "--rm",
      "--no-deps",
      "migrator",
    ],
    env,
  );
  run(
    "docker",
    [
      ...compose,
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "180",
      "web",
      "api",
      "realtime",
      "worker",
    ],
    env,
  );
  // Caddy's admin API is disabled. Recreate it to load this release's routing
  // file even when only that file changed; certificate volumes stay intact.
  run(
    "docker",
    [
      ...compose,
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "60",
      "--no-deps",
      "--force-recreate",
      "edge",
    ],
    env,
  );
  console.log(
    `Runtime services are healthy. Verify public HTTPS next: npm run deploy:smoke -- https://${config.SITE_HOST}`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
