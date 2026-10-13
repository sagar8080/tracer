"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Copy, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { request } from "@/lib/http";
import { MemberEnrollment } from "@/features/onboarding/member-enrollment";
import type { Person } from "@/lib/model";
import type { Role } from "./permissions";
type Member = {
  userId: string;
  email: string;
  role: Role;
  version: number;
  personId: string | null;
};
type Invitation = { id: string; email: string; role: Role; expiresAt: string };
type Team = { members: Member[]; invitations: Invitation[] };
const roles: Role[] = ["owner", "admin", "planner", "member", "viewer"];
const descriptions: Record<Role, string> = {
  owner: "Workspace ownership and all settings",
  admin: "People, calendars, financial rates, and team access",
  planner: "Projects, allocations, and time off",
  member: "View people, projects, and schedules",
  viewer: "Read-only workspace access",
};
export function TeamDialog({
  orgId,
  revision,
  role,
  actorId,
  people,
  onClose,
  onChanged,
}: {
  orgId: string;
  revision: number;
  role: Role;
  actorId: string | null;
  people: Person[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [team, setTeam] = useState<Team | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(""),
    [inviteRole, setInviteRole] = useState<Role>("member"),
    [link, setLink] = useState(""),
    [notice, setNotice] = useState("");
  const path = `/api/organizations/${orgId}/team`;
  const canManage = (target: Role) =>
    role === "owner" ||
    (role === "admin" && target !== "owner" && target !== "admin");
  useEffect(() => {
    let cancelled = false;
    request<Team>(path)
      .then((t) => {
        if (!cancelled) setTeam(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [path, revision]);
  async function mutate(command: object) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request<{
        invitation: Invitation;
        token: string | null;
      } | null>(path, command);
      if (result) {
        setEmail("");
        setLink(
          result.token ? `${window.location.origin}/join#${result.token}` : "",
        );
        setNotice(
          result.token
            ? "Invitation ready. Share this link with your teammate; it expires in 7 days."
            : "Invitation created, but its link could not be recovered. Revoke it and create a new invitation.",
        );
      }
      await onChanged();
      setTeam(await request<Team>(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update team");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="editor team-dialog">
          <div className="team-heading">
            <div>
              <Dialog.Title>People with access</Dialog.Title>
              <Dialog.Description>
                Give teammates access, then add them to the schedule when
                needed.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="icon-button"
              disabled={busy}
              aria-label="Close team settings"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <form
            className="invite-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate({ kind: "invite", email, role: inviteRole });
            }}
          >
            <label className="sr-only" htmlFor="invite-email">
              Email address
            </label>
            <input
              id="invite-email"
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              disabled={busy}
            />
            <label className="sr-only" htmlFor="invite-role">
              Invitation role
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              disabled={busy}
            >
              {roles
                .filter((r) => r !== "owner" && canManage(r))
                .map((r) => (
                  <option key={r} value={r}>
                    {r[0].toUpperCase() + r.slice(1)}
                  </option>
                ))}
            </select>
            <button className="primary" disabled={busy}>
              <UserPlus size={14} /> Invite
            </button>
          </form>
          <p className="role-explanation">
            {descriptions[inviteRole]}. Only owners and admins can see financial
            rates.
          </p>
          {notice && <p role="status">{notice}</p>}
          {link && (
            <div className="invitation-link">
              <input
                aria-label="Invitation link"
                value={link}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <button
                className="icon-button"
                aria-label="Copy invitation link"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setNotice("Invitation link copied.");
                  } catch {
                    setNotice("Select the link to copy it.");
                  }
                }}
              >
                <Copy size={16} />
              </button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!team ? (
            <p role="status">Loading team…</p>
          ) : (
            <div className="team-list">
              {team.members.map((member) => (
                <div className="team-member" key={member.userId}>
                  <div className="team-row">
                    <div className="team-person">
                      <strong>{member.email}</strong>
                      {member.userId === actorId && <small>You</small>}
                    </div>
                    <select
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      disabled={busy || !canManage(member.role)}
                      onChange={(e) =>
                        void mutate({
                          kind: "changeRole",
                          userId: member.userId,
                          version: member.version,
                          role: e.target.value,
                        })
                      }
                    >
                      {roles
                        .filter((r) => canManage(r) || r === member.role)
                        .map((r) => (
                          <option key={r} value={r}>
                            {r[0].toUpperCase() + r.slice(1)}
                          </option>
                        ))}
                    </select>
                    <button
                      className="text-button"
                      disabled={busy || !canManage(member.role)}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${member.email} from this workspace?`,
                          )
                        )
                          void mutate({
                            kind: "remove",
                            userId: member.userId,
                            version: member.version,
                          });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  <MemberEnrollment
                    orgId={orgId}
                    userId={member.userId}
                    email={member.email}
                    version={member.version}
                    personId={member.personId}
                    people={people}
                    linkedIds={
                      new Set(
                        team.members.flatMap((m) =>
                          m.personId ? [m.personId] : [],
                        ),
                      )
                    }
                    onChanged={async () => {
                      await onChanged();
                      setTeam(await request<Team>(path));
                    }}
                  />
                </div>
              ))}
              {!!team.invitations.length && <h3>Pending invitations</h3>}
              {team.invitations.map((invite) => (
                <div className="team-row" key={invite.id}>
                  <div className="team-person">
                    <strong>{invite.email}</strong>
                    <small>
                      Expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </small>
                  </div>
                  <span>{invite.role}</span>
                  <button
                    className="text-button"
                    disabled={busy || !canManage(invite.role)}
                    onClick={() => {
                      setLink("");
                      void mutate({ kind: "revoke", id: invite.id });
                    }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
