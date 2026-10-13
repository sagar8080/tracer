import { NextRequest } from "next/server";
import { forward } from "@/lib/server/api";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ org: string }> },
) {
  const { org } = await context.params;
  const query = new URLSearchParams();
  return forward(
    request,
    `/v1/organizations/${encodeURIComponent(org)}/leave${query.size ? `?${query}` : ""}`,
  );
}
export const GET = proxy;
export const POST = proxy;
