"use client";
import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowLeft, Check, RefreshCw } from "lucide-react";
import type { WorkspaceData } from "@/lib/model";
import { useResource } from "@/lib/use-resource";
import { request } from "@/lib/http";
import { MappingReview } from "./mapping-review";
import { downloadFile } from "./storage";
import type { Import, Preview, Review } from "./model";
export function ImportDetails({
  id,
  orgId,
  data,
  administer,
  onChanged,
  onBack,
  onRefresh,
}: {
  id: string;
  orgId: string;
  data: WorkspaceData;
  administer: boolean;
  onChanged: () => Promise<void>;
  onBack: () => void;
  onRefresh: (sourceId: string) => void;
}) {
  const path = `/api/organizations/${orgId}/imports/${id}`;
  const resource = useResource<Import>(path, 0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [edit, setEdit] = useState(false);
  const item = resource.data;
  const polling = item?.status === "queued" || item?.exportStatus === "queued";
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      if (!document.hidden) void resource.refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [polling, resource.refresh]);
  async function mutate(action: string, body: object) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`${path}/${action}`, body);
      setEdit(false);
      await resource.refresh();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update import");
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string) {
    setBusy(true);
    setError("");
    try {
      await downloadFile(orgId, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="imports">
      <div className="import-toolbar">
        <button className="secondary" onClick={onBack} disabled={busy}>
          <ArrowLeft size={14} />
          Imports
        </button>
        <span>{item?.filename ?? "Loading workbook…"}</span>
        <button
          className="icon-button"
          aria-label="Refresh import"
          disabled={busy}
          onClick={() => void resource.refresh().catch(() => {})}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {(error || resource.error) && (
        <p className="error" role="alert">
          {error || resource.error}
        </p>
      )}
      {item && (
        <>
          <div className="import-progress" aria-label="Import progress">
            <span className="complete">
              <Check size={12} />
              Uploaded
            </span>
            <span className={item.status === "review" ? "current" : ""}>
              Review mapping
            </span>
            <span className={item.preview ? "current" : ""}>Reconcile</span>
            <span className={item.status === "published" ? "complete" : ""}>
              Publish
            </span>
          </div>
          {item.status === "queued" && (
            <div className="import-pending" role="status">
              <RefreshCw size={18} />
              <h2>Reading your workbook</h2>
              <p>
                The original stays private. You can leave this page and return
                to the saved import.
              </p>
            </div>
          )}
          {item.status === "review" && (!item.preview || edit) && (
            <MappingReview
              key={`${item.id}:${item.version}`}
              item={item}
              data={data}
              orgId={orgId}
              administer={administer}
              busy={busy}
              onReview={(review: Review) => mutate("review", review)}
            />
          )}
          {item.preview && !edit && (
            <Reconciliation
              preview={item.preview}
              published={item.status === "published"}
            />
          )}
          {item.status === "review" && item.preview && !edit && (
            <div className="import-footer">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setEdit(true)}
              >
                Edit mapping
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  item.preview.findings.some((f) => f.severity === "block")
                }
                onClick={() =>
                  void mutate("publish", { version: item.version })
                }
              >
                {busy ? "Publishing…" : "Publish reviewed plan"}
              </button>
            </div>
          )}
          {item.status === "published" && (
            <>
              <p className="import-published" role="status">
                <Check size={15} />
                Published at workspace revision {item.publishedRevision}.
                Refreshes protect newer edits made in Kivo.
              </p>
              <div className="import-footer">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => onRefresh(item.sourceId)}
                >
                  Refresh from another file
                </button>
                {item.exportFileId ? (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void download(item.exportFileId!)}
                  >
                    <ArrowDownToLine size={14} />
                    Download reconciled CSV
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={busy || item.exportStatus === "queued"}
                    onClick={() =>
                      void mutate("export", { version: item.version })
                    }
                  >
                    <ArrowDownToLine size={14} />
                    {item.exportStatus === "queued"
                      ? "Preparing export…"
                      : item.exportStatus === "failed"
                        ? "Retry CSV export"
                        : "Export reconciled CSV"}
                  </button>
                )}
              </div>
            </>
          )}
          {item.errorCode && (
            <p className="error" role="alert">
              Processing could not finish after its retry budget. The staged
              import is retained.{" "}
              {item.status === "failed"
                ? "Cancel it and upload another file."
                : "Retry the export when storage is available."}
            </p>
          )}
          {item.status === "cancelled" && (
            <p className="muted">
              Import cancelled. No schedule changes were published.
            </p>
          )}
          <div className="import-secondary">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void download(item.fileId)}
            >
              Download original workbook
            </button>
            {["queued", "review", "failed"].includes(item.status) && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void mutate("cancel", { version: item.version })}
              >
                Cancel import
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
function Reconciliation({
  preview: p,
  published,
}: {
  preview: Preview;
  published: boolean;
}) {
  const [page, setPage] = useState(0);
  const changes = [
    ...p.additions.map((a) => ({ a, kind: "Add" })),
    ...p.updates.map((a) => ({ a, kind: "Update" })),
    ...p.removals.map((a) => ({ a, kind: "Remove" })),
  ];
  return (
    <section
      className="import-reconciliation"
      aria-label="Reconciliation preview"
    >
      <div className="feature-subheading">
        <div>
          <h2>
            {published ? "Published reconciliation" : "Your reconciled plan"}
          </h2>
          <span>
            {p.additions.length} additions · {p.updates.length} updates ·{" "}
            {p.removals.length} removals ·{" "}
            {(p.totalMinutes / 60).toLocaleString()} planned hours
          </span>
        </div>
      </div>
      {(p.people.length > 0 || p.projects.length > 0) && (
        <p className="muted">
          {p.people.length} scheduled people and {p.projects.length} projects
          will be created. New project budgets start from imported planned
          hours; review rates after import.
        </p>
      )}
      {p.findings.length > 0 && (
        <div
          className="import-findings"
          role={
            p.findings.some((f) => f.severity === "block") ? "alert" : "status"
          }
        >
          {p.findings.map((f, i) => (
            <p
              className={f.severity === "block" ? "error" : "import-warning"}
              key={i}
            >
              {f.cell && <span className="import-cell">{f.cell} · </span>}
              {f.message}
            </p>
          ))}
        </div>
      )}
      {p.capacity?.length > 0 && (
        <details className="import-sample">
          <summary>
            Inspect capacity conflicts · first {p.capacity.length} person-days
          </summary>
          <div
            className="import-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Capacity conflicts"
          >
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Date</th>
                  <th>Planned</th>
                  <th>Available</th>
                  <th>Capacity source</th>
                </tr>
              </thead>
              <tbody>
                {p.capacity.map((day) => (
                  <tr key={`${day.personId}:${day.date}`}>
                    <td>{day.name}</td>
                    <td>{day.date}</td>
                    <td>{day.plannedMinutes / 60}h</td>
                    <td>{day.availableMinutes / 60}h</td>
                    <td>
                      {day.calendarEffectiveFrom
                        ? `Calendar from ${day.calendarEffectiveFrom}`
                        : "Monday–Friday baseline"}
                      {day.absenceIds.length > 0
                        ? ` · ${day.absenceIds.length} leave/holiday records`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <div
        className="import-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Allocation changes"
      >
        <table>
          <thead>
            <tr>
              <th>Change</th>
              <th>Person</th>
              <th>Project</th>
              <th>Dates</th>
              <th>Daily hours</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {changes.slice(page * 40, (page + 1) * 40).map(({ a, kind }) => {
              const link = p.links.find((l) => l.assignment.id === a.id);
              return (
                <tr key={a.id}>
                  <td>
                    <span className={`import-change ${kind.toLowerCase()}`}>
                      {kind}
                    </span>
                  </td>
                  <td>{link?.personName ?? "Prior allocation"}</td>
                  <td>{link?.projectName ?? a.title}</td>
                  <td>
                    {a.start} → {a.end}
                  </td>
                  <td>{a.dailyMinutes / 60}h</td>
                  <td title={link?.cells.join(", ")}>
                    {link?.cells[0] ?? "Removed from source"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!changes.length && (
        <p className="muted">
          No allocation changes. Publishing records the reconciled source
          version.
        </p>
      )}
      {changes.length > 40 && (
        <div className="import-pagination">
          <button
            className="secondary"
            disabled={!page}
            onClick={() => setPage((v) => v - 1)}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {Math.ceil(changes.length / 40)}
          </span>
          <button
            className="secondary"
            disabled={(page + 1) * 40 >= changes.length}
            onClick={() => setPage((v) => v + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
