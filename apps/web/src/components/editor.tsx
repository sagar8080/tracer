"use client";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Trash2,
  AlertTriangle,
  CalendarDays,
  Users,
  FolderKanban,
  Building2,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  assignmentSchema,
  personSchema,
  projectSchema,
  organizationSchema,
  colors,
  calendarSchema,
  absenceSchema,
  type WorkingCalendar,
  type Absence,
  type Assignment,
  type Person,
  type Project,
  type Organization,
  type WorkspaceData,
} from "@/lib/model";
import {
  addDays,
  loadOn,
  dates,
  workingDays,
  availabilityOn,
  baseCapacityOn,
  weeklyMinutes,
} from "@/lib/scheduling";
export type EditorState =
  | { kind: "assignment"; value: Partial<Assignment> }
  | { kind: "calendar"; value: Partial<WorkingCalendar> }
  | { kind: "absence"; value: Partial<Absence> }
  | { kind: "person"; value: Partial<Person> }
  | { kind: "project"; value: Partial<Project> }
  | { kind: "organization"; value: Partial<Organization> };
export default function Editor({
  editor,
  canFinance = true,
  externalError = "",
  data,
  orgId,
  onClose,
  onSave,
  onDelete,
}: {
  editor: EditorState;
  canFinance?: boolean;
  externalError?: string;
  data: WorkspaceData;
  orgId: string;
  onClose: () => void;
  onSave: (
    kind: EditorState["kind"],
    value:
      Assignment | Person | Project | Organization | WorkingCalendar | Absence,
  ) => void;
  onDelete: (id: string) => void;
}) {
  const [error, setError] = useState("");
  const titleInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | number>>(
    () => ({ ...editor.value }) as Record<string, string | number>,
  );
  const field = (
    key: string,
    label: string,
    type = "text",
    options?: { id: string; name: string }[],
  ) => (
    <label
      className={`field ${key === "title" || key === "name" ? "title-field" : ""}`}
      key={key}
    >
      <span>{label}</span>
      {options ? (
        <select
          value={draft[key] ?? ""}
          required
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        >
          <option value="" disabled>
            Select {label.toLowerCase()}
          </option>
          {options.map((o) => (
            <option value={o.id} key={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          ref={
            key === "title" || key === "name" || key === "effectiveFrom"
              ? titleInput
              : undefined
          }
          name={key}
          type={type}
          placeholder={
            key === "title"
              ? editor.kind === "absence"
                ? label
                : "What needs to get done?"
              : key === "name"
                ? label
                : undefined
          }
          value={draft[key] ?? ""}
          required
          min={type === "number" ? 0 : undefined}
          step={
            key === "hours" ? 0.25 : key === "cost" || key === "rate" ? 0.01 : 1
          }
          maxLength={type === "text" ? 100 : undefined}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      )}
    </label>
  );
  const kind = editor.kind;
  const isNew = !editor.value.id;
  const preview =
    kind === "assignment" &&
    draft.start &&
    draft.end &&
    draft.personId &&
    Number(draft.hours) > 0 &&
    Number(draft.hours) <= 24 &&
    String(draft.end) >= String(draft.start) &&
    workingRange(String(draft.start), String(draft.end));
  const person = data.people.find((p) => p.id === draft.personId);
  const conflicts =
    preview && person
      ? dates(String(draft.start), preview).filter(
          (d) =>
            loadOn(
              data.assignments.filter((a) => a.id !== editor.value.id),
              String(draft.personId),
              d,
              false,
              person,
              data.calendars,
            ) +
              (baseCapacityOn(person, d, data.calendars)
                ? Number(draft.hours) * 60
                : 0) >
            availabilityOn(person, d, data).total,
        )
      : [];
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const base = {
        ...draft,
        id: editor.value.id ?? crypto.randomUUID(),
        orgId,
        version: (editor.value.version ?? 0) + 1,
      };
      let value:
        | Assignment
        | Person
        | Project
        | Organization
        | WorkingCalendar
        | Absence;
      if (kind === "assignment") {
        value = assignmentSchema.parse({
          ...base,
          dailyMinutes: Math.round(Number(draft.hours) * 60),
          version: ((editor.value as Assignment).version ?? 0) + 1,
        });
        if (
          !person ||
          !workingDays(value.start, value.end, person, data.calendars)
        )
          throw new Error("Include at least one working day.");
        const projectId = value.projectId;
        const project = data.projects.find((p) => p.id === projectId);
        if (project?.status === "complete")
          throw new Error("Choose an active project.");
      } else if (kind === "calendar") {
        value = calendarSchema.parse({
          ...base,
          weeklyMinutes: Array.from({ length: 7 }, (_, i) =>
            Math.round(Number(draft[`day${i}`]) * 60),
          ),
          version: ((editor.value as WorkingCalendar).version ?? 0) + 1,
        });
        if (
          data.calendars.some(
            (c) =>
              c.id !== value.id &&
              c.personId === draft.personId &&
              c.effectiveFrom === draft.effectiveFrom,
          )
        )
          throw new Error(
            "A calendar already starts on this date. Edit that calendar instead.",
          );
      } else if (kind === "absence") {
        value = absenceSchema.parse({
          ...base,
          personId: draft.category === "holiday" ? null : draft.personId,
          dailyMinutes:
            draft.category === "holiday" || draft.duration === "full"
              ? null
              : Math.round(Number(draft.hours) * 60),
          version: ((editor.value as Absence).version ?? 0) + 1,
        });
      } else if (kind === "person")
        value = personSchema.parse({
          ...base,
          dailyMinutes: Math.round(Number(draft.hours) * 60),
          costRate: canFinance ? Math.round(Number(draft.cost) * 100) : null,
        });
      else if (kind === "project")
        value = projectSchema.parse({
          ...base,
          budgetMinutes: Math.round(Number(draft.budget) * 60),
          billRate: canFinance ? Math.round(Number(draft.rate) * 100) : null,
        });
      else value = organizationSchema.parse({ ...base, currency: "USD" });
      onSave(kind, value);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.startsWith("[")
            ? "Check all fields. Use valid dates, positive hours, and a name."
            : e.message
          : "Please check your inputs.",
      );
    }
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="editor"
          onOpenAutoFocus={(event) => {
            if (titleInput.current) {
              event.preventDefault();
              titleInput.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus({ preventScroll: true });
            }
          }}
        >
          <header>
            <div className="composer-heading">
              {kind === "assignment" ||
              kind === "calendar" ||
              kind === "absence" ? (
                <CalendarDays size={16} />
              ) : kind === "person" ? (
                <Users size={16} />
              ) : kind === "project" ? (
                <FolderKanban size={16} />
              ) : (
                <Building2 size={16} />
              )}
              <Dialog.Title>
                {isNew ? "New" : "Edit"}{" "}
                {kind === "organization"
                  ? "workspace"
                  : kind === "assignment"
                    ? "allocation"
                    : kind === "calendar"
                      ? "working calendar"
                      : kind === "absence"
                        ? draft.category === "holiday"
                          ? "holiday"
                          : "time off"
                        : kind}
              </Dialog.Title>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close editor">
              <X size={18} />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            Edit details, then save to update your workspace.
          </Dialog.Description>
          <form
            onSubmit={submit}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.requestSubmit();
              }
            }}
          >
            {kind === "assignment" && (
              <>
                {field("title", "What will they work on?")}
                {field(
                  "projectId",
                  "Project",
                  "text",
                  data.projects
                    .filter((p) => p.orgId === orgId && p.status !== "complete")
                    .map((p) => ({ id: p.id, name: p.name })),
                )}
                {field(
                  "personId",
                  "Person",
                  "text",
                  data.people.filter((p) => p.orgId === orgId),
                )}
                <div className="field-row">
                  {field("start", "Start date", "date")}
                  {field("end", "End date", "date")}
                </div>
                <div className="field-row">
                  {field("hours", "Hours per workday", "number")}
                  {field("status", "Commitment", "text", [
                    { id: "confirmed", name: "Confirmed" },
                    { id: "tentative", name: "Tentative" },
                  ])}
                </div>
                <div className="form-note">
                  {preview
                    ? `${workingDays(String(draft.start), String(draft.end), person, data.calendars)} working days · ${workingDays(String(draft.start), String(draft.end), person, data.calendars) * Number(draft.hours)} hours planned`
                    : "Uses the person’s working calendar"}
                </div>
                {conflicts.length > 0 && draft.status === "confirmed" && (
                  <div className="warning">
                    <AlertTriangle size={18} />
                    <span>
                      This creates an overload on {conflicts.length}{" "}
                      {conflicts.length === 1 ? "day" : "days"}. You can save it
                      and rebalance the plan.
                    </span>
                  </div>
                )}
              </>
            )}
            {kind === "calendar" && (
              <>
                {field(
                  "personId",
                  "Person",
                  "text",
                  data.people.filter(
                    (p) =>
                      p.orgId === orgId &&
                      (isNew || p.id === editor.value.personId),
                  ),
                )}
                {field("effectiveFrom", "Effective from", "date")}
                <fieldset className="week-editor">
                  <legend>Hours by working day</legend>
                  {[
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                    "Sunday",
                  ].map((day, i) => (
                    <label key={day}>
                      <span>{day.slice(0, 3)}</span>
                      <input
                        aria-label={`${day} hours`}
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        required
                        value={draft[`day${i}`] ?? 0}
                        onChange={(e) =>
                          setDraft({ ...draft, [`day${i}`]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                </fieldset>
                <p className="form-note">
                  Zero hours means a non-working day. This calendar applies from
                  its effective date until the next calendar. Existing plans
                  recalculate for those dates. Deleting a calendar restores the
                  preceding workweek.
                </p>
              </>
            )}
            {kind === "absence" && (
              <>
                {field(
                  "title",
                  draft.category === "holiday"
                    ? "Holiday name"
                    : "Time off label",
                )}
                {draft.category !== "holiday" &&
                  field(
                    "personId",
                    "Person",
                    "text",
                    data.people.filter((p) => p.orgId === orgId),
                  )}
                <div className="field-row">
                  {field("start", "Start date", "date")}
                  {field("end", "End date", "date")}
                </div>
                {draft.category !== "holiday" && (
                  <div className="field-row">
                    {field("duration", "Duration", "text", [
                      { id: "full", name: "Full working day" },
                      { id: "partial", name: "Hours per day" },
                    ])}
                    {draft.duration === "partial" &&
                      field("hours", "Hours off per day", "number")}
                  </div>
                )}
                <p className="form-note">
                  {draft.category === "holiday"
                    ? "Everyone in this workspace is unavailable on these dates."
                    : "Time off reduces availability. Overlapping entries use the largest daily reduction."}{" "}
                  Planned work stays visible, with overload warnings where
                  needed.
                </p>
              </>
            )}
            {kind === "person" && (
              <>
                {field("name", "Full name")}
                {field("role", "Role")}
                {field("team", "Team")}
                <div className="field-row">
                  {field("hours", "Daily capacity (hours)", "number")}
                  {canFinance && field("cost", "Cost per hour (USD)", "number")}
                </div>
                <div className="form-note">
                  Baseline Monday–Friday capacity. Use Working calendar in
                  People to set date-specific hours and working days.
                </div>
              </>
            )}
            {kind === "project" && (
              <>
                {field("name", "Project name")}
                {field("client", "Client")}
                <div className="field-row">
                  {field("budget", "Budget (hours)", "number")}
                  {canFinance &&
                    field("rate", "Bill rate (USD/hour)", "number")}
                </div>
                {field("status", "Status", "text", [
                  { id: "confirmed", name: "Confirmed" },
                  { id: "tentative", name: "Tentative" },
                  { id: "complete", name: "Complete" },
                ])}
              </>
            )}
            {(kind === "project" || kind === "person") && (
              <fieldset className="color-picker">
                <legend>Color</legend>
                {colors.map((c) => (
                  <label
                    className={`color-option ${c} ${draft.color === c ? "selected" : ""}`}
                    key={c}
                  >
                    <input
                      aria-label={c}
                      type="radio"
                      name="color"
                      value={c}
                      checked={draft.color === c}
                      onChange={() => setDraft({ ...draft, color: c })}
                    />
                  </label>
                ))}
              </fieldset>
            )}
            {kind === "organization" && (
              <>
                {field("name", "Workspace name")}
                {field("timezone", "Time zone", "text", [
                  { id: "America/New_York", name: "New York · Eastern" },
                  { id: "America/Los_Angeles", name: "Los Angeles · Pacific" },
                  { id: "Europe/London", name: "London" },
                  { id: "Europe/Berlin", name: "Berlin" },
                  { id: "Asia/Kolkata", name: "Kolkata" },
                  { id: "Australia/Sydney", name: "Sydney" },
                  { id: "UTC", name: "UTC" },
                ])}
                <div className="form-note">
                  Currency: USD. New workspaces start with no people or
                  projects.
                </div>
              </>
            )}
            {(error || externalError) && (
              <p role="alert" className="error">
                {error || externalError}
              </p>
            )}
            <div className="editor-actions">
              {["assignment", "calendar", "absence"].includes(kind) &&
                !isNew && (
                  <button
                    className="delete-button"
                    type="button"
                    onClick={() =>
                      confirmDelete
                        ? onDelete(editor.value.id!)
                        : setConfirmDelete(true)
                    }
                    aria-label={
                      confirmDelete
                        ? `Confirm delete ${kind === "assignment" ? "allocation" : kind === "calendar" ? "working calendar" : "time off"}`
                        : `Delete ${kind === "assignment" ? "allocation" : kind === "calendar" ? "working calendar" : "time off"}`
                    }
                    title="Delete record"
                  >
                    <Trash2 size={15} />
                    {confirmDelete && "Confirm delete"}
                  </button>
                )}
              <div className="composer-submit">
                <Dialog.Close className="button" type="button">
                  Cancel
                </Dialog.Close>
                <button className="primary" type="submit">
                  {isNew
                    ? kind === "assignment"
                      ? "Plan work"
                      : kind === "absence"
                        ? draft.category === "holiday"
                          ? "Add holiday"
                          : "Add time off"
                        : `Create ${kind === "organization" ? "workspace" : kind}`
                    : "Save changes"}
                  <kbd>⌘ ↵</kbd>
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function workingRange(start: string, end: string) {
  const n = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  return n > 0 && n <= 367 ? n : 0;
}
export function editAssignment(value: Assignment): EditorState {
  return {
    kind: "assignment",
    value: { ...value, ...{ hours: value.dailyMinutes / 60 } },
  };
}
export function newAssignment(
  orgId: string,
  start: string,
  personId?: string,
  projectId?: string,
  end?: string,
): EditorState {
  return {
    kind: "assignment",
    value: {
      orgId,
      start,
      end: end ?? addDays(start, 4),
      personId,
      projectId,
      status: "confirmed",
      ...{ hours: 4 },
    },
  };
}

export function editCalendar(
  person: Person,
  date: string,
  data: WorkspaceData,
  value?: WorkingCalendar,
): EditorState {
  const minutes =
    value?.weeklyMinutes ?? weeklyMinutes(person, date, data.calendars);
  return {
    kind: "calendar",
    value: {
      ...value,
      personId: person.id,
      orgId: person.orgId,
      effectiveFrom: value?.effectiveFrom ?? date,
      ...Object.fromEntries(minutes.map((m, i) => [`day${i}`, m / 60])),
    },
  };
}
export function editAbsence(value: Partial<Absence>): EditorState {
  return {
    kind: "absence",
    value: {
      ...value,
      ...{
        duration: value.dailyMinutes == null ? "full" : "partial",
        hours: (value.dailyMinutes ?? 240) / 60,
      },
    },
  };
}
