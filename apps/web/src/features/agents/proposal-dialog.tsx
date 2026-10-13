"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState } from "react";
import type { Person } from "@/lib/model";
import { hours } from "@/lib/scheduling";
import type { Proposal } from "./model";
export function ProposalDialog({
  proposal,
  people,
  busy,
  error,
  onSave,
  onClose,
}: {
  proposal: Proposal;
  people: Person[];
  busy: boolean;
  error: string;
  onSave: (body: object) => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"markReviewed" | "reject">(
    "markReviewed",
  );
  const name = (id: string) =>
    people.find((p) => p.id === id)?.name ?? "Former team member";
  const total = (days: { overloadMinutes: number }[]) =>
    days.reduce((sum, d) => sum + d.overloadMinutes, 0);
  return (
    <Dialog.Root
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="editor feature-composer"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.querySelector("form")?.requestSubmit();
            }
          }}
        >
          <div className="team-heading">
            <div>
              <Dialog.Title>{proposal.preview.original.title}</Dialog.Title>
              <Dialog.Description>
                Inspect the suggested move. Review does not publish it.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="icon-button"
              disabled={busy}
              aria-label="Close"
            >
              <X size={17} />
            </Dialog.Close>
          </div>
          <p className="agent-reason">{proposal.request.reason}</p>
          <div className="agent-property">
            <span>Proposed by</span>
            <span>{proposal.agentName ?? "Workspace planner"}</span>
          </div>
          <div className="agent-property">
            <span>Current</span>
            <span>
              {name(proposal.preview.original.personId)} ·{" "}
              {proposal.preview.original.start} —{" "}
              {proposal.preview.original.end}
            </span>
          </div>
          <div className="agent-property">
            <span>Proposed</span>
            <span>
              {name(proposal.preview.proposed.personId)} ·{" "}
              {proposal.preview.proposed.start} —{" "}
              {proposal.preview.proposed.end}
            </span>
          </div>
          <div className="agent-property">
            <span>Daily effort</span>
            <span>{hours(proposal.preview.proposed.dailyMinutes)}h</span>
          </div>
          {proposal.preview.impacts.map((i) => (
            <div className="agent-property" key={i.personId}>
              <span>{name(i.personId)} overload</span>
              <span>
                {hours(total(i.before))}h → {hours(total(i.after))}h
              </span>
            </div>
          ))}
          {proposal.status === "pending" ? (
            <form
              className="feature-form"
              onSubmit={(e) => {
                e.preventDefault();
                void onSave({
                  kind: "review",
                  id: proposal.id,
                  version: proposal.version,
                  contentHash: proposal.contentHash,
                  decision,
                  note,
                });
              }}
            >
              <div className="agent-property">
                <label htmlFor="proposal-decision">Decision</label>
                <select
                  id="proposal-decision"
                  value={decision}
                  onChange={(e) =>
                    setDecision(e.target.value as "markReviewed" | "reject")
                  }
                >
                  <option value="markReviewed">Mark reviewed</option>
                  <option value="reject">Reject</option>
                </select>
              </div>
              <label className="feature-field">
                Review note
                <textarea
                  maxLength={1000}
                  required={decision === "reject"}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    decision === "reject"
                      ? "Explain what needs to change"
                      : "Optional feedback"
                  }
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="feature-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={onClose}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save review"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="report-note">
                {proposal.status} · {proposal.reviewNote || "No review note"}
              </p>
              <div className="feature-actions">
                <button className="secondary" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
