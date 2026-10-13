import { NextRequest } from "next/server";
import { forward } from "@/lib/server/api";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ org: string }> },
) {
  const { org } = await context.params;
  const query = new URLSearchParams();
  const week = request.nextUrl.searchParams.get("week");
  if (week) query.set("week", week);
  return forward(
    request,
    `/v1/organizations/${encodeURIComponent(org)}/time${query.size ? `?${query}` : ""}`,
  );
}
export const GET = proxy;
export const POST = proxy;
