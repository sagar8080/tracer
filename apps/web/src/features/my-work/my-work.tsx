"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { WorkspaceData } from "@/lib/model";
import { addDays, capacity, hours, monday, today } from "@/lib/scheduling";
import { useResource } from "@/lib/use-resource";
import { type TimeSnapshot, timePath } from "@/features/time-tracking/model";
import { LeaveRequests } from "@/features/leave-requests/leave-requests";
export function MyWork({
  orgId,
  data,
  onChanged,
  onTimesheet,
}: {
  orgId: string;
  data: WorkspaceData;
  onChanged: () => Promise<void>;
  onTimesheet: () => void;
}) {
  const timezone = data.organizations.find((o) => o.id === orgId)?.timezone;
  const now = today(timezone),
    [week, setWeek] = useState(monday(now));
  const revision = data.access.find((a) => a.orgId === orgId)?.revision ?? 0;
  const { data: snapshot, error } = useResource<TimeSnapshot>(
    `${timePath(orgId)}?week=${week}`,
    revision,
  );
  const person = data.people.find(
    (p) => p.orgId === orgId && p.id === snapshot?.personId,
  );
  const assignments = data.assignments.filter(
    (a) =>
      a.orgId === orgId &&
      a.personId === person?.id &&
      a.start <= addDays(week, 6) &&
      a.end >= week,
  );
  const c = person ? capacity(person, assignments, week, 7, data) : null;
  const upcoming = data.absences
    .filter(
      (a) =>
        a.orgId === orgId &&
        (a.personId === person?.id || a.category === "holiday") &&
        a.end >= now,
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div className="feature-view">
      <div className="workspace-toolbar">
        <div className="date-controls">
          <button
            className="icon-button"
            aria-label="Previous week"
            onClick={() => setWeek(addDays(week, -7))}
          >
            <ChevronLeft size={16} />
          </button>
          <strong>Week of {week}</strong>
          <button
            className="icon-button"
            aria-label="Next week"
            onClick={() => setWeek(addDays(week, 7))}
          >
            <ChevronRight size={16} />
          </button>
          <button className="today-button" onClick={() => setWeek(monday(now))}>
            This week
          </button>
        </div>
        <button className="primary" onClick={onTimesheet}>
          Open timesheet
        </button>
      </div>
      {error && (
        <p className="error feature-error" role="alert">
          {error}
        </p>
      )}
      {!snapshot ? (
        <p className="feature-message" role="status">
          {error ? "My work unavailable" : "Loading your work…"}
        </p>
      ) : !person ? (
        <div className="empty-state">
          <h2>Your schedule isn’t linked yet</h2>
          <p>
            A workspace owner or admin can connect your account to a person in
            Team access.
          </p>
        </div>
      ) : (
        <div className="feature-content">
          <div className="feature-subheading">
            <div>
              <h2>{person.name}</h2>
              <p>
                {person.role} · {person.team}
              </p>
            </div>
            <span>
              {c?.utilization === null ? "—" : `${c?.utilization}%`} planned
            </span>
          </div>
          <div className="my-capacity" aria-label="Your daily capacity">
            {c?.days.map((d) => (
              <div className={d.overload ? "over" : ""} key={d.date}>
                <small>
                  {new Date(`${d.date}T12:00Z`).toLocaleDateString("en", {
                    weekday: "short",
                    timeZone: "UTC",
                  })}{" "}
                  {d.date.slice(-2)}
                </small>
                <strong>
                  {hours(d.planned)}h <span>/ {hours(d.total)}h</span>
                </strong>
                <div className="capacity-track">
                  <i
                    style={{
                      width: `${d.total ? Math.min(100, (d.planned / d.total) * 100) : d.planned ? 100 : 0}%`,
                    }}
                  />
                </div>
                <small>
                  {d.overload
                    ? `${hours(d.overload)}h over capacity`
                    : `${hours(d.available)}h available`}
                </small>
              </div>
            ))}
          </div>
          <div className="my-work-summary">
            <span>{hours(c?.planned ?? 0)}h planned</span>
            <span>{hours(c?.total ?? 0)}h capacity</span>
            <span>
              {hours(
                snapshot.own?.entries.reduce((s, e) => s + e.minutes, 0) ?? 0,
              )}
              h recorded
            </span>
          </div>
          <section>
            <div className="feature-subheading">
              <h2>Your assignments</h2>
            </div>
            {assignments.length ? (
              assignments.map((a) => (
                <div className="my-assignment" key={a.id}>
                  <span
                    className={`project-dot ${data.projects.find((p) => p.id === a.projectId)?.color ?? "sage"}`}
                  />
                  <div>
                    <strong>
                      {data.projects.find((p) => p.id === a.projectId)?.name ??
                        "Project"}
                    </strong>
                    <small>
                      {a.title} · {a.start} – {a.end}
                    </small>
                  </div>
                  <span>
                    {hours(a.dailyMinutes)}h / day · {a.status}
                  </span>
                </div>
              ))
            ) : (
              <p className="feature-message">No assignments this week.</p>
            )}
          </section>
          <section>
            <div className="feature-subheading">
              <h2>Upcoming approved time off</h2>
            </div>
            {upcoming.length ? (
              upcoming.map((a) => (
                <div className="my-assignment" key={a.id}>
                  <div>
                    <strong>{a.title}</strong>
                    <small>
                      {a.start} – {a.end} ·{" "}
                      {a.category === "holiday"
                        ? "Workspace holiday"
                        : a.dailyMinutes
                          ? `${hours(a.dailyMinutes)}h per day`
                          : "Full days"}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <p className="feature-message">No upcoming time off.</p>
            )}
          </section>
          <LeaveRequests orgId={orgId} data={data} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}
