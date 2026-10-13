import { NextRequest, NextResponse } from "next/server";
import { auth0, authMode } from "@/lib/server/auth0";
export async function proxy(request: NextRequest) {
  if (authMode !== "auth0") return NextResponse.next();
  try {
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
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
