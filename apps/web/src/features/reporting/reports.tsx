"use client";
import { useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import type { WorkspaceData } from "@/lib/model";
import { useResource } from "@/lib/use-resource";
import { addDays, hours, monday, today } from "@/lib/scheduling";
import { type Report, utilization } from "./model";
export function Reports({
  orgId,
  data,
}: {
  orgId: string;
  data: WorkspaceData;
}) {
  const week = monday(
    today(data.organizations.find((o) => o.id === orgId)?.timezone),
  );
  const [start, setStart] = useState(week),
    [end, setEnd] = useState(addDays(week, 6)),
    [tab, setTab] = useState("projects");
  const [draftStart, setDraftStart] = useState(start),
    [draftEnd, setDraftEnd] = useState(end);
  const revision = data.access.find((a) => a.orgId === orgId)?.revision ?? 0;
  const {
    data: report,
    error,
    refresh,
  } = useResource<Report>(
    `/api/organizations/${orgId}/reports?start=${start}&end=${end}`,
    revision,
  );
  function exportCsv() {
    if (!report) return;
    const q = (v: string | number) => {
      const text =
        typeof v === "string" && /^[=+@\-\t\r]/.test(v) ? `'${v}` : String(v);
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [
      [
        "Project",
        "Planned hours",
        "Recorded hours",
        "Approved hours",
        "Billable hours",
        "Hour budget",
        "Lifetime approved hours",
      ],
      ...report.projects.map((p) => [
        p.name,
        hours(p.plannedMinutes),
        hours(p.recordedMinutes),
        hours(p.approvedMinutes),
        hours(p.billableMinutes),
        hours(p.budgetMinutes),
        hours(p.lifetimeApprovedMinutes),
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `kivo-hours-${start}-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="feature-view">
      <div className="workspace-toolbar">
        <form
          className="report-period"
          onSubmit={(e) => {
            e.preventDefault();
            setStart(draftStart);
            setEnd(draftEnd);
          }}
        >
          <label>
            From
            <input
              type="date"
              required
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              required
              min={draftStart}
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
            />
          </label>
          <button className="button">Apply</button>
        </form>
        <button className="text-button" disabled={!report} onClick={exportCsv}>
          <ArrowDownToLine size={14} />
          Export CSV
        </button>
      </div>
      {error && (
        <p className="error feature-error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => void refresh().catch(() => {})}
          >
            Reload
          </button>
        </p>
      )}
      {!report ? (
        <p className="feature-message" role="status">
          {error ? "Report unavailable" : "Calculating your report…"}
        </p>
      ) : (
        <div className="feature-content">
          <div className="report-summary">
            <span>
              <strong>{hours(report.totals.plannedMinutes)}h</strong> planned
            </span>
            <span>
              <strong>{hours(report.totals.recordedMinutes)}h</strong> recorded
            </span>
            <span>
              <strong>{hours(report.totals.approvedMinutes)}h</strong> approved
            </span>
            <span>
              <strong>
                {utilization(
                  report.totals.recordedMinutes,
                  report.totals.capacityMinutes,
                )}
              </strong>{" "}
              actual utilization
            </span>
            <span>
              <strong>
                {utilization(
                  report.totals.billableMinutes,
                  report.totals.capacityMinutes,
                )}
              </strong>{" "}
              billable utilization
            </span>
          </div>
          <DailyChart report={report} />
          <p className="report-note">
            Recorded hours include drafts and submissions. Budget usage counts
            approved hours across the project’s lifetime. Capacity includes
            approved leave and workspace holidays.
          </p>
          <div className="feature-tabs report-tabs">
            <button
              className={tab === "projects" ? "active" : ""}
              onClick={() => setTab("projects")}
            >
              Projects
            </button>
            <button
              className={tab === "people" ? "active" : ""}
              onClick={() => setTab("people")}
            >
              People
            </button>
          </div>
          <div className="feature-table-scroll">
            {tab === "projects" ? (
              <table className="feature-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Planned</th>
                    <th>Recorded</th>
                    <th>Variance</th>
                    <th>Billable</th>
                    <th>Approved</th>
                    <th>Budget usage</th>
                  </tr>
                </thead>
                <tbody>
                  {report.projects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className={`project-dot ${p.color}`} />
                        {p.name}
                      </td>
                      <td>{hours(p.plannedMinutes)}h</td>
                      <td>{hours(p.recordedMinutes)}h</td>
                      <td
                        className={
                          p.recordedMinutes > p.plannedMinutes ? "over" : ""
                        }
                      >
                        {p.recordedMinutes >= p.plannedMinutes ? "+" : ""}
                        {hours(p.recordedMinutes - p.plannedMinutes)}h
                      </td>
                      <td>{hours(p.billableMinutes)}h</td>
                      <td>{hours(p.approvedMinutes)}h</td>
                      <td>
                        <span>
                          {hours(p.lifetimeApprovedMinutes)} /{" "}
                          {hours(p.budgetMinutes)}h
                        </span>
                        <small
                          className={
                            p.lifetimeApprovedMinutes > p.budgetMinutes
                              ? "over"
                              : ""
                          }
                        >
                          {" "}
                          ·{" "}
                          {utilization(
                            p.lifetimeApprovedMinutes,
                            p.budgetMinutes,
                          )}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="feature-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Capacity</th>
                    <th>Planned</th>
                    <th>Recorded</th>
                    <th>Approved</th>
                    <th>Actual utilization</th>
                    <th>Billable utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {report.people.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{hours(p.capacityMinutes)}h</td>
                      <td>{hours(p.plannedMinutes)}h</td>
                      <td>{hours(p.recordedMinutes)}h</td>
                      <td>{hours(p.approvedMinutes)}h</td>
                      <td>
                        {utilization(p.recordedMinutes, p.capacityMinutes)}
                      </td>
                      <td>
                        {utilization(p.billableMinutes, p.capacityMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {!report.projects.length && tab === "projects" && (
            <p className="feature-message">
              Add projects and record time to compare plans with actual work.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
function DailyChart({ report }: { report: Report }) {
  const max = Math.max(
    60,
    ...report.days.flatMap((d) => [d.plannedMinutes, d.recordedMinutes]),
  );
  const point = (i: number, m: number) =>
    `${40 + (i / Math.max(1, report.days.length - 1)) * 840},${160 - (m / max) * 130}`;
  return (
    <div className="report-chart">
      <div className="report-chart-heading">
        <h2>Daily hours</h2>
        <span>
          <i className="legend-planned" />
          Planned <i className="legend-actual" />
          Recorded
        </span>
      </div>
      <svg
        viewBox="0 0 920 190"
        role="img"
        aria-label={`Daily planned and recorded hours from ${report.start} to ${report.end}`}
      >
        <line x1="40" x2="880" y1="160" y2="160" stroke="var(--line-strong)" />
        <line x1="40" x2="880" y1="95" y2="95" stroke="var(--line)" />
        <text x="4" y="34">
          {hours(max)}h
        </text>
        <text x="16" y="163">
          0
        </text>
        <polyline
          points={report.days
            .map((d, i) => point(i, d.plannedMinutes))
            .join(" ")}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
        <polyline
          points={report.days
            .map((d, i) => point(i, d.recordedMinutes))
            .join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        {report.days.map((d, i) => (
          <circle
            key={d.date}
            cx={point(i, d.recordedMinutes).split(",")[0]}
            cy={point(i, d.recordedMinutes).split(",")[1]}
            r="3"
            fill="var(--accent)"
          >
            <title>
              {d.date}: {hours(d.plannedMinutes)}h planned,{" "}
              {hours(d.recordedMinutes)}h recorded
            </title>
          </circle>
        ))}
        <text x="40" y="183">
          {report.start}
        </text>
        <text x="880" y="183" textAnchor="end">
          {report.end}
        </text>
      </svg>
    </div>
  );
}
