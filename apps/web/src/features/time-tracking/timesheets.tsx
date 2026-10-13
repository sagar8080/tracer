"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2 } from "lucide-react";
import type { WorkspaceData } from "@/lib/model";
import { addDays, hours, monday, today } from "@/lib/scheduling";
import { request } from "@/lib/http";
import { useResource } from "@/lib/use-resource";
import { EntryDialog } from "./entry-dialog";
import { timePath, type Entry, type Sheet, type TimeSnapshot } from "./model";
import { LeaveRequests } from "@/features/leave-requests/leave-requests";
export function Timesheets({
  orgId,
  data,
  onChanged,
}: {
  orgId: string;
  data: WorkspaceData;
  onChanged: () => Promise<void>;
}) {
  const timezone = data.organizations.find((o) => o.id === orgId)?.timezone;
  const [week, setWeek] = useState(monday(today(timezone)));
  const revision = data.access.find((a) => a.orgId === orgId)?.revision ?? 0;
  const {
    data: snapshot,
    error: loadError,
    refresh,
  } = useResource<TimeSnapshot>(`${timePath(orgId)}?week=${week}`, revision);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [draftSheetVersion, setDraftSheetVersion] = useState(0);
  const [composer, setComposer] = useState<Entry | "new" | null>(null),
    [tab, setTab] = useState("mine");
  const projects = data.projects.filter((p) => p.orgId === orgId);
  useEffect(() => {
    setComposer(null);
    setError("");
  }, [orgId, week, snapshot?.canRecord, snapshot?.personId]);
  async function mutate(body: object, close = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(timePath(orgId), body);
      await refresh();
      await onChanged();
      if (close) setComposer(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save time");
    } finally {
      setBusy(false);
    }
  }
  const own = snapshot?.own;
  const editable =
    !!snapshot?.personId &&
    !!snapshot.canRecord &&
    (!own || own.status === "draft");
  return (
    <div className="feature-view">
      <div className="workspace-toolbar">
        {tab !== "leave" ? (
          <div className="date-controls">
            <button
              className="icon-button"
              aria-label="Previous week"
              disabled={busy}
              onClick={() => setWeek(addDays(week, -7))}
            >
              <ChevronLeft size={16} />
            </button>
            <strong>Week of {week}</strong>
            <button
              className="icon-button"
              aria-label="Next week"
              disabled={busy}
              onClick={() => setWeek(addDays(week, 7))}
            >
              <ChevronRight size={16} />
            </button>
            <button
              className="today-button"
              onClick={() => setWeek(monday(today(timezone)))}
            >
              This week
            </button>
          </div>
        ) : (
          <span className="view-label">All leave requests</span>
        )}
        <div className="feature-tabs">
          <button
            className={tab === "mine" ? "active" : ""}
            onClick={() => setTab("mine")}
          >
            My time
          </button>
          {snapshot?.canReview && (
            <>
              <button
                className={tab === "review" ? "active" : ""}
                onClick={() => setTab("review")}
              >
                Team time
              </button>
              <button
                className={tab === "leave" ? "active" : ""}
                onClick={() => setTab("leave")}
              >
                Leave requests
              </button>
            </>
          )}
        </div>
      </div>
      {(error || loadError) && (
        <p className="error feature-error" role="alert">
          {error || loadError}
          <button
            className="text-button"
            onClick={() => void refresh().catch(() => {})}
          >
            Reload
          </button>
        </p>
      )}
      {!snapshot ? (
        <p className="feature-message" role="status">
          {loadError ? "Timesheets unavailable" : "Loading timesheets…"}
        </p>
      ) : tab === "leave" && snapshot.canReview ? (
        <LeaveRequests
          orgId={orgId}
          data={data}
          onChanged={onChanged}
          reviewOnly
        />
      ) : tab === "review" && snapshot.canReview ? (
        <div className="feature-content">
          {[...(own ? [own] : []), ...snapshot.reviews].length === 0 ? (
            <p className="feature-message">No timesheets for this week yet.</p>
          ) : (
            [...(own ? [own] : []), ...snapshot.reviews].map((sheet) => (
              <ReviewSheet
                key={sheet.id}
                sheet={sheet}
                projects={projects}
                busy={busy}
                onReview={(body) => mutate(body)}
              />
            ))
          )}
        </div>
      ) : (
        <div className="feature-content">
          <div className="feature-subheading">
            <div>
              <h2>{own?.personName ?? "My timesheet"}</h2>
              <p>
                {own
                  ? `${own.status[0].toUpperCase() + own.status.slice(1)} · ${hours(own.entries.reduce((s, e) => s + e.minutes, 0))}h recorded`
                  : "No time recorded this week"}
              </p>
            </div>
            {editable && (
              <button
                className="primary"
                disabled={busy || !projects.length}
                onClick={() => {
                  setDraftSheetVersion(own?.version ?? 0);
                  setComposer("new");
                }}
              >
                <Plus size={14} />
                Record time
              </button>
            )}
          </div>
          {!snapshot.personId && (
            <p className="feature-message">
              Ask a workspace administrator to link your account to a scheduling
              profile in Team access.
            </p>
          )}
          {!snapshot.canRecord && (
            <p className="feature-message">
              Your Viewer role has read-only access. A workspace administrator
              can update your role.
            </p>
          )}
          {snapshot.personId && snapshot.canRecord && !projects.length && (
            <p className="feature-message">
              A planner or administrator needs to add a project before you can
              record time.
            </p>
          )}
          {own?.reviewNote && (
            <p className="feature-message">Review: {own.reviewNote}</p>
          )}
          {own && (
            <EntryList
              sheet={own}
              projects={projects}
              editable={editable}
              busy={busy}
              onEdit={(entry) => {
                setDraftSheetVersion(own.version);
                setComposer(entry);
              }}
              onDelete={(entry) =>
                void mutate({
                  kind: "delete",
                  id: entry.id,
                  week,
                  version: entry.version,
                  sheetVersion: own.version,
                })
              }
            />
          )}
          {own && (
            <div className="sheet-actions">
              {own.status === "draft" &&
                snapshot.canRecord &&
                snapshot.personId && (
                  <button
                    className="primary"
                    disabled={busy || !own.entries.length}
                    onClick={() =>
                      void mutate({
                        kind: "submit",
                        week,
                        version: own.version,
                      })
                    }
                  >
                    Submit week
                  </button>
                )}
              {own.status === "submitted" &&
                snapshot.canRecord &&
                snapshot.personId && (
                  <>
                    <span>Submitted for approval. Entries are locked.</span>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void mutate({
                          kind: "withdraw",
                          week,
                          version: own.version,
                        })
                      }
                    >
                      Withdraw submission
                    </button>
                  </>
                )}
              {own.status === "approved" && (
                <span>Approved. This week is locked.</span>
              )}
            </div>
          )}
        </div>
      )}
      {composer && editable && (
        <EntryDialog
          entry={composer === "new" ? undefined : composer}
          week={week}
          projects={projects}
          busy={busy}
          error={error}
          onClose={() => setComposer(null)}
          onSave={(body) =>
            mutate({ ...body, sheetVersion: draftSheetVersion }, true)
          }
        />
      )}
    </div>
  );
}
function EntryList({
  sheet,
  projects,
  editable = false,
  busy,
  onEdit,
  onDelete,
}: {
  sheet: Sheet;
  projects: { id: string; name: string }[];
  editable?: boolean;
  busy: boolean;
  onEdit?: (e: Entry) => void;
  onDelete?: (e: Entry) => void;
}) {
  return (
    <div className="feature-table-scroll">
      <table className="feature-table time-entry-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Project</th>
            <th>Time</th>
            <th>Type</th>
            <th>Note</th>
            {editable && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sheet.entries.map((e) => (
            <tr key={e.id}>
              <td>{e.date}</td>
              <td>
                {projects.find((p) => p.id === e.projectId)?.name ?? "Project"}
              </td>
              <td>{hours(e.minutes)}h</td>
              <td>{e.billable ? "Billable" : "Non-billable"}</td>
              <td className="entry-note">{e.note || "—"}</td>
              {editable && (
                <td>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      disabled={busy}
                      onClick={() => onEdit?.(e)}
                      aria-label={`Edit time on ${e.date}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Delete this time entry?"))
                          onDelete?.(e);
                      }}
                      aria-label={`Delete time on ${e.date}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!sheet.entries.length && (
        <p className="feature-message">
          Record time as you work, then submit the week for review.
        </p>
      )}
    </div>
  );
}
function ReviewSheet({
  sheet,
  projects,
  busy,
  onReview,
}: {
  sheet: Sheet;
  projects: { id: string; name: string }[];
  busy: boolean;
  onReview: (body: object) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <section className="review-sheet">
      <div className="feature-subheading">
        <h2>{sheet.personName}</h2>
        <span>
          {sheet.status} ·{" "}
          {hours(sheet.entries.reduce((s, e) => s + e.minutes, 0))}h
        </span>
      </div>
      <EntryList sheet={sheet} projects={projects} busy={busy} />
      {sheet.reviewNote && (
        <p className="feature-message">Review: {sheet.reviewNote}</p>
      )}
      {sheet.status === "submitted" && (
        <form
          className="sheet-review"
          onSubmit={(e) => {
            e.preventDefault();
            void onReview({
              kind: "review",
              id: sheet.id,
              version: sheet.version,
              decision: "approve",
              note,
            });
          }}
        >
          <label className="sr-only" htmlFor={`review-${sheet.id}`}>
            Review note for {sheet.personName}
          </label>
          <input
            id={`review-${sheet.id}`}
            placeholder="Review note (required when returning)"
            value={note}
            maxLength={500}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="text-button"
            type="button"
            disabled={busy || !note.trim()}
            onClick={() =>
              void onReview({
                kind: "review",
                id: sheet.id,
                version: sheet.version,
                decision: "return",
                note,
              })
            }
          >
            Return for changes
          </button>
          <button className="primary" disabled={busy}>
            Approve week
          </button>
        </form>
      )}
    </section>
  );
}
