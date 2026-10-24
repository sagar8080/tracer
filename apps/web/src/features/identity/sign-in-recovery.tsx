export function SignInRecovery({ expired }: { expired: boolean }) {
  return (
    <main className="identity-page">
      <div className="identity-content">
        <span className="identity-mark" aria-hidden="true">
          k
        </span>
        <h1>
          {expired ? "Let’s start sign-in again." : "Sign-in didn’t finish."}
        </h1>
        <p>
          {expired
            ? "This sign-in link has expired or was opened on a different local address. Start a fresh sign-in to continue."
            : "Try signing in again. If this continues, check your workspace’s sign-in configuration."}
        </p>
        <a className="primary" href="/auth/login?returnTo=%2Fapp">
          Sign in again <span aria-hidden="true">↗</span>
        </a>
        <span className="identity-note">
          Joining a team? Reopen your invitation link after signing in.
        </span>
        <a className="text-button" href="/">
          Back to Kivo
        </a>
      </div>
    </main>
  );
}
