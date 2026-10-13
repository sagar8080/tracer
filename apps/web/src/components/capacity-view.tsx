"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  Plus,
  X,
} from "lucide-react";
import type {
  Absence,
  Assignment,
  Person,
  Project,
  WorkingCalendar,
  WorkspaceData,
} from "@/lib/model";
import {
  addDays,
  capacity,
  dates,
  hours,
  weeklyMinutes,
} from "@/lib/scheduling";

const shortDate = (date: string) =>
  new Date(date + "T12:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
export default function CapacityView({
  canPlan = true,
  canAdminister = true,
  people,
  assignments,
  projects,
  data,
  orgId,
  start,
  onCalendar,
  onAbsence,
  onNewAbsence,
  onPlan,
  onAssignment,
}: {
  canPlan?: boolean;
  canAdminister?: boolean;
  people: Person[];
  assignments: Assignment[];
  projects: Project[];
  data: WorkspaceData;
  orgId: string;
  start: string;
  onCalendar: (p: Person, calendar?: WorkingCalendar) => void;
  onAbsence: (a: Absence) => void;
  onNewAbsence: (
    personId?: string,
    date?: string,
    category?: Absence["category"],
  ) => void;
  onPlan: (p: Person, date: string) => void;
  onAssignment: (a: Assignment) => void;
}) {
  const [selected, setSelected] = useState<{
    personId: string;
    date: string;
  } | null>(null);
  const detail = useRef<HTMLElement>(null);
  const dayTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) detail.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const [tab, setTab] = useState<"availability" | "timeOff" | "calendars">(
    "availability",
  );
  const ds = dates(start, 14);
  const end = addDays(start, 13);
  const rows = useMemo(
    () =>
      people.map((person) => ({
        person,
        ...capacity(person, assignments, start, 14, data),
      })),
    [people, assignments, start, data],
  );
  const selectedPerson = people.find((p) => p.id === selected?.personId);
  const day = rows
    .find((r) => r.person.id === selected?.personId)
    ?.days.find((d) => d.date === selected?.date);
  const visibleAbsences = data.absences
    .filter(
      (a) =>
        a.orgId === orgId &&
        (a.personId === null || people.some((p) => p.id === a.personId)) &&
        a.start <= end &&
        a.end >= start,
    )
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) || a.title.localeCompare(b.title),
    );
  const totals = rows.reduce(
    (s, r) => ({
      available: s.available + r.available,
      removed: s.removed + r.removed,
      overload: s.overload + r.overload,
    }),
    { available: 0, removed: 0, overload: 0 },
  );
  return (
    <div className="capacity-workspace">
      <div className="capacity-tabs" role="tablist" aria-label="Capacity views">
        {(
          [
            ["availability", "Availability"],
            ["timeOff", "Time off & holidays"],
            ["calendars", "Working calendars"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`capacity-tab-${id}`}
            aria-controls="capacity-panel"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const ids = ["availability", "timeOff", "calendars"] as const;
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? 2
                    : (ids.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3;
              setTab(ids[next]);
              document.getElementById(`capacity-tab-${ids[next]}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
        <button
          className="text-button capacity-add"
          disabled={!canPlan}
          onClick={() => onNewAbsence(people[0]?.id, start)}
        >
          <Plus size={14} />
          Time off
        </button>
      </div>
      <div
        id="capacity-panel"
        role="tabpanel"
        aria-labelledby={`capacity-tab-${tab}`}
      >
        {tab === "availability" && (
          <>
            <div className="capacity-intro">
              <div>
                <h2>Daily availability</h2>
                <p>
                  {shortDate(start)} – {shortDate(end)} · Select a day to see
                  its plan.
                </p>
              </div>
              <div className="capacity-facts">
                <span>
                  <strong>{hours(totals.available)}h</strong> available
                </span>
                <span>{hours(totals.removed)}h away</span>
                {totals.overload > 0 && (
                  <span className="over">
                    <AlertTriangle size={13} />
                    {hours(totals.overload)}h over capacity
                  </span>
                )}
              </div>
            </div>
            <div className="capacity-grid-scroll">
              <div className="capacity-grid">
                <div className="capacity-grid-head">
                  <span>Person / net capacity</span>
                  {ds.map((d) => (
                    <span key={d}>
                      <small>
                        {new Date(d + "T12:00Z").toLocaleDateString("en-US", {
                          weekday: "short",
                          timeZone: "UTC",
                        })}
                      </small>
                      {Number(d.slice(-2))}
                    </span>
                  ))}
                  <span>Available</span>
                </div>
                {rows.map((row) => (
                  <div className="capacity-grid-row" key={row.person.id}>
                    <button
                      className="capacity-name"
                      onClick={() => {
                        setTab("calendars");
                      }}
                    >
                      <span className={`avatar ${row.person.color}`}>
                        {row.person.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </span>
                      <span>
                        <strong>{row.person.name}</strong>
                        <small>
                          {hours(row.planned)}h planned / {hours(row.total)}h
                          capacity
                        </small>
                      </span>
                    </button>
                    {row.days.map((d) => (
                      <button
                        key={d.date}
                        className={`capacity-day ${d.overload ? "overloaded" : d.removed ? "away" : !d.base ? "off-day" : d.available === 0 ? "full" : "open"} ${selected?.personId === row.person.id && selected.date === d.date ? "selected" : ""}`}
                        aria-pressed={
                          selected?.personId === row.person.id &&
                          selected.date === d.date
                        }
                        aria-label={`${row.person.name}, ${d.date}: ${hours(d.planned)} hours planned, ${hours(d.total)} hours capacity${d.overload ? `, ${hours(d.overload)} hours over capacity` : ""}`}
                        aria-controls="daily-capacity-breakdown"
                        onClick={(event) => {
                          dayTrigger.current = event.currentTarget;
                          setSelected({
                            personId: row.person.id,
                            date: d.date,
                          });
                        }}
                      >
                        <span>
                          {d.overload
                            ? `+${hours(d.overload)}`
                            : d.base
                              ? hours(d.available)
                              : "—"}
                        </span>
                        <small>
                          {d.overload
                            ? "over"
                            : d.removed
                              ? "away"
                              : !d.base
                                ? "off"
                                : "free"}
                        </small>
                      </button>
                    ))}
                    <strong className="capacity-row-total">
                      {hours(row.available)}h
                    </strong>
                  </div>
                ))}
                {!rows.length && (
                  <p className="empty-state">
                    No people match this view. Add a person or clear the
                    filters.
                  </p>
                )}
              </div>
            </div>
            {selectedPerson && day && (
              <section
                ref={detail}
                id="daily-capacity-breakdown"
                className="capacity-detail"
                aria-label="Daily capacity breakdown"
              >
                <div className="capacity-detail-heading">
                  <div>
                    <h3>
                      {selectedPerson.name} <span>· {shortDate(day.date)}</span>
                    </h3>
                    <p>
                      {hours(day.base)}h working day − {hours(day.removed)}h
                      away = {hours(day.total)}h capacity
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Close daily breakdown"
                    onClick={() => {
                      setSelected(null);
                      dayTrigger.current?.focus({ preventScroll: true });
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
                {day.absences.map((a) => (
                  <button
                    className="capacity-detail-item"
                    disabled={
                      a.category === "holiday" ? !canAdminister : !canPlan
                    }
                    onClick={() => onAbsence(a)}
                    key={a.id}
                  >
                    <CalendarDays size={14} />
                    <span>{a.title}</span>
                    <small>
                      {a.dailyMinutes === null
                        ? "Full day"
                        : `${hours(a.dailyMinutes)}h off`}
                    </small>
                  </button>
                ))}
                {assignments
                  .filter(
                    (a) =>
                      a.personId === selectedPerson.id &&
                      a.start <= day.date &&
                      a.end >= day.date,
                  )
                  .map((a) => (
                    <button
                      className="capacity-detail-item"
                      key={a.id}
                      disabled={!canPlan}
                      onClick={() => onAssignment(a)}
                    >
                      <i
                        className={`project-dot ${projects.find((p) => p.id === a.projectId)?.color ?? "sage"}`}
                      />
                      <span>
                        {a.title}
                        <small>
                          {projects.find((p) => p.id === a.projectId)?.name}
                        </small>
                      </span>
                      <small>
                        {day.base
                          ? `${hours(a.dailyMinutes)}h`
                          : "Non-working day"}
                        {a.status === "tentative" ? " · Tentative" : ""}
                      </small>
                    </button>
                  ))}
                <div className="capacity-detail-footer">
                  <span className={day.overload ? "over" : ""}>
                    {hours(day.planned)}h committed ·{" "}
                    {day.overload
                      ? `${hours(day.overload)}h over capacity`
                      : `${hours(day.available)}h available`}
                    {day.tentative > 0
                      ? ` · ${hours(day.tentative)}h tentative`
                      : ""}
                  </span>
                  <div>
                    <button
                      className="button"
                      disabled={!canPlan}
                      onClick={() => onNewAbsence(selectedPerson.id, day.date)}
                    >
                      Add time off
                    </button>
                    <button
                      className="button"
                      disabled={!canPlan}
                      onClick={() => onPlan(selectedPerson, day.date)}
                    >
                      Plan work
                    </button>
                  </div>
                </div>
              </section>
            )}
            <p className="capacity-legend">
              Hours available per day. Amber shows overload; hatched days
              include time off. Tentative work is excluded. Overlapping time off
              uses the largest daily reduction.
            </p>
          </>
        )}
        {tab === "timeOff" && (
          <div className="capacity-register">
            <div className="capacity-intro">
              <div>
                <h2>Time off &amp; holidays</h2>
                <p>
                  {shortDate(start)} – {shortDate(end)} · Existing allocations
                  remain visible.
                </p>
              </div>
              <button
                className="button"
                disabled={!canAdminister}
                onClick={() => onNewAbsence(undefined, start, "holiday")}
              >
                <Plus size={14} />
                Workspace holiday
              </button>
            </div>
            {visibleAbsences.map((a) => (
              <button
                className="absence-row"
                key={a.id}
                disabled={a.category === "holiday" ? !canAdminister : !canPlan}
                onClick={() => onAbsence(a)}
              >
                <CalendarDays size={16} />
                <span>
                  <strong>{a.title}</strong>
                  <small>
                    {a.category === "holiday"
                      ? "Everyone · Holiday"
                      : people.find((p) => p.id === a.personId)?.name}
                  </small>
                </span>
                <span>
                  {shortDate(a.start)}
                  {a.end !== a.start ? ` – ${shortDate(a.end)}` : ""}
                </span>
                <small>
                  {a.dailyMinutes === null
                    ? "Full day"
                    : `${hours(a.dailyMinutes)}h / day`}
                </small>
              </button>
            ))}
            {!visibleAbsences.length && (
              <div className="empty-state">
                <CalendarDays size={24} />
                <h2>No time away in this period</h2>
                <p>Add time off for a person or a holiday for everyone.</p>
                <button
                  className="button"
                  disabled={!canPlan}
                  onClick={() => onNewAbsence(people[0]?.id, start)}
                >
                  Add time off
                </button>
              </div>
            )}
          </div>
        )}
        {tab === "calendars" && (
          <div className="capacity-register">
            <div className="capacity-intro">
              <div>
                <h2>Working calendars</h2>
                <p>
                  Calendars are effective-dated. Earlier dates keep their
                  previous workweek.
                </p>
              </div>
            </div>
            {people.map((p) => {
              const calendars = data.calendars
                .filter((c) => c.personId === p.id && c.orgId === orgId)
                .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
              const week = weeklyMinutes(p, start, calendars);
              return (
                <details className="calendar-person" key={p.id}>
                  <summary>
                    <span className={`avatar ${p.color}`}>
                      {p.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {hours(week.reduce((s, m) => s + m, 0))}h / week at{" "}
                        {shortDate(start)}
                      </small>
                    </span>
                    <span className="mini-week">
                      {week.map((m, i) => (
                        <span className={m ? "" : "muted"} key={i}>
                          {["M", "T", "W", "T", "F", "S", "S"][i]}
                          <small>{hours(m)}</small>
                        </span>
                      ))}
                    </span>
                    <ChevronDown size={14} />
                  </summary>
                  <div className="calendar-history">
                    <p>
                      Baseline · {hours(p.dailyMinutes)}h per day, Monday–Friday
                    </p>
                    {calendars.map((c) => (
                      <button
                        key={c.id}
                        className="capacity-detail-item"
                        disabled={!canAdminister}
                        onClick={() => onCalendar(p, c)}
                      >
                        <CalendarDays size={14} />
                        <span>
                          From {shortDate(c.effectiveFrom)},{" "}
                          {c.effectiveFrom.slice(0, 4)}
                        </span>
                        <small>
                          {hours(c.weeklyMinutes.reduce((s, m) => s + m, 0))}h /
                          week · Edit
                        </small>
                      </button>
                    ))}
                    <button
                      className="text-button"
                      disabled={!canAdminister}
                      onClick={() => onCalendar(p)}
                    >
                      <Plus size={14} />
                      Schedule a calendar change
                    </button>
                  </div>
                </details>
              );
            })}
            {!people.length && (
              <p className="empty-state">
                Add people to set their working calendars.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
