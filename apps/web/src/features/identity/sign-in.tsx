export function SignIn() {
  return (
    <main className="identity-page">
      <div className="identity-content">
        <span className="identity-mark" aria-hidden="true">
          k
        </span>
        <h1>A little more room to plan.</h1>
        <p>
          Bring your people, projects, and availability into one shared
          workspace.
        </p>
        <a className="primary" href="/auth/login">
          Sign in to Kivo <span aria-hidden="true">↗</span>
        </a>
        <a className="text-button" href="/auth/login?screen_hint=signup">
          New to Kivo? Create an account
        </a>
        <span className="identity-note">
          Joining a team? Use the email address you were invited with.
        </span>
      </div>
    </main>
  );
}
