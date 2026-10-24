import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth0, authMode } from "@/lib/server/auth0";
import { SignInRecovery } from "@/features/identity/sign-in-recovery";
export const metadata: Metadata = {
  title: "Sign in again — Kivo",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const expired = (await searchParams).reason === "state";
  // A replayed callback never establishes a session. An already authenticated
  // browser can continue using its independently verified existing session.
  if (expired && authMode === "auth0" && (await auth0().getSession()))
    redirect("/app");
  return <SignInRecovery expired={expired} />;
}
