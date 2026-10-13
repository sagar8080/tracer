"use client";
import { useState } from "react";
import { Bot, Copy, Plus } from "lucide-react";
import type { WorkspaceData } from "@/lib/model";
import { useResource } from "@/lib/use-resource";
import { ApiError, request } from "@/lib/http";
import { permissions } from "@/features/tenancy/permissions";
import { RegisterDialog } from "./register-dialog";
import { ProposalDialog } from "./proposal-dialog";
import type { Agent, Issued, Registry, Proposal, Proposals } from "./model";
function AgentRegistry({
  orgId,
  data,
  onChanged,
}: {
  orgId: string;
  data: WorkspaceData;
  onChanged: () => Promise<void>;
}) {
  const revision = data.access.find((a) => a.orgId === orgId)?.revision ?? 0;
  const path = `/api/organizations/${orgId}/agents`;
  const resource = useResource<Registry>(path, revision);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [credential, setCredential] = useState(""),
    [notice, setNotice] = useState("");
  const projects = data.projects.filter((p) => p.orgId === orgId);
  async function mutate(command: object) {
    if (busy) return;
    setBusy(true);
    setError("");
    setCredential("");
    setNotice("");
    try {
      const result = await request<Issued>(path, command);
      setOpen(false);
      if (result.credential) {
        setCredential(result.credential);
        setNotice("Copy this credential now. It will not be shown again.");
      } else if ("kind" in command && command.kind !== "revoke")
        setNotice(
          "The change was saved, but the credential was not returned. Rotate it to issue a new one.",
        );
      else
        setNotice(
          "Delegation revoked. Its active sessions can no longer access planning tools.",
        );
      await onChanged();
      await resource.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update agent");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(credential);
      setNotice(
        "Credential copied. Store it in your agent’s secret configuration.",
      );
    } catch {
      setError(
        "Clipboard access is unavailable. Try copying from a supported browser.",
      );
    }
  }
  return (
    <>
      <div className="feature-subheading">
        <div>
          <h2>Delegated agents</h2>
          <span>Scoped access to your planning work</span>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError("");
            setCredential("");
            setOpen(true);
          }}
          disabled={busy || !projects.length}
        >
          <Plus size={14} />
          Register agent
        </button>
      </div>
      {resource.error && (
        <p className="error" role="alert">
          {resource.error}
        </p>
      )}
      {error && !open && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <div className="agent-credential" role="status">
          <span>{notice}</span>
          {credential && (
            <>
              <input
                type="password"
                value={credential}
                readOnly
                aria-label="Agent credential"
              />
              <button className="secondary" onClick={() => void copy()}>
                <Copy size={13} />
                Copy credential
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setCredential("");
                  setNotice("");
                }}
              >
                Done
              </button>
            </>
          )}
        </div>
      )}
      {!resource.data ? (
        <p className="report-note">Loading agents…</p>
      ) : !resource.data.agents.length ? (
        <p className="feature-empty">
          Register an agent to give it access to selected projects. People and
          agents keep separate identities.
        </p>
      ) : (
        <div className="agent-list">
          {resource.data.agents.map((a: Agent) => (
            <div className="agent-row" key={a.id}>
              <Bot size={16} />
              <div>
                <strong>{a.name}</strong>
                <p>{a.purpose}</p>
                <span>
                  {a.scope.mode === "propose"
                    ? "Reads and proposes"
                    : "Reads schedules"}{" "}
                  ·{" "}
                  {a.scope.projectIds
                    .map(
                      (id) =>
                        projects.find((p) => p.id === id)?.name ??
                        "Removed project",
                    )
                    .join(", ")}
                </span>
              </div>
              <span>
                {a.revoked
                  ? "Revoked"
                  : a.active
                    ? "Active"
                    : "Delegation unavailable"}
              </span>
              <div className="agent-row-actions">
                <button
                  className="secondary"
                  disabled={busy || !a.active}
                  onClick={() =>
                    void mutate({
                      kind: "rotate",
                      id: a.id,
                      version: a.version,
                    })
                  }
                >
                  Rotate credential
                </button>
                <button
                  className="secondary"
                  disabled={busy || a.revoked}
                  onClick={() =>
                    void mutate({
                      kind: "revoke",
                      id: a.id,
                      version: a.version,
                    })
                  }
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="report-note">
        Agent sessions last up to five minutes. Rotation invalidates existing
        sessions; revocation also blocks child delegations. Project tools omit
        financial rates.
      </p>
      {open && (
        <RegisterDialog
          projects={projects}
          agents={resource.data?.agents ?? []}
          busy={busy}
          error={error}
          onSave={mutate}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function Agents({
  orgId,
  data,
  onChanged,
}: {
  orgId: string;
  data: WorkspaceData;
  onChanged: () => Promise<void>;
}) {
  const access = permissions(data, orgId, true),
    revision = data.access.find((a) => a.orgId === orgId)?.revision ?? 0;
  const [cursor, setCursor] = useState<string | null>(null);
  const path = `/api/organizations/${orgId}/proposals${cursor ? `?cursor=${cursor}` : ""}`;
  const resource = useResource<Proposals>(path, revision);
  const [selected, setSelected] = useState<Proposal | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function review(command: object) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/api/organizations/${orgId}/proposals`, command);
      setSelected(null);
      setNotice("Review recorded. The live schedule is unchanged.");
      await onChanged();
      await resource.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? "This proposal or its source plan changed. Request a fresh proposal, or reject it with a note."
          : e instanceof Error
            ? e.message
            : "Could not review proposal",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="feature-content">
      {access.administer && (
        <AgentRegistry orgId={orgId} data={data} onChanged={onChanged} />
      )}
      <div className="feature-subheading">
        <div>
          <h2>Planning proposals</h2>
          <span>Inspect suggested moves before changing commitments</span>
        </div>
        {cursor && (
          <button className="secondary" onClick={() => setCursor(null)}>
            First page
          </button>
        )}
      </div>
      {resource.error && (
        <p className="error" role="alert">
          {resource.error}
        </p>
      )}
      {notice && (
        <p className="report-note" role="status">
          {notice}
        </p>
      )}
      {!resource.data ? (
        <p className="report-note">Loading proposals…</p>
      ) : !resource.data.proposals.length ? (
        <p className="feature-empty">
          An agent with proposal access can suggest a move through the API or
          MCP. Suggestions appear here for review.
        </p>
      ) : (
        <div className="agent-list">
          {resource.data.proposals.map((p) => (
            <button
              className="agent-proposal-row"
              key={p.id}
              onClick={() => {
                setSelected(p);
                setError("");
              }}
            >
              <div>
                <strong>{p.preview.original.title}</strong>
                <p>{p.request.reason}</p>
                <span>
                  {p.agentName ?? "Workspace planner"} ·{" "}
                  {p.preview.original.start} → {p.preview.proposed.start}
                </span>
              </div>
              <span className="sheet-status">{p.status}</span>
            </button>
          ))}
        </div>
      )}
      {resource.data?.nextCursor && (
        <button
          className="secondary"
          onClick={() => setCursor(resource.data!.nextCursor)}
        >
          More proposals
        </button>
      )}
      {selected && (
        <ProposalDialog
          proposal={selected}
          people={data.people.filter((p) => p.orgId === orgId)}
          busy={busy}
          error={error}
          onSave={review}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
