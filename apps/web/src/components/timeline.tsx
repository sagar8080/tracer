"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, AlertTriangle, GripVertical } from "lucide-react";
import type {
  Assignment,
  Person,
  Project,
  CalendarData,
  Absence,
} from "@/lib/model";
import {
  addDays,
  capacity,
  availabilityOn,
  dates,
  dayDiff,
  hours,
  lanes,
  loadOn,
  moveAssignment,
  weekday,
} from "@/lib/scheduling";
export default function Timeline({
  readOnly = false,
  canAdminister = true,
  people,
  projects,
  assignments,
  calendar,
  onAbsence,
  start,
  today,
  onEdit,
  onCreate,
  onMove,
  onPerson,
}: {
  readOnly?: boolean;
  canAdminister?: boolean;
  people: Person[];
  projects: Project[];
  assignments: Assignment[];
  calendar: CalendarData;
  onAbsence: (a: Absence) => void;
  start: string;
  today: string;
  onEdit: (a: Assignment) => void;
  onCreate: (personId: string, date: string, end?: string) => void;
  onMove: (a: Assignment) => void;
  onPerson: (p: Person) => void;
}) {
  const days = dates(start, 14);
  const [scrollTop, setScrollTop] = useState(0);
  const [drag, setDrag] = useState<{
    id: string;
    delta: number;
    resize: boolean;
    x: number;
    y: number;
    personId: string;
  } | null>(null);
  const [range, setRange] = useState<{
    personId: string;
    from: number;
    to: number;
  } | null>(null);
  const gestureCleanup = useRef<(() => void) | null>(null);
  const rangeMoved = useRef(false);
  useEffect(() => () => gestureCleanup.current?.(), []);
  const moved = useRef(false);
  const rows = useMemo(() => {
    let offset = 0;
    return people.map((person) => {
      const items = lanes(
        assignments.filter(
          (a) =>
            a.personId === person.id &&
            a.end >= start &&
            a.start <= addDays(start, 13),
        ),
      );
      const height = Math.max(
        88,
        Math.max(0, ...items.map((i) => i.lane + 1)) * 40 + 40,
      );
      const row = { person, items, offset, height };
      offset += height;
      return row;
    });
  }, [people, assignments, start]);
  const totalHeight = rows.length
    ? rows[rows.length - 1].offset + rows[rows.length - 1].height
    : 180;
  function beginRange(
    e: React.PointerEvent<HTMLButtonElement>,
    personId: string,
    index: number,
  ) {
    if (readOnly) return;
    rangeMoved.current = false;
    if (e.button !== 0 || e.pointerType === "touch") return;
    gestureCleanup.current?.();
    const el = e.currentTarget;
    const rect = el.closest(".schedule-grid")!.getBoundingClientRect();
    const origin = e.clientX;
    let last = index;
    rangeMoved.current = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      last = Math.max(
        0,
        Math.min(13, Math.floor((ev.clientX - rect.left) / (rect.width / 14))),
      );
      if (Math.abs(ev.clientX - origin) > 4) rangeMoved.current = true;
      if (rangeMoved.current)
        setRange({
          personId,
          from: Math.min(index, last),
          to: Math.max(index, last),
        });
    };
    const cleanup = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      if (el.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
      gestureCleanup.current = null;
    };
    const stop = () => {
      cleanup();
      setRange(null);
      if (rangeMoved.current)
        onCreate(
          personId,
          days[Math.min(index, last)],
          days[Math.max(index, last)],
        );
    };
    const cancel = () => {
      cleanup();
      setRange(null);
      rangeMoved.current = true;
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    gestureCleanup.current = cleanup;
  }
  function pointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    a: Assignment,
    resize = false,
  ) {
    if (readOnly || e.button !== 0) return;
    gestureCleanup.current?.();
    const el = e.currentTarget;
    const grid = el.closest(".schedule-grid") as HTMLElement;
    const origin = { x: e.clientX, y: e.clientY };
    const width = grid.getBoundingClientRect().width / 14;
    let targetPerson = a.personId;
    moved.current = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - origin.x;
      const y = ev.clientY - origin.y;
      const delta = Math.round(x / width);
      if (Math.abs(x) > 4 || Math.abs(y) > 4) moved.current = true;
      const row = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>("[data-person]");
      if (row) targetPerson = row.dataset.person!;
      if (moved.current)
        setDrag({ id: a.id, delta, resize, x, y, personId: targetPerson });
    };
    const cleanup = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      if (el.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
      gestureCleanup.current = null;
    };
    const stop = (ev: PointerEvent) => {
      cleanup();
      setDrag(null);
      if (!moved.current) return;
      const delta = Math.round((ev.clientX - origin.x) / width);
      const row = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>("[data-person]");
      if (resize) {
        const end = addDays(a.end, delta);
        if (end >= a.start && dayDiff(end, a.start) <= 366 && end !== a.end)
          onMove({ ...a, end, version: a.version + 1 });
      } else if (row) {
        const personId = row.dataset.person!;
        if (delta || personId !== a.personId)
          onMove(moveAssignment(a, delta, personId));
      }
    };
    const cancel = () => {
      cleanup();
      setDrag(null);
      moved.current = true;
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    gestureCleanup.current = cleanup;
  }
  return (
    <div
      className="timeline-scroll"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="timeline-inner">
        <div className="timeline-header">
          <div className="person-header">
            People <span>{people.length}</span>
            <span className="capacity-label">Load</span>
          </div>
          <div className="day-headers">
            {days.map((d) => (
              <div
                key={d}
                className={`day-heading ${!weekday(d) ? "weekend" : ""} ${d === today ? "today" : ""}`}
              >
                <span>
                  {new Date(d + "T12:00Z").toLocaleDateString("en-US", {
                    weekday: "short",
                    timeZone: "UTC",
                  })}
                </span>
                <strong>{Number(d.slice(-2))}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="timeline-body" style={{ height: totalHeight }}>
          {rows
            .filter(
              (r) =>
                r.offset + r.height > scrollTop - 300 &&
                r.offset < scrollTop + 1200,
            )
            .map(({ person, items, offset, height }) => {
              const c = capacity(person, assignments, start, 14, calendar);
              return (
                <div
                  className={`timeline-row ${drag?.personId === person.id && !drag.resize ? "drop-target" : ""}`}
                  data-person={person.id}
                  key={person.id}
                  style={{ height, top: offset }}
                >
                  <button
                    className="person-cell"
                    disabled={!canAdminister}
                    onClick={() => onPerson(person)}
                  >
                    <span className={`avatar ${person.color}`}>
                      {person.name
                        .split(" ")
                        .map((s) => s[0])
                        .join("")}
                    </span>
                    <span className="person-text">
                      <strong>{person.name}</strong>
                      <small>{person.role}</small>
                    </span>
                    <span
                      className={`utilization ${c.conflictDays.length ? "over" : ""}`}
                      title={`${hours(c.planned)}h planned / ${hours(c.total)}h capacity`}
                    >
                      {c.conflictDays.length > 0 && <AlertTriangle size={11} />}{" "}
                      {c.utilization === null ? "—" : `${c.utilization}%`}
                    </span>
                  </button>
                  <div className="schedule-grid">
                    <div className="day-cells">
                      {days.map((d, dayIndex) => {
                        const load = loadOn(
                          assignments,
                          person.id,
                          d,
                          false,
                          person,
                          calendar.calendars,
                        );
                        const availability = availabilityOn(
                          person,
                          d,
                          calendar,
                        );
                        const over = load > availability.total;
                        return (
                          <button
                            key={d}
                            className={`day-cell ${!availability.base ? "weekend" : ""} ${availability.removed ? "unavailable" : ""} ${d === today ? "today" : ""} ${over ? "overloaded" : ""}`}
                            title={`${person.name} · ${d} · ${hours(load)}h of ${hours(availability.total)}h capacity${availability.absences.length ? " · " + availability.absences.map((a) => a.title).join(", ") : ""}`}
                            aria-label={`Add allocation for ${person.name} on ${d}`}
                            disabled={readOnly}
                            onPointerDown={(e) =>
                              beginRange(e, person.id, dayIndex)
                            }
                            onClick={(e) => {
                              if (!rangeMoved.current || e.detail === 0)
                                onCreate(person.id, d, d);
                              rangeMoved.current = false;
                            }}
                          >
                            {(availability.base > 0 || load > 0) && (
                              <span
                                className={`day-load ${over ? "over" : ""}`}
                              >
                                {over ? (
                                  `+${hours(load - availability.total)}h`
                                ) : load ? (
                                  `${hours(load)}h`
                                ) : (
                                  <Plus size={12} />
                                )}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="absence-days">
                      {days.map((d) => {
                        const available = availabilityOn(person, d, calendar);
                        const absence = available.absences[0];
                        return (
                          <div key={d}>
                            {absence && available.base > 0 && (
                              <button
                                aria-label={`Edit ${absence.title} for ${person.name} on ${d}`}
                                title={`${absence.title} · ${hours(available.removed)}h unavailable`}
                                disabled={
                                  absence.category === "holiday"
                                    ? !canAdminister
                                    : readOnly
                                }
                                onClick={() => onAbsence(absence)}
                              >
                                {absence.category === "holiday"
                                  ? "Holiday"
                                  : `${hours(available.removed)}h off`}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {range?.personId === person.id && (
                      <div
                        className="range-preview"
                        style={{
                          left: `calc(${(range.from / 14) * 100}% + 4px)`,
                          width: `calc(${((range.to - range.from + 1) / 14) * 100}% - 8px)`,
                        }}
                      >
                        <Plus size={12} />
                        <span>Plan work</span>
                      </div>
                    )}
                    {items.map(({ assignment: a, lane }) => {
                      const p = projects.find((p) => p.id === a.projectId);
                      if (!p) return null;
                      const left = Math.max(0, dayDiff(a.start, start));
                      const right = Math.min(13, dayDiff(a.end, start));
                      const active = drag?.id === a.id;

                      return (
                        <div
                          className={`allocation ${p.color} ${a.status === "tentative" ? "tentative" : ""} ${active ? "dragging" : ""}`}
                          key={a.id}
                          style={{
                            left: `calc(${(left / 14) * 100}% + 4px)`,
                            width:
                              active && drag.resize
                                ? `max(22px, calc(${((right - left + 1) / 14) * 100}% - 8px + ${drag.x}px))`
                                : `calc(${((right - left + 1) / 14) * 100}% - 8px)`,
                            transform:
                              active && !drag.resize
                                ? `translate3d(${drag.x}px, ${drag.y}px, 0)`
                                : undefined,
                            top: 20 + lane * 40,
                          }}
                        >
                          <button
                            className="allocation-main"
                            disabled={readOnly}
                            title={`${p.name} · ${a.title} · ${hours(a.dailyMinutes)}h/day. Drag to move, or press Alt + Left/Right. Enter to edit.`}
                            onPointerDown={(e) => pointerDown(e, a)}
                            onClick={() => {
                              if (!moved.current) onEdit(a);
                              moved.current = false;
                            }}
                            onKeyDown={(e) => {
                              if (
                                e.altKey &&
                                (e.key === "ArrowLeft" ||
                                  e.key === "ArrowRight")
                              ) {
                                e.preventDefault();
                                onMove(
                                  moveAssignment(
                                    a,
                                    e.key === "ArrowLeft" ? -1 : 1,
                                  ),
                                );
                              }
                            }}
                          >
                            <span className="allocation-dot" />
                            <strong>{p.name}</strong>
                            <span className="allocation-title">{a.title}</span>
                            <small>{hours(a.dailyMinutes)}h</small>
                          </button>
                          <button
                            className="resize-handle"
                            hidden={readOnly}
                            disabled={readOnly}
                            aria-label={`Resize ${a.title}`}
                            title="Drag to resize; Enter to edit dates"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              pointerDown(e, a, true);
                            }}
                            onClick={() => {
                              if (!moved.current) onEdit(a);
                              moved.current = false;
                            }}
                          >
                            <GripVertical size={11} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          {!people.length && (
            <div className="empty-timeline">
              No people match this view. Add a person or clear your filters.
            </div>
          )}
        </div>
        <div className="timeline-totals">
          <div>
            Team availability <small>Confirmed work only</small>
          </div>
          <div className="total-days">
            {days.map((d) => {
              const available = people.reduce(
                (s, p) =>
                  s +
                  Math.max(
                    0,
                    availabilityOn(p, d, calendar).total -
                      loadOn(
                        assignments,
                        p.id,
                        d,
                        false,
                        p,
                        calendar.calendars,
                      ),
                  ),
                0,
              );
              return (
                <span key={d} className={!weekday(d) ? "weekend" : ""}>
                  {`${hours(available)}h`}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
