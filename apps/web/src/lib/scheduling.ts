import type {
  Assignment,
  Person,
  WorkingCalendar,
  CalendarData,
} from "./model";
const DAY = 86400000;
export function addDays(date: string, n: number) {
  return new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);
}
export function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(a) - Date.parse(b)) / DAY);
}
export function weekday(d: string) {
  return ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay());
}
export function monday(d: string) {
  const n = new Date(d + "T12:00:00Z").getUTCDay();
  return addDays(d, -((n + 6) % 7));
}
export function today(timezone = "America/New_York") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function dates(start: string, count: number) {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
export function weeklyMinutes(
  person: Person,
  date: string,
  calendars: WorkingCalendar[] = [],
) {
  const current = calendars
    .filter(
      (c) =>
        c.orgId === person.orgId &&
        c.personId === person.id &&
        c.effectiveFrom <= date,
    )
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return (
    current?.weeklyMinutes ?? [
      person.dailyMinutes,
      person.dailyMinutes,
      person.dailyMinutes,
      person.dailyMinutes,
      person.dailyMinutes,
      0,
      0,
    ]
  );
}
export function baseCapacityOn(
  person: Person,
  date: string,
  calendars: WorkingCalendar[] = [],
) {
  return weeklyMinutes(person, date, calendars)[
    (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7
  ];
}
export function availabilityOn(
  person: Person,
  date: string,
  calendar: CalendarData = { calendars: [], absences: [] },
) {
  const base = baseCapacityOn(person, date, calendar.calendars);
  const absences = calendar.absences.filter(
    (a) =>
      a.orgId === person.orgId &&
      (a.personId === person.id || a.category === "holiday") &&
      a.start <= date &&
      a.end >= date,
  );
  // Daily reductions have no time-of-day dimension. Overlaps use the largest reduction.
  const removed = Math.min(
    base,
    Math.max(0, ...absences.map((a) => a.dailyMinutes ?? base)),
  );
  return { base, removed, total: base - removed, absences };
}
export function workingDays(
  start: string,
  end: string,
  person?: Person,
  calendars: WorkingCalendar[] = [],
) {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1))
    if (person ? baseCapacityOn(person, d, calendars) > 0 : weekday(d)) n++;
  return n;
}
export function hours(minutes: number) {
  return Number((minutes / 60).toFixed(2));
}
export function loadOn(
  assignments: Assignment[],
  personId: string,
  date: string,
  includeTentative = false,
  person?: Person,
  calendars: WorkingCalendar[] = [],
) {
  if (person ? baseCapacityOn(person, date, calendars) === 0 : !weekday(date))
    return 0;
  return assignments
    .filter(
      (a) =>
        a.personId === personId &&
        a.start <= date &&
        a.end >= date &&
        (includeTentative || a.status === "confirmed"),
    )
    .reduce((s, a) => s + a.dailyMinutes, 0);
}
export function capacity(
  person: Person,
  assignments: Assignment[],
  start: string,
  count: number,
  calendar: CalendarData = { calendars: [], absences: [] },
) {
  const end = addDays(start, count - 1);
  const relevantAssignments = assignments.filter(
    (a) => a.personId === person.id && a.start <= end && a.end >= start,
  );
  const relevantCalendar = {
    calendars: calendar.calendars.filter(
      (c) => c.orgId === person.orgId && c.personId === person.id,
    ),
    absences: calendar.absences.filter(
      (a) =>
        a.orgId === person.orgId &&
        (a.personId === person.id || a.category === "holiday") &&
        a.start <= end &&
        a.end >= start,
    ),
  };
  const days = dates(start, count).map((date) => {
    const availability = availabilityOn(person, date, relevantCalendar);
    const planned = loadOn(
      relevantAssignments,
      person.id,
      date,
      false,
      person,
      relevantCalendar.calendars,
    );
    const tentative =
      loadOn(
        relevantAssignments,
        person.id,
        date,
        true,
        person,
        relevantCalendar.calendars,
      ) - planned;
    return {
      date,
      ...availability,
      planned,
      tentative,
      available: Math.max(0, availability.total - planned),
      overload: Math.max(0, planned - availability.total),
    };
  });
  const planned = days.reduce((s, d) => s + d.planned, 0);
  const total = days.reduce((s, d) => s + d.total, 0);
  return {
    days,
    planned,
    total,
    available: days.reduce((s, d) => s + d.available, 0),
    removed: days.reduce((s, d) => s + d.removed, 0),
    overload: days.reduce((s, d) => s + d.overload, 0),
    utilization: total ? Math.round((planned / total) * 100) : null,
    conflictDays: days.filter((d) => d.overload > 0).map((d) => d.date),
  };
}
export function lanes(assignments: Assignment[]) {
  const ends: string[] = [];
  return [...assignments]
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .map((a) => {
      let lane = ends.findIndex((e) => e < a.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = a.end;
      return { assignment: a, lane };
    });
}
export function moveAssignment(
  a: Assignment,
  delta: number,
  personId = a.personId,
): Assignment {
  return {
    ...a,
    personId,
    start: addDays(a.start, delta),
    end: addDays(a.end, delta),
    version: a.version + 1,
  };
}
