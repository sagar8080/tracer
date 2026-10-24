import { NextRequest, NextResponse } from "next/server";
import { forward } from "@/lib/server/api";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ org: string; segments?: string[] }> },
) {
  const { org, segments = [] } = await context.params;
  if (
    segments.length &&
    !(
      segments.length === 2 &&
      /^[0-9a-f-]{36}$/i.test(segments[0]) &&
      ["complete", "download"].includes(segments[1])
    )
  )
    return NextResponse.json({ error: "Unknown file route" }, { status: 404 });
  return forward(
    request,
    `/v1/organizations/${encodeURIComponent(org)}/files${segments.length ? `/${segments.join("/")}` : ""}`,
  );
}
