"use client";
import { useState } from "react";
import type { WorkspaceData } from "@/lib/model";
import type { Import, Mapping, Review } from "./model";
import { initialMapping, labels, providerNames } from "./model";
export function MappingReview({
  item,
  data,
  orgId,
  administer,
  busy,
  onReview,
}: {
  item: Import;
  data: WorkspaceData;
  orgId: string;
  administer: boolean;
  busy: boolean;
  onReview: (input: Review) => Promise<void>;
}) {
  const [mapping, setMapping] = useState<Mapping>(() => initialMapping(item));
  const [personIds, setPersonIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      item.review?.people.map((p) => [p.label, p.id ?? "new"]) ?? [],
    ),
  );
  const [projectIds, setProjectIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      item.review?.projects.map((p) => [p.label, p.id ?? "new"]) ?? [],
    ),
  );
  const [working, setWorking] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(
      item.review?.people
        .filter((p) => p.weeklyMinutes)
        .map((p) => [p.label, p.weeklyMinutes!.map((v) => v / 60)]) ?? [],
    ),
  );
  const c = mapping.columns,
    sheet = item.workbook?.sheets[c.sheet];
  const people = data.people.filter((p) => p.orgId === orgId),
    projects = data.projects.filter(
      (p) => p.orgId === orgId && p.status !== "complete",
    );
  const personLabels = labels(item, mapping, "person"),
    projectLabels = labels(item, mapping, "project");
  function setColumns(patch: Partial<Mapping["columns"]>) {
    setMapping((v) => ({ ...v, columns: { ...v.columns, ...patch } }));
  }
  function exact(label: string, records: { id: string; name: string }[]) {
    const matches = records.filter((r) => r.name === label);
    return matches.length === 1 ? matches[0].id : "";
  }
  function column(
    field: "person" | "project" | "start" | "end" | "effort" | "rowKey",
    title: string,
    optional = false,
  ) {
    return (
      <label key={field}>
        {title}
        <select
          aria-label={`${title} column`}
          value={c[field] ?? ""}
          required={!optional}
          onChange={(e) =>
            setColumns({
              [field]: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        >
          <option value="">
            {optional ? "No stable ID column" : "Choose a column"}
          </option>
          {sheet?.headers.map((h, index) => (
            <option key={index} value={index}>
              {index + 1} · {h.value || "Untitled"}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (!sheet)
    return (
      <div className="import-findings" role="alert">
        {item.workbook?.findings.map((f, i) => (
          <p key={i}>{f.message}</p>
        ))}
        <p>Upload a corrected workbook to continue.</p>
      </div>
    );
  return (
    <form
      className="import-review"
      onSubmit={(e) => {
        e.preventDefault();
        void onReview({
          version: item.version,
          mapping,
          people: personLabels.map((label) => ({
            label,
            id:
              (personIds[label] ?? exact(label, people)) === "new"
                ? null
                : (personIds[label] ?? exact(label, people)),
            weeklyMinutes: (working[label] ?? []).map((v) => v * 60),
          })),
          projects: projectLabels.map((label) => ({
            label,
            id:
              (projectIds[label] ?? exact(label, projects)) === "new"
                ? null
                : (projectIds[label] ?? exact(label, projects)),
          })),
        });
      }}
    >
      <div className="feature-subheading">
        <div>
          <h2>Interpret your workbook</h2>
          <span>
            {item.workbook?.suggestion
              ? item.workbook.suggestionProvider === "manual"
                ? "Matched common column headers. Confirm their meaning."
                : `${providerNames[item.workbook.suggestionProvider]} suggested these columns. Confirm their meaning.`
              : "Choose what each column means."}
          </span>
        </div>
      </div>
      <div className="import-properties">
        <label>
          Worksheet
          <select
            value={c.sheet}
            onChange={(e) =>
              setColumns({
                sheet: Number(e.target.value),
                weeks: [],
                start: null,
                end: null,
                effort: null,
              })
            }
          >
            {item.workbook?.sheets.map((s, i) => (
              <option value={i} key={i}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Layout
          <select
            value={c.layout}
            onChange={(e) =>
              setColumns({
                layout: e.target.value as typeof c.layout,
                weeks: [],
                unit:
                  e.target.value === "weekly" ? "totalHours" : "hoursPerDay",
                start: null,
                end: null,
                effort: null,
              })
            }
          >
            <option value="tabular">Allocation rows</option>
            <option value="weekly">Weekly hours matrix</option>
          </select>
        </label>
        {column("person", "Person")}
        {column("project", "Project")}
        {c.layout === "tabular" && (
          <>
            {column("start", "Start date")}
            {column("end", "End date")}
            {column("effort", "Effort")}
          </>
        )}
        {column("rowKey", "Stable row ID", true)}
        <label>
          Effort unit
          <select
            value={c.unit}
            onChange={(e) =>
              setColumns({ unit: e.target.value as typeof c.unit })
            }
          >
            {c.layout === "tabular" && (
              <>
                <option value="hoursPerDay">Hours per working day</option>
                <option value="minutesPerDay">Minutes per working day</option>
              </>
            )}
            <option value="totalHours">Total hours over working days</option>
          </select>
        </label>
        <label>
          Date order
          <select
            value={c.dateOrder}
            onChange={(e) =>
              setColumns({ dateOrder: e.target.value as typeof c.dateOrder })
            }
          >
            <option value="iso">YYYY-MM-DD</option>
            <option value="mdy">Month / day / year</option>
            <option value="dmy">Day / month / year</option>
          </select>
        </label>
      </div>
      {c.layout === "weekly" && (
        <fieldset className="import-weeks">
          <legend>Dated Monday columns</legend>
          {sheet.headers.map(
            (h, index) =>
              index !== c.person &&
              index !== c.project &&
              index !== c.rowKey && (
                <label key={index}>
                  <input
                    type="checkbox"
                    checked={c.weeks.includes(index)}
                    onChange={(e) =>
                      setColumns({
                        weeks: e.target.checked
                          ? [...c.weeks, index].sort((a, b) => a - b)
                          : c.weeks.filter((v) => v !== index),
                      })
                    }
                  />
                  {h.value || `Column ${index + 1}`}
                </label>
              ),
          )}
        </fieldset>
      )}
      <details className="import-sample">
        <summary>Inspect source cells · {sheet.rows.length} rows</summary>
        <div
          className="import-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Source workbook sample"
        >
          <table>
            <thead>
              <tr>
                {sheet.headers.map((h, i) => (
                  <th key={i}>{h.value || "Untitled"}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.slice(0, 6).map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} title={cell.reference}>
                      {cell.value}
                      {cell.formula && <span className="muted"> · cached</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <div className="feature-subheading">
        <div>
          <h2>People and projects</h2>
          <span>
            Match existing records or explicitly create scheduled resources.
          </span>
        </div>
      </div>
      <div className="import-identities">
        {personLabels.map((label) => {
          const id = personIds[label] ?? exact(label, people);
          return (
            <div className="import-identity" key={label}>
              <label>
                {label}
                <select
                  required
                  aria-label={`Match person ${label}`}
                  value={id}
                  onChange={(e) =>
                    setPersonIds((v) => ({ ...v, [label]: e.target.value }))
                  }
                >
                  <option value="">Resolve person</option>
                  {people.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name} · {p.team}
                    </option>
                  ))}
                  {administer && (
                    <option value="new">Create scheduled person</option>
                  )}
                </select>
              </label>
              {id && id !== "new" && (
                <p className="muted">
                  Effective calendars apply. Without one:{" "}
                  {people.find((p) => p.id === id)?.dailyMinutes! / 60}h,
                  Monday–Friday.
                </p>
              )}
              {id === "new" && (
                <fieldset className="import-working">
                  <legend>Working hours · {label}</legend>
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (day, i) => (
                      <label key={day}>
                        {day}
                        <input
                          aria-label={`${label} ${day} working hours`}
                          type="number"
                          min="0"
                          max="24"
                          step="0.25"
                          required
                          value={working[label]?.[i] ?? ""}
                          onChange={(e) =>
                            setWorking((v) => {
                              const week = [...(v[label] ?? Array(7).fill(0))];
                              week[i] = Number(e.target.value);
                              return { ...v, [label]: week };
                            })
                          }
                        />
                      </label>
                    ),
                  )}
                </fieldset>
              )}
            </div>
          );
        })}
        {projectLabels.map((label) => (
          <div className="import-identity" key={label}>
            <label>
              {label}
              <select
                required
                aria-label={`Match project ${label}`}
                value={projectIds[label] ?? exact(label, projects)}
                onChange={(e) =>
                  setProjectIds((v) => ({ ...v, [label]: e.target.value }))
                }
              >
                <option value="">Resolve project</option>
                {projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="new">
                  Create project · budget from imported hours
                </option>
              </select>
            </label>
          </div>
        ))}
      </div>
      <label className="import-check">
        <input
          type="checkbox"
          checked={mapping.acceptCalendarDefaults}
          onChange={(e) =>
            setMapping((v) => ({
              ...v,
              acceptCalendarDefaults: e.target.checked,
            }))
          }
        />
        Use each existing person’s Monday–Friday baseline when no effective
        calendar is stored.
      </label>
      {item.workbook?.findings.some((f) => f.code === "cachedFormulas") && (
        <label className="import-check">
          <input
            type="checkbox"
            checked={mapping.acceptCachedFormulas}
            onChange={(e) =>
              setMapping((v) => ({
                ...v,
                acceptCachedFormulas: e.target.checked,
              }))
            }
          />
          I checked the saved formula results. Use these cached values without
          recalculation.
        </label>
      )}
      {item.workbook?.findings.map((f, i) => (
        <p key={i} className={f.severity === "block" ? "error" : "muted"}>
          {f.message}
        </p>
      ))}
      <div className="import-footer">
        <span>Nothing changes until you publish the reconciliation.</span>
        <button className="primary" disabled={busy}>
          {busy ? "Reviewing…" : "Preview reconciliation"}
        </button>
      </div>
    </form>
  );
}
