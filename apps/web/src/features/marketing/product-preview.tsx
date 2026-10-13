"use client";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Layers3,
  BarChart3,
  ChevronDown,
  X,
  ArrowRight,
  Sun,
  CircleAlert,
  Pause,
  Play,
} from "lucide-react";
import { hours, dayDiff, lanes } from "@/lib/scheduling";
import {
  people,
  projects,
  assignments,
  week,
  weekStart,
  loads,
  totals,
  actualMinutes,
} from "./sample";
import { Wordmark } from "./header";
import { useScenePlayback } from "./use-scene-playback";
import s from "./landing.module.css";

const views = [
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "capacity", label: "Capacity", icon: Layers3 },
  { id: "actuals", label: "Actuals", icon: BarChart3 },
] as const;
export function ProductPreview() {
  const player = useScenePlayback(views.length);
  const view = views[player.index].id;
  const [selected, setSelected] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const detail = assignments.find((a) => a.id === selected);
  useEffect(() => {
    if (selected) closeButton.current?.focus({ preventScroll: true });
  }, [selected]);
  const closeDetail = () => {
    setSelected(null);
    trigger.current?.focus({ preventScroll: true });
  };
  return (
    <figure className={s.previewFigure}>
      <div
        className={s.preview}
        ref={player.rootRef}
        data-view={view}
        data-reveal
        onPointerDown={player.stop}
      >
        <aside className={s.previewSidebar}>
          <div className={s.previewBrand}>
            <Wordmark />
            <ChevronDown size={12} />
          </div>
          <span className={s.studioLabel}>Studio workspace</span>
          <div
            className={s.previewTabs}
            role="tablist"
            aria-label="Product preview"
            aria-orientation="vertical"
            onFocusCapture={player.stop}
          >
            {views.map(({ id, label, icon: Icon }, index) => (
              <button
                key={id}
                role="tab"
                id={`preview-tab-${id}`}
                aria-controls="preview-panel"
                aria-selected={view === id}
                tabIndex={view === id ? 0 : -1}
                ref={(el) => {
                  tabs.current[index] = el;
                }}
                onClick={() => {
                  player.select(index);
                  setSelected(null);
                }}
                onKeyDown={(e) => {
                  let next = index;
                  if (["ArrowDown", "ArrowRight"].includes(e.key))
                    next = (index + 1) % views.length;
                  else if (["ArrowUp", "ArrowLeft"].includes(e.key))
                    next = (index + views.length - 1) % views.length;
                  else if (e.key === "Home") next = 0;
                  else if (e.key === "End") next = views.length - 1;
                  else return;
                  e.preventDefault();
                  player.select(next);
                  setSelected(null);
                  tabs.current[next]?.focus();
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <div className={s.previewProjects}>
            <span>Projects</span>
            {projects.slice(0, 3).map((p) => (
              <div key={p.id}>
                <i className={s[p.color]} />
                {p.name}
              </div>
            ))}
          </div>
          <span className={s.sampleBadge}>
            <i />
            Illustrative workspace
          </span>
        </aside>
        <div className={s.previewMain}>
          <div className={s.previewHeading}>
            <span>{views.find((v) => v.id === view)?.label}</span>
            <span>
              Studio <span aria-hidden="true">/</span> October 2026
            </span>
          </div>
          <div className={s.previewToolbar}>
            <span>
              <CalendarDays size={14} /> October 19 – 23
            </span>
            <span>
              {view === "schedule"
                ? "Select an allocation to inspect"
                : "A clear view of the working week"}
            </span>
          </div>
          <div
            className={s.previewScroll}
            key={view}
            id="preview-panel"
            role="tabpanel"
            aria-labelledby={`preview-tab-${view}`}
            tabIndex={0}
            onFocusCapture={player.stop}
          >
            {view === "schedule" ? (
              <div className={s.sampleSchedule}>
                <div className={s.scheduleLabels}>
                  <span>
                    People <small>{people.length}</small>
                  </span>
                  <div>
                    {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, i) => (
                      <span key={day}>
                        {day}
                        <b>{19 + i}</b>
                      </span>
                    ))}
                  </div>
                </div>
                {people.map((p, pi) => (
                  <div className={s.samplePersonRow} key={p.id}>
                    <div className={s.personLabel}>
                      <span className={`${s.avatar} ${s[p.color]}`}>
                        {p.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.role}</small>
                      </span>
                    </div>
                    <div className={s.allocationGrid}>
                      {week.map((day, i) => (
                        <span
                          className={s.dayLine}
                          key={day}
                          style={{ left: `${i * 20}%`, width: "20%" }}
                        />
                      ))}
                      {lanes(
                        assignments.filter((a) => a.personId === p.id),
                      ).map(({ assignment: a, lane }) => {
                        const project = projects.find(
                          (pr) => pr.id === a.projectId,
                        )!;
                        return (
                          <button
                            key={a.id}
                            className={`${s.allocation} ${s[project.color]}`}
                            style={{
                              gridColumn: `${dayDiff(a.start, weekStart) + 1} / ${dayDiff(a.end, weekStart) + 2}`,
                              gridRow: lane + 1,
                            }}
                            aria-label={`${a.title}, ${p.name}, ${hours(a.dailyMinutes)} hours per day. Inspect allocation`}
                            aria-expanded={selected === a.id}
                            aria-controls="sample-allocation-detail"
                            onClick={(event) => {
                              player.stop();
                              trigger.current = event.currentTarget;
                              setSelected(selected === a.id ? null : a.id);
                            }}
                          >
                            <span>{project.name}</span>
                            <small>
                              {a.title} <span>· {hours(a.dailyMinutes)}h</span>
                            </small>
                          </button>
                        );
                      })}
                      {pi === 2 && (
                        <div
                          className={s.timeOff}
                          style={{ gridColumn: "4 / 6", gridRow: 1 }}
                        >
                          <Sun size={12} /> Time off
                        </div>
                      )}
                      {loads[pi].overload > 0 && (
                        <span
                          className={s.overloadLabel}
                          style={{ gridColumn: "4 / 6", gridRow: 3 }}
                        >
                          <CircleAlert size={11} />
                          1h over each day
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : view === "capacity" ? (
              <table className={s.capacityTable}>
                <caption className={s.srOnly}>
                  Sample daily planned hours and available capacity
                </caption>
                <thead>
                  <tr>
                    <th>People</th>
                    {["Mon 19", "Tue 20", "Wed 21", "Thu 22", "Fri 23"].map(
                      (d) => (
                        <th key={d}>{d}</th>
                      ),
                    )}
                    <th>Week</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p, i) => (
                    <tr key={p.id}>
                      <th>
                        {p.name}
                        <small>{p.role}</small>
                      </th>
                      {loads[i].days.map((d) => (
                        <td
                          key={d.date}
                          className={d.overload ? s.capacityWarning : ""}
                        >
                          <strong>
                            {hours(d.planned)}h <span>/ {hours(d.total)}h</span>
                          </strong>
                          <div className={s.loadTrack}>
                            <span
                              style={{
                                width: `${d.total ? Math.min(100, (d.planned / d.total) * 100) : 0}%`,
                              }}
                            />
                          </div>
                          {d.overload ? (
                            <small>{hours(d.overload)}h over</small>
                          ) : d.total === 0 ? (
                            <small>Time off</small>
                          ) : (
                            <small>{hours(d.available)}h available</small>
                          )}
                        </td>
                      ))}
                      <td>{loads[i].utilization}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={s.actualsView}>
                <div className={s.actualsIntro}>
                  <span>Planned vs. recorded</span>
                  <small>See how the week actually went.</small>
                </div>
                <table className={s.actualsTable}>
                  <caption className={s.srOnly}>
                    Sample planned and recorded hours for each person
                  </caption>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Planned</th>
                      <th>Recorded</th>
                      <th>Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p, i) => (
                      <tr key={p.id}>
                        <th>
                          <span className={s.actualsPerson}>
                            <span className={`${s.avatar} ${s[p.color]}`}>
                              {p.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </span>
                            {p.name}
                          </span>
                        </th>
                        <td>{hours(loads[i].planned)}h</td>
                        <td>{hours(actualMinutes[i])}h</td>
                        <td>
                          {actualMinutes[i] >= loads[i].planned ? "+" : ""}
                          {hours(actualMinutes[i] - loads[i].planned)}h
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Recorded hours are shown separately from approved timesheets.
                </p>
              </div>
            )}
          </div>
          <div className={s.previewFooter}>
            <span>
              <b>{Math.round((totals.planned / totals.capacity) * 100)}%</b>{" "}
              planned
            </span>
            <span>
              <b>{hours(totals.available)}h</b> available
            </span>
            <span className={s.previewConflict}>
              <CircleAlert size={12} />
              {hours(totals.overload)}h of overload
            </span>
          </div>
          {detail && (
            <div
              className={s.allocationDetail}
              id="sample-allocation-detail"
              role="region"
              aria-label="Sample allocation details"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeDetail();
                }
              }}
            >
              <div>
                <span>Allocation details</span>
                <button
                  aria-label="Close allocation details"
                  ref={closeButton}
                  onClick={closeDetail}
                >
                  <X size={15} />
                </button>
              </div>
              <h3>{detail.title}</h3>
              <p>{projects.find((p) => p.id === detail.projectId)?.name}</p>
              <dl>
                <div>
                  <dt>Person</dt>
                  <dd>{people.find((p) => p.id === detail.personId)?.name}</dd>
                </div>
                <div>
                  <dt>Dates</dt>
                  <dd>
                    Oct {19 + dayDiff(detail.start, weekStart)} –{" "}
                    {19 + dayDiff(detail.end, weekStart)}
                  </dd>
                </div>
                <div>
                  <dt>Daily effort</dt>
                  <dd>{hours(detail.dailyMinutes)} hours</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>Confirmed</dd>
                </div>
              </dl>
              <span>Example allocation · read only</span>
              <button className={s.detailDone} onClick={closeDetail}>
                Back to the plan <ArrowRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
      <figcaption>
        <span>
          One plan. Three perspectives. <b>{views[player.index].label}</b>
        </span>
        <button
          disabled={player.reduced}
          onClick={player.toggle}
          aria-label={
            player.requested ? "Pause product tour" : "Play product tour"
          }
        >
          {player.requested ? <Pause size={12} /> : <Play size={12} />}
          {player.reduced
            ? "Motion reduced"
            : player.requested
              ? "Pause tour"
              : "Play tour"}
        </button>
      </figcaption>
    </figure>
  );
}
