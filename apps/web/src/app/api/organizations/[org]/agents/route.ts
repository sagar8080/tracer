import { NextRequest } from "next/server";
import { forward } from "@/lib/server/api";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ org: string }> },
) {
  const { org } = await context.params;
  return forward(
    request,
    `/v1/organizations/${encodeURIComponent(org)}/agents`,
  );
}
export const GET = proxy;
export const POST = proxy;
