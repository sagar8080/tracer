import { NextRequest } from "next/server";
import { forward } from "@/lib/server/api";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ org: string }> },
) {
  const { org } = await context.params;
  return forward(
    request,
    `/v1/organizations/${encodeURIComponent(org)}/enrollment`,
  );
}
