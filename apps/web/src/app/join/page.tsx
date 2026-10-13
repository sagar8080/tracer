import { auth0, authMode } from "@/lib/server/auth0";
import { Join } from "@/features/identity/join";
export const dynamic = "force-dynamic";
export default async function Page() {
  return (
    <Join signedIn={authMode === "auth0" && !!(await auth0().getSession())} />
  );
}
