import "server-only";
import { NextResponse } from "next/server";
import { callbackTarget } from "@/features/identity/auth-navigation";
import { Auth0Client } from "@auth0/nextjs-auth0/server";
export const authMode = process.env.KIVO_AUTH_MODE ?? "development";
let client: Auth0Client | undefined;
export function auth0() {
  if (authMode !== "auth0") throw new Error("Auth0 is not enabled");
  const required = [
    "AUTH0_DOMAIN",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_SECRET",
    "AUTH0_SECRET",
    "AUTH0_AUDIENCE",
    "APP_BASE_URL",
  ];
  if (required.some((key) => !process.env[key]))
    throw new Error("Auth0 configuration is incomplete");
  if (process.env.NEXT_PUBLIC_STORAGE_MODE !== "api")
    throw new Error("Auth0 requires NEXT_PUBLIC_STORAGE_MODE=api");
  const base = appBaseUrl();
  client ??= new Auth0Client({
    appBaseUrl: base.origin,
    onCallback: async (error, context) => {
      const response = NextResponse.redirect(
        callbackTarget(
          base.origin,
          error ? error.code : null,
          context.returnTo,
        ),
      );
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
    signInReturnToPath: "/app",
    authorizationParameters: {
      audience: process.env.AUTH0_AUDIENCE!,
      scope: "openid profile email offline_access",
    },
    enableAccessTokenEndpoint: false,
    allowInsecureRequests:
      process.env.NODE_ENV !== "production" &&
      process.env.KIVO_AUTH0_LOCAL_TEST === "1" &&
      /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(
        process.env.AUTH0_DOMAIN!,
      ),
    session: {
      rolling: true,
      inactivityDuration: 86400,
      absoluteDuration: 604800,
    },
  });
  return client;
}

export function appBaseUrl() {
  const base = new URL(process.env.APP_BASE_URL ?? "");
  if (
    base.origin !== process.env.APP_BASE_URL ||
    (base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(base.hostname)
      ))
  )
    throw new Error(
      "APP_BASE_URL must be an exact HTTPS origin (HTTP only on loopback)",
    );
  return base;
}
