import { NextRequest } from "next/server";
import { forward } from "@/lib/server/api";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ org: string }> },
) {
  const { org } = await context.params;
  const query = new URLSearchParams();
  const cursor = request.nextUrl.searchParams.get("cursor");
  if (cursor) query.set("cursor", cursor);
  return forward(
    request,
    `/v1/organizations/${encodeURIComponent(org)}/proposals${query.size ? `?${query}` : ""}`,
  );
}
export const GET = proxy;
export const POST = proxy;
