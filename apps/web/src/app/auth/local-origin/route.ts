import { NextRequest } from "next/server";
import { appBaseUrl, authMode } from "@/lib/server/auth0";
import { canonicalLocalTarget } from "@/features/identity/auth-navigation";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  if (authMode !== "auth0")
    return Response.json({ error: "Sign-in is not enabled" }, { status: 404 });
  const base = appBaseUrl();
  const target = canonicalLocalTarget(
    request.nextUrl.searchParams.get("pathname") || "/app",
    request.nextUrl.searchParams.get("search") || "",
    request.headers.get("host"),
    base.origin,
  );
  // Native Response bypasses Proxy's loopback host normalization. Destination
  // always uses configured origin; no cookie or authorization code is copied.
  return new Response(null, {
    status: 307,
    headers: {
      Location: (target ?? new URL("/app", base)).href,
      "Cache-Control": "private, no-store",
    },
  });
}
