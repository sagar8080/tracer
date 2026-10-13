import { NextRequest } from "next/server";
import { forward } from "@/lib/server/api";
export const dynamic = "force-dynamic";
const proxy = (request: NextRequest) => forward(request, "/v1/workspace");
export const GET = proxy;
export const POST = proxy;
