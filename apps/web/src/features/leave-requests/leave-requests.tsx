"use client";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { request } from "@/lib/http";
import { useResource } from "@/lib/use-resource";
import type { WorkspaceData } from "@/lib/model";
import { hours } from "@/lib/scheduling";
import { leavePath, type LeaveRequest, type LeaveSnapshot } from "./model";
import { LeaveDialog } from "./leave-dialog";
export function LeaveRequests({
  orgId,
  data,
  onChanged,
  reviewOnly = false,
}: {
  orgId: string;
  data: WorkspaceData;
  onChanged: () => Promise<void>;
  reviewOnly?: boolean;
}) {
  const revision = data.access.find((a) => a.orgId === orgId)?.revision ?? 0;
  const {
    data: snapshot,
    error: loadError,
    refresh,
  } = useResource<LeaveSnapshot>(leavePath(orgId), revision);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
    setError("");
  }, [orgId, snapshot?.canRequest, snapshot?.personId]);
  async function mutate(body: object, close = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(leavePath(orgId), body);
      await refresh();
      await onChanged();
      if (close) setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update leave");
    } finally {
      setBusy(false);
    }
  }
  const rows =
    snapshot?.requests.filter((r) => reviewOnly || r.userId === data.actorId) ??
    [];
  return (
    <section className="leave-view">
      <div className="feature-subheading">
        <div>
          <h2>{reviewOnly ? "Team leave requests" : "Time off"}</h2>
          <p>
            {reviewOnly
              ? "Review pending requests and manage approved leave"
              : "Pending requests do not change your availability"}
          </p>
        </div>
        {!reviewOnly && snapshot?.canRequest && snapshot.personId && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setOpen(true)}
          >
            <Plus size={14} />
            Request time off
          </button>
        )}
      </div>
      {(error || loadError) && (
        <p className="error" role="alert">
          {error || loadError}
        </p>
      )}
      {!snapshot ? (
        <p className="feature-message" role="status">
          {loadError ? "Leave requests unavailable" : "Loading leave requests…"}
        </p>
      ) : rows.length === 0 ? (
        <p className="feature-message">
          {reviewOnly ? "No leave requests yet." : "No time-off requests yet."}
        </p>
      ) : (
        rows.map((r) => (
          <LeaveRow
            key={r.id}
            row={r}
            review={reviewOnly && snapshot.canReview}
            canCancel={
              snapshot.canReview ||
              (r.userId === data.actorId && r.status === "pending")
            }
            busy={busy}
            onCommand={(body) => mutate(body)}
          />
        ))
      )}
      {open && snapshot?.personId && snapshot.canRequest && (
        <LeaveDialog
          timezone={data.organizations.find((o) => o.id === orgId)?.timezone}
          busy={busy}
          error={error}
          onClose={() => setOpen(false)}
          onSave={(body) => mutate(body, true)}
        />
      )}
    </section>
  );
}
function LeaveRow({
  row,
  review,
  canCancel,
  busy,
  onCommand,
}: {
  row: LeaveRequest;
  review: boolean;
  canCancel: boolean;
  busy: boolean;
  onCommand: (body: object) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="leave-row">
      <div className="leave-row-main">
        <div>
          <strong>
            {review ? `${row.personName} · ` : ""}
            {row.title}
          </strong>
          <small>
            {row.start} – {row.end} ·{" "}
            {row.dailyMinutes
              ? `${hours(row.dailyMinutes)}h per day`
              : "Full days"}
          </small>
        </div>
        <span className={`request-status ${row.status}`}>{row.status}</span>
        {canCancel &&
          (row.status === "pending" || row.status === "approved") && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    row.status === "approved"
                      ? "Cancel this approved leave and restore capacity?"
                      : "Cancel this leave request?",
                  )
                )
                  void onCommand({
                    kind: "cancel",
                    id: row.id,
                    version: row.version,
                  });
              }}
            >
              Cancel request
            </button>
          )}
      </div>
      {row.reviewNote && (
        <p className="feature-message">Review: {row.reviewNote}</p>
      )}
      {review && row.status === "pending" && (
        <form
          className="sheet-review"
          onSubmit={(e) => {
            e.preventDefault();
            void onCommand({
              kind: "review",
              id: row.id,
              version: row.version,
              decision: "approve",
              note,
            });
          }}
        >
          <label className="sr-only" htmlFor={`leave-${row.id}`}>
            Review note for {row.title}
          </label>
          <input
            id={`leave-${row.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Review note (required when declining)"
            maxLength={500}
            disabled={busy}
          />
          <button
            className="text-button"
            type="button"
            disabled={busy || !note.trim()}
            onClick={() =>
              void onCommand({
                kind: "review",
                id: row.id,
                version: row.version,
                decision: "reject",
                note,
              })
            }
          >
            Decline
          </button>
          <button className="primary" disabled={busy}>
            Approve leave
          </button>
        </form>
      )}
    </div>
  );
}
