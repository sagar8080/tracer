import { NextRequest } from "next/server";
import { forward } from "@/lib/server/api";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ org: string }> },
) {
  const { org } = await context.params;
  const query = new URLSearchParams();
  const start = request.nextUrl.searchParams.get("start");
  if (start) query.set("start", start);
  const end = request.nextUrl.searchParams.get("end");
  if (end) query.set("end", end);
  return forward(
    request,
    `/v1/organizations/${encodeURIComponent(org)}/reports${query.size ? `?${query}` : ""}`,
  );
}
export const GET = proxy;
