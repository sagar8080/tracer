import type { Metadata } from "next";
import { Landing } from "@/features/marketing/landing";
import { auth0, authMode } from "@/lib/server/auth0";
export const metadata: Metadata = {
  title: "Kivo — Make room for better work",
  description:
    "Bring people, projects and capacity into one clear plan. Resource scheduling, time tracking and scoped agent proposals for modern teams.",
  openGraph: {
    title: "Kivo — Make room for better work",
    description:
      "Know who’s free. Plan what’s next. A shared workspace for people, projects and capacity.",
    type: "website",
  },
};
export const dynamic = "force-dynamic";
export default async function Page() {
  const signedIn =
    authMode === "auth0" ? !!(await auth0().getSession()) : false;
  return <Landing authEnabled={authMode === "auth0"} signedIn={signedIn} />;
}
