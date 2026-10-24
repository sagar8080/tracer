import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { auth0, authMode } from "./auth0";
import { apiOrigin } from "../api-origin";
const failure = (error: string, status: number) =>
  NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
// The browser receives an encrypted HttpOnly session cookie, never the API token.
// Routes supply a fixed API path, so user-controlled URLs cannot become a proxy.
export async function forward(
  request: NextRequest,
  path: string,
  maxBodyBytes = 65536,
) {
  let token: string;
  const host = request.headers.get("host") ?? "";
  if (authMode === "auth0") {
    const origin = process.env.APP_BASE_URL;
    if (!origin) return failure("Sign-in is not configured.", 503);
    if (request.method !== "GET" && request.headers.get("origin") !== origin)
      return failure("Invalid request origin.", 403);
    try {
      const client = auth0();
      if (!(await client.getSession()))
        return failure("Your session has ended. Sign in again.", 401);
      token = (await client.getAccessToken()).token;
    } catch {
      return failure("Your session has ended. Sign in again.", 401);
    }
  } else if (authMode === "development") {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.KIVO_ALLOW_DEV_AUTH !== "1" ||
      !process.env.KIVO_DEV_TOKEN
    )
      return failure("The local API is not configured.", 503);
    if (
      !/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
      (request.method !== "GET" &&
        request.headers.get("origin") !== `http://${host}`)
    )
      return failure("Invalid request origin.", 403);
    token = process.env.KIVO_DEV_TOKEN;
  } else return failure("Invalid authentication configuration.", 503);
  try {
    const base = apiOrigin(
      process.env.KIVO_API_URL ?? "http://127.0.0.1:4000",
      process.env.KIVO_INTERNAL_API_ORIGIN,
    );
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const key = request.headers.get("idempotency-key");
    if (key) headers["Idempotency-Key"] = key;
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && new TextEncoder().encode(body).length > maxBodyBytes)
      return failure("Request is too large.", 413);
    const response = await fetch(new URL(path, base), {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return new Response(
      response.status === 204 ? null : await response.text(),
      {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store",
          ...(response.headers.has("retry-after")
            ? { "Retry-After": response.headers.get("retry-after")! }
            : {}),
        },
      },
    );
  } catch {
    return failure(
      "The API response could not be confirmed. Reload before editing again; a submitted change may already be saved.",
      503,
    );
  }
}
