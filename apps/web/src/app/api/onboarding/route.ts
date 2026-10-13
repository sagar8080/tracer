import { NextRequest } from "next/server";
import { forward } from "@/lib/server/api";
const proxy = (request: NextRequest) => forward(request, "/v1/onboarding");
export const GET = proxy;
export const POST = proxy;
