"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/http";
export function Join({ signedIn }: { signedIn: boolean }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const value = window.location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(value)) {
      sessionStorage.setItem("kivo.invitation", value);
      history.replaceState(null, "", "/join");
    }
    setToken(sessionStorage.getItem("kivo.invitation") ?? "");
  }, []);
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ orgId: string }>(
        "/api/invitations/accept",
        { token },
      );
      sessionStorage.removeItem("kivo.invitation");
      sessionStorage.setItem("kivo.selected-org", result.orgId);
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept invitation");
      setBusy(false);
    }
  }
  return (
    <main className="identity-page">
      <div className="identity-content">
        <span className="identity-mark" aria-hidden="true">
          k
        </span>
        <h1>Good work starts together.</h1>
        <p>
          Join your team’s workspace using the verified email address this
          invitation was sent to.
        </p>
        {!token ? (
          <p role="status">
            Open the full invitation link from your workspace administrator.
          </p>
        ) : signedIn ? (
          <button className="primary" disabled={busy} onClick={accept}>
            {busy ? "Joining…" : "Join workspace"}
          </button>
        ) : (
          <a className="primary" href="/auth/login?returnTo=%2Fjoin">
            Sign in to join
          </a>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {signedIn && (
          <a
            className="text-button"
            href="/auth/login?prompt=login&returnTo=%2Fjoin"
          >
            Use a different account
          </a>
        )}
      </div>
    </main>
  );
}
