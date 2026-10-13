import Workspace from "@/components/workspace";
import { auth0, authMode } from "@/lib/server/auth0";
import { SignIn } from "@/features/identity/sign-in";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (authMode === "auth0") {
    const session = await auth0().getSession();
    if (!session) return <SignIn />;
    return <Workspace account={session.user.email ?? "Your account"} />;
  }
  return <Workspace />;
}
