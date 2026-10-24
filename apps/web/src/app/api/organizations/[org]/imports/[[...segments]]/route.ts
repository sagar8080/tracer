import { NextRequest, NextResponse } from "next/server";
import { forward } from "@/lib/server/api";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ org: string; segments?: string[] }> },
) {
  const { org, segments = [] } = await context.params;
  if (
    segments.length > 2 ||
    (segments[0] && !/^[0-9a-f-]{36}$/i.test(segments[0])) ||
    (segments[1] &&
      !["review", "publish", "cancel", "export"].includes(segments[1])) ||
    (request.method === "GET" && segments.length > 1)
  )
    return NextResponse.json(
      { error: "Unknown import route" },
      { status: 404 },
    );
  return forward(
    request,
    `/v1/organizations/${encodeURIComponent(org)}/imports${segments.length ? `/${segments.join("/")}` : ""}`,
    segments[1] === "review" ? 2 * 1024 * 1024 : 65536,
  );
}
export const GET = proxy;
export const POST = proxy;
