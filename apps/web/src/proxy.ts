import { NextRequest, NextResponse } from "next/server";
import { canonicalLocalTarget } from "@/features/identity/auth-navigation";
import { auth0, authMode, appBaseUrl } from "@/lib/server/auth0";
export async function proxy(request: NextRequest) {
  if (authMode !== "auth0" || request.nextUrl.pathname === "/auth/local-origin")
    return NextResponse.next();
  try {
    const canonical = canonicalLocalTarget(
      request.nextUrl.pathname,
      request.nextUrl.search,
      request.headers.get("host"),
      appBaseUrl().origin,
    );
    if (canonical) {
      if (!["GET", "HEAD"].includes(request.method))
        return NextResponse.json(
          {
            error:
              "Open the configured application address before submitting changes.",
          },
          { status: 403 },
        );
      // Next's proxy adapter relativizes loopback redirects against its bind
      // hostname. A route handler emits the exact absolute Location instead.
      const bridge = new URL("/auth/local-origin", request.url);
      bridge.searchParams.set("pathname", canonical.pathname);
      bridge.searchParams.set("search", canonical.search);
      const response = NextResponse.rewrite(bridge);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    return await auth0().middleware(request);
  } catch {
    return NextResponse.json(
      {
        error:
          "Sign-in is temporarily unavailable. Check the Auth0 configuration.",
      },
      { status: 503 },
    );
  }
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|health$).*)",
  ],
};
