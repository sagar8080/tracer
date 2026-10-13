import { NextRequest } from "next/server";
import { forward } from "@/lib/server/api";
export const POST = (request: NextRequest) =>
  forward(request, "/v1/invitations/accept");
