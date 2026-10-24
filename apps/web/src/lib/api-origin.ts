// Only fixed, operator-configured origins can receive the server's API token.
export function apiOrigin(raw: string, internalOrigin?: string): URL {
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const internal = internalOrigin === url.origin && raw === url.origin;
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && (loopback || internal)))
  )
    throw new Error("Invalid API origin");
  return url;
}
