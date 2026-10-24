// Offline configuration checks. Error messages name fields, never their values.
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export function parseConfig(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1]))
      throw Error("Configuration requires unique KEY=value lines");
    const [, key, value] = match;
    if (value !== value.trim() || /^["']/.test(value))
      throw Error(
        `${key}: use an unquoted value without surrounding whitespace`,
      );
    values[key] = value;
  }
  return values;
}
const allowed = {
  web: [
    "AUTH0_DOMAIN",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_SECRET",
    "AUTH0_SECRET",
    "AUTH0_AUDIENCE",
  ],
  api: [
    "DATABASE_URL",
    "KIVO_DB_MAX_CONNECTIONS",
    "AUTH0_ISSUER",
    "AUTH0_AUDIENCE",
    "KIVO_S3_BUCKET",
    "KIVO_S3_PREFIX",
    "AWS_ENDPOINT_URL_S3",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ],
  realtime: ["DATABASE_URL", "KIVO_DB_MAX_CONNECTIONS"],
  worker: [
    "DATABASE_URL",
    "KIVO_DB_MAX_CONNECTIONS",
    "KIVO_S3_BUCKET",
    "KIVO_S3_PREFIX",
    "AWS_ENDPOINT_URL_S3",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "KIVO_WORKER_CONCURRENCY",
  ],
  migrator: ["DATABASE_URL", "DATABASE_DIRECT_URL", "KIVO_DB_MAX_CONNECTIONS"],
};
const providers = [
  ["OPENAI_API_KEY", "KIVO_OPENAI_MODEL"],
  ["ANTHROPIC_API_KEY", "KIVO_CLAUDE_MODEL"],
  ["GEMINI_API_KEY", "KIVO_GEMINI_MODEL"],
];
const controls = [
  "SITE_HOST",
  "ACME_EMAIL",
  "KIVO_IMAGE_PREFIX",
  "KIVO_RELEASE",
  "KIVO_ENV_DIR",
];
const ensure = (condition, message) => {
  if (!condition) throw Error(message);
};
function complete(values, keys, name, optional = []) {
  for (const key of Object.keys(values))
    ensure(
      [...keys, ...optional].includes(key),
      `${name}: unexpected field ${key}`,
    );
  for (const key of keys)
    ensure(
      values[key] && !/YOUR-|replace-with|CHANGE_ME/i.test(values[key]),
      `${name}: configure ${key}`,
    );
  for (const key of optional)
    if (values[key])
      ensure(
        !/YOUR-|replace-with|CHANGE_ME/i.test(values[key]),
        `${name}: configure or remove ${key}`,
      );
}
function url(value, field) {
  try {
    return new URL(value);
  } catch {
    throw Error(`${field}: invalid URL`);
  }
}
function database(value, field, pooled = true) {
  const parsed = url(value, field);
  ensure(
    ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      parsed.username &&
      parsed.password &&
      parsed.hostname.endsWith(".neon.tech") &&
      parsed.pathname.length > 1 &&
      parsed.searchParams.get("sslmode") === "verify-full" &&
      parsed.hostname.includes("-pooler.") === pooled,
    `${field}: use a Neon ${pooled ? "pooled" : "direct"} URL with sslmode=verify-full`,
  );
  return `${parsed.hostname.replace("-pooler.", ".")}${parsed.pathname}`;
}
export function validateConfig(config, services) {
  complete(config, controls, "deploy.env");
  ensure(
    /^(?!www\.)(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      config.SITE_HOST,
    ) &&
      !/\.(example|test|invalid|localhost|local|internal)$/.test(
        config.SITE_HOST,
      ),
    "SITE_HOST: use the canonical public DNS hostname, without protocol/path/www",
  );
  ensure(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.ACME_EMAIL),
    "ACME_EMAIL: configure an operations email",
  );
  ensure(
    /^ghcr\.io\/[a-z0-9][a-z0-9._/-]+$/.test(config.KIVO_IMAGE_PREFIX),
    "KIVO_IMAGE_PREFIX: use a lowercase GHCR repository prefix",
  );
  ensure(
    /^[0-9a-f]{40}$/.test(config.KIVO_RELEASE),
    "KIVO_RELEASE: use the full 40-character Git commit SHA",
  );
  ensure(
    isAbsolute(config.KIVO_ENV_DIR),
    "KIVO_ENV_DIR: use an absolute configuration directory",
  );
  for (const [service, keys] of Object.entries(allowed)) {
    const values = services[service];
    ensure(values, `${service}.env is required`);
    complete(
      values,
      keys,
      `${service}.env`,
      ["api", "worker"].includes(service) ? providers.flat() : [],
    );
    if (values.KIVO_DB_MAX_CONNECTIONS)
      ensure(
        /^\d+$/.test(values.KIVO_DB_MAX_CONNECTIONS) &&
          +values.KIVO_DB_MAX_CONNECTIONS >= 1 &&
          +values.KIVO_DB_MAX_CONNECTIONS <= 50,
        `${service}: invalid database pool limit`,
      );
  }
  const { web, api, realtime, worker, migrator } = services;
  ensure(
    /^[a-z0-9.-]+\.[a-z]{2,}$/.test(web.AUTH0_DOMAIN),
    "AUTH0_DOMAIN: use the bare Auth0 or custom hostname",
  );
  ensure(
    /^[0-9a-fA-F]{64}$/.test(web.AUTH0_SECRET),
    "AUTH0_SECRET: generate 32 random bytes as 64 hex characters",
  );
  ensure(
    api.AUTH0_ISSUER === `https://${web.AUTH0_DOMAIN}/`,
    "AUTH0_ISSUER must match AUTH0_DOMAIN with https and trailing slash",
  );
  ensure(
    api.AUTH0_AUDIENCE === web.AUTH0_AUDIENCE,
    "Web/API AUTH0_AUDIENCE must match the existing Auth0 API identifier",
  );
  const db = database(api.DATABASE_URL, "api.DATABASE_URL");
  for (const name of ["realtime", "worker", "migrator"])
    ensure(
      database(services[name].DATABASE_URL, `${name}.DATABASE_URL`) === db,
      `${name}: database must use the same Neon branch/database`,
    );
  ensure(
    database(
      migrator.DATABASE_DIRECT_URL,
      "migrator.DATABASE_DIRECT_URL",
      false,
    ) === db,
    "Migrator direct URL must use the runtime Neon branch/database",
  );
  for (const name of ["api", "worker"]) {
    const s = services[name],
      endpoint = url(s.AWS_ENDPOINT_URL_S3, `${name}.AWS_ENDPOINT_URL_S3`);
    ensure(
      endpoint.protocol === "https:" &&
        !endpoint.username &&
        !endpoint.password &&
        endpoint.pathname === "/" &&
        !endpoint.search &&
        !endpoint.hash,
      `${name}: storage requires an exact HTTPS origin`,
    );
    ensure(
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(s.KIVO_S3_BUCKET),
      `${name}: invalid private bucket name`,
    );
    ensure(
      /^[a-zA-Z0-9_:-]{1,64}$/.test(s.KIVO_S3_PREFIX),
      `${name}: invalid storage namespace`,
    );
  }
  for (const key of [
    "KIVO_S3_BUCKET",
    "KIVO_S3_PREFIX",
    "AWS_ENDPOINT_URL_S3",
    "AWS_REGION",
  ])
    ensure(api[key] === worker[key], `API/worker ${key} must match`);
  ensure(
    /^[1-4]$/.test(worker.KIVO_WORKER_CONCURRENCY),
    "Worker concurrency must be 1–4",
  );
  for (const [key, model] of providers) {
    for (const name of ["api", "worker"])
      ensure(
        Boolean(services[name][key]) === Boolean(services[name][model]),
        `${name}: configure both ${key} and ${model}, or neither`,
      );
    ensure(
      Boolean(api[key]) === Boolean(worker[key]) &&
        api[model] === worker[model],
      `API/worker ${model} configuration must match`,
    );
  }
  return config;
}
async function readSecure(path) {
  const info = await stat(path).catch(() => {
    throw Error("A required configuration file is missing");
  });
  ensure(
    info.isFile() && (info.mode & 0o077) === 0,
    "Configuration files must be regular files with mode 0600 or 0400",
  );
  return parseConfig(await readFile(path, "utf8"));
}
export async function loadDeployment(path) {
  const config = await readSecure(path);
  complete(config, controls, "deploy.env");
  const services = {};
  for (const name of Object.keys(allowed))
    services[name] = await readSecure(join(config.KIVO_ENV_DIR, `${name}.env`));
  validateConfig(config, services);
  return { config, services };
}
