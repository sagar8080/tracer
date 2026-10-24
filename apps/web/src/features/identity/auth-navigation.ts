// Authentication navigates on one configured origin. Never transfer a callback
// code between host aliases or derive a redirect host from forwarded headers.
const localHosts = new Set(["localhost", "127.0.0.1"]);
export function canonicalLocalTarget(
  pathname: string,
  search: string,
  requestHost: string | null,
  configuredOrigin: string,
): URL | null {
  const base = new URL(configuredOrigin);
  if (!localHosts.has(base.hostname) || !requestHost) return null;
  let incoming: URL;
  try {
    incoming = new URL(`${base.protocol}//${requestHost}`);
  } catch {
    return null;
  }
  if (
    !localHosts.has(incoming.hostname) ||
    incoming.username ||
    incoming.password ||
    incoming.pathname !== "/" ||
    incoming.search ||
    incoming.hash ||
    incoming.port !== base.port ||
    incoming.host === base.host
  )
    return null;
  const target = new URL(base.origin);
  if (pathname === "/auth/callback") {
    target.pathname = "/auth/recover";
    target.search = "?reason=state";
  } else {
    target.pathname = pathname;
    target.search = search;
  }
  return target;
}
export function callbackTarget(
  configuredOrigin: string,
  errorCode: string | null,
  returnTo?: string,
): URL {
  const base = new URL(configuredOrigin);
  if (errorCode !== null) {
    const target = new URL("/auth/recover", base);
    target.searchParams.set(
      "reason",
      ["invalid_state", "missing_state"].includes(errorCode)
        ? "state"
        : "signin",
    );
    return target;
  }
  try {
    const target = new URL(returnTo || "/app", base);
    if (target.origin === base.origin && !target.username && !target.password)
      return target;
  } catch {
    // A malformed return path must not interrupt a valid, SDK-verified login.
  }
  return new URL("/app", base);
}
