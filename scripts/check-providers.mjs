import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../apps/api/.env", import.meta.url));
if (process.env.KIVO_LOAD_ENV !== "0" && existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    throw new Error("Could not parse apps/api/.env; check its dotenv syntax");
  }
}
const token =
  process.env.KIVO_AUTH_MODE === "auth0"
    ? process.env.KIVO_CHECK_ACCESS_TOKEN
    : process.env.KIVO_DEV_TOKEN;
if (!token)
  throw new Error(
    process.env.KIVO_AUTH_MODE === "auth0"
      ? "Set KIVO_CHECK_ACCESS_TOKEN to a current Auth0 API access token in the shell"
      : "Set KIVO_DEV_TOKEN in apps/api/.env or the shell",
  );
const bind = process.env.KIVO_API_BIND ?? "127.0.0.1:4000";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(bind))
  throw Error("Provider checks require a loopback API bind");
try {
  const response = await fetch(`http://${bind}/ready`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
  if (
    !response.ok ||
    Object.values(body.services ?? {}).some((status) => status !== "ok")
  )
    process.exitCode = 1;
} catch {
  console.error(
    "Could not check providers. Start the configured API and verify its connection settings.",
  );
  process.exitCode = 1;
}
