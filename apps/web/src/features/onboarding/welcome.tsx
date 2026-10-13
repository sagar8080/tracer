"use client";
import { useEffect, useState } from "react";
import { ArrowRight, UserRound, Users, ArrowLeft } from "lucide-react";
import { request } from "@/lib/http";
import type { Role } from "@/features/tenancy/permissions";
type Status = {
  email: string;
  emailVerified: boolean;
  invitations: { id: string; organizationName: string; role: Role }[];
};
export function Welcome({
  account,
  onComplete,
  onCancel,
}: {
  account?: string;
  onComplete: (orgId: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [choice, setChoice] = useState<"personal" | "team" | "join" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [hours, setHours] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    request<Status>("/api/onboarding")
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function submit(invitationId?: string) {
    if (busy || !status?.emailVerified) return;
    setBusy(true);
    setError("");
    try {
      const result = invitationId
        ? await request<{ orgId: string }>("/api/invitations/accept", {
            id: invitationId,
          })
        : await request<{ orgId: string }>("/api/onboarding", {
            kind: choice,
            organization: {
              id: crypto.randomUUID(),
              name: workspace.trim(),
              timezone,
              currency: "USD",
              version: 1,
            },
            ...(choice === "personal"
              ? { profile: { name: name.trim(), dailyMinutes: hours * 60 } }
              : {}),
          });
      sessionStorage.setItem("kivo.selected-org", result.orgId);
      await onComplete(result.orgId);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not open your workspace",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="identity-page">
      <div className="identity-content onboarding-content">
        <span className="identity-mark" aria-hidden="true">
          k
        </span>
        <h1>
          {choice === "personal"
            ? "Make room for your work."
            : choice === "team"
              ? "A shared place to plan."
              : choice === "join"
                ? "Find your team."
                : "How will you use Kivo?"}
        </h1>
        {!status ? (
          <p role={error ? "alert" : "status"}>
            {error || "Getting your account ready…"}
          </p>
        ) : !status.emailVerified ? (
          <>
            <p>
              Verify {status.email} before creating or joining a workspace. Then
              sign in again to refresh your account.
            </p>
            <a
              className="primary"
              href="/auth/login?prompt=login&returnTo=%2Fapp"
            >
              I’ve verified my email
            </a>
          </>
        ) : (
          <>
            {status.invitations.length > 0 &&
              (!choice || choice === "join") && (
                <div className="onboarding-invitations">
                  <p>Your invitations</p>
                  {status.invitations.map((invite) => (
                    <button
                      className="onboarding-option"
                      key={invite.id}
                      disabled={busy}
                      onClick={() => void submit(invite.id)}
                    >
                      <Users size={18} />
                      <span>
                        <strong>{invite.organizationName}</strong>
                        <small>Join as {invite.role}</small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              )}
            {!choice ? (
              <div className="onboarding-options">
                <button
                  className="onboarding-option"
                  onClick={() => setChoice("personal")}
                >
                  <UserRound size={18} />
                  <span>
                    <strong>Plan for myself</strong>
                    <small>
                      Your projects, time, and capacity. Invite others later.
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
                <button
                  className="onboarding-option"
                  onClick={() => setChoice("team")}
                >
                  <Users size={18} />
                  <span>
                    <strong>Create a team workspace</strong>
                    <small>
                      Set up the workspace, then invite and schedule people.
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
                <button
                  className="text-button"
                  onClick={() => setChoice("join")}
                >
                  I’m joining an existing team
                </button>
              </div>
            ) : choice === "join" ? (
              <>
                <p>
                  {status.invitations.length
                    ? "Your team sets your access. Joining won’t create another workspace or a scheduling profile."
                    : `No active invitations for ${status.email}. Ask your workspace owner or admin to invite this email address, or open the invitation link they shared.`}
                </p>
                <button
                  className="text-button"
                  onClick={() => window.location.reload()}
                >
                  Check for invitations
                </button>
              </>
            ) : (
              <form
                className="onboarding-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <p>
                  {choice === "personal"
                    ? "We’ll add you to the schedule so you can start planning immediately."
                    : "You’ll be the owner. Add scheduling profiles separately from the people who need account access."}
                </p>
                {choice === "personal" && (
                  <label>
                    Your name
                    <input
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={100}
                      disabled={busy}
                    />
                  </label>
                )}
                <label>
                  Workspace name
                  <input
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    placeholder={
                      choice === "personal"
                        ? "My workspace"
                        : "e.g. Acme Studio"
                    }
                    required
                    maxLength={100}
                    disabled={busy}
                  />
                </label>
                <label>
                  Time zone
                  <input
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    required
                    disabled={busy}
                    list="onboarding-timezones"
                  />
                </label>
                <datalist id="onboarding-timezones">
                  {Intl.supportedValuesOf("timeZone").map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
                {choice === "personal" && (
                  <label>
                    Working hours per weekday
                    <input
                      type="number"
                      value={hours}
                      onChange={(e) => setHours(Number(e.target.value))}
                      min={1}
                      max={24}
                      step={0.25}
                      required
                      disabled={busy}
                    />
                  </label>
                )}
                <button className="primary" disabled={busy}>
                  {busy ? "Creating…" : "Create workspace"}
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {choice && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setChoice(null);
                  setError("");
                }}
              >
                <ArrowLeft size={14} /> Back
              </button>
            )}
          </>
        )}
        <div className="onboarding-footer">
          {onCancel && (
            <button className="text-button" disabled={busy} onClick={onCancel}>
              Back to workspace
            </button>
          )}
          {account && (
            <a className="text-button" href="/auth/logout">
              Sign out · {account}
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
