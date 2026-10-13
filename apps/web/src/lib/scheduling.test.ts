import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capacity,
  workingDays,
  moveAssignment,
  lanes,
  loadOn,
  monday,
} from "./scheduling";
import { seed } from "./seed";
import { workspaceSchema } from "./model";
const s = seed(),
  p = s.people[0];
const a = {
  ...s.assignments[0],
  start: "2026-10-09",
  end: "2026-10-12",
  dailyMinutes: 480,
};
test("date arithmetic crosses weekends and daylight saving without shifting calendar days", () => {
  assert.equal(workingDays("2026-10-09", "2026-10-12"), 2);
  assert.equal(monday("2026-11-01"), "2026-10-26");
  assert.equal(
    moveAssignment({ ...a, start: "2026-10-30", end: "2026-11-02" }, 3).end,
    "2026-11-05",
  );
});
test("daily overload cannot disappear inside average utilization", () => {
  const x = { ...a, end: a.start, dailyMinutes: 600 };
  const c = capacity(p, [x], "2026-10-05", 7);
  assert.equal(c.utilization, 25);
  assert.deepEqual(c.conflictDays, ["2026-10-09"]);
  assert.equal(c.available, 1920);
});
test("tentative demand is excluded from committed capacity and weekends have no load", () => {
  assert.equal(loadOn([{ ...a, status: "tentative" }], p.id, a.start), 0);
  assert.equal(
    loadOn([{ ...a, status: "tentative" }], p.id, a.start, true),
    480,
  );
  assert.equal(loadOn([a], p.id, "2026-10-10"), 0);
});
test("moves preserve duration and bump version; overlapping allocations use separate lanes", () => {
  assert.equal(moveAssignment(a, 3).version, a.version + 1);
  assert.equal(moveAssignment(a, 3).start, "2026-10-12");
  assert.deepEqual(
    lanes([
      a,
      { ...a, id: "other" },
      { ...a, id: "later", start: "2026-10-13", end: "2026-10-14" },
    ]).map((x) => x.lane),
    [0, 1, 0],
  );
});
test("schema rejects cross-organization references and impossible dates", () => {
  assert.ok(workspaceSchema.safeParse(s).success);
  assert.ok(
    !workspaceSchema.safeParse({
      ...s,
      assignments: [{ ...a, orgId: s.people[1].id }],
    }).success,
  );
  assert.ok(
    !workspaceSchema.safeParse({
      ...s,
      assignments: [{ ...a, start: "2026-02-30" }],
    }).success,
  );
});

test("old saved workspaces gain empty calendars and absences without losing records", () => {
  const { calendars: _c, absences: _a, ...legacy } = s;
  const upgraded = workspaceSchema.parse(legacy);
  assert.deepEqual(upgraded.calendars, []);
  assert.deepEqual(upgraded.absences, []);
  assert.deepEqual(upgraded.assignments, s.assignments);
});
const calendar = {
  id: "00000000-0000-4000-8000-000000009001",
  orgId: p.orgId,
  personId: p.id,
  effectiveFrom: "2026-10-14",
  weeklyMinutes: [480, 480, 240, 0, 0, 360, 0],
  version: 1,
};
const leave = {
  id: "00000000-0000-4000-8000-000000009002",
  orgId: p.orgId,
  personId: p.id,
  category: "timeOff" as const,
  title: "Time off",
  start: "2026-10-12",
  end: "2026-10-12",
  dailyMinutes: 240,
  version: 1,
};
test("effective calendars preserve prior weekdays, allow Saturday work and change project effort", () => {
  const work = {
    ...a,
    start: "2026-10-12",
    end: "2026-10-18",
    dailyMinutes: 120,
  };
  const c = capacity(p, [work], work.start, 7, {
    calendars: [calendar],
    absences: [],
  });
  assert.equal(c.total, 1560); // Mon 8 + Tue 8 + Wed 4 + Sat 6.
  assert.equal(c.planned, 480); // Four working days, including Saturday.
  assert.equal(workingDays(work.start, work.end, p, [calendar]), 4);
  assert.equal(c.days[3].planned, 0);
  assert.equal(c.days[5].planned, 120);
  const next = {
    ...calendar,
    id: "next",
    effectiveFrom: "2026-10-17",
    weeklyMinutes: [0, 0, 0, 0, 0, 120, 0],
  };
  assert.equal(
    capacity(p, [], work.start, 7, {
      calendars: [next, calendar],
      absences: [],
    }).total,
    1320,
  );
});
test("leave never erases confirmed effort, overlapping reductions do not double count", () => {
  const work = { ...a, start: leave.start, end: leave.end, dailyMinutes: 360 };
  const c = capacity(p, [work], leave.start, 1, {
    calendars: [],
    absences: [leave, { ...leave, id: "overlap", dailyMinutes: 120 }],
  });
  assert.equal(c.total, 240);
  assert.equal(c.planned, 360);
  assert.equal(c.overload, 120);
  assert.equal(c.available, 0);
  assert.equal(c.removed, 240);
  assert.deepEqual(c.conflictDays, [leave.start]);
});
test("holidays override partial leave, zero-capacity utilization is undefined, tenant records are isolated", () => {
  const holiday = {
    ...leave,
    id: "holiday",
    personId: null,
    category: "holiday" as const,
    dailyMinutes: null,
  };
  const c = capacity(
    p,
    [{ ...a, start: leave.start, end: leave.end }],
    leave.start,
    1,
    { calendars: [], absences: [leave, holiday] },
  );
  assert.equal(c.total, 0);
  assert.equal(c.utilization, null);
  assert.equal(c.overload, 480);
  assert.equal(c.removed, 480);
  const foreign = capacity(p, [], leave.start, 1, {
    calendars: [
      { ...calendar, orgId: "elsewhere", effectiveFrom: leave.start },
    ],
    absences: [{ ...holiday, orgId: "elsewhere" }],
  });
  assert.equal(foreign.total, 480);
});
test("time off is clamped to the workday, respects DST dates, and keeps tentative work separate", () => {
  const partial = {
    ...leave,
    start: "2026-11-01",
    end: "2026-11-02",
    dailyMinutes: 600,
  };
  const c = capacity(
    p,
    [{ ...a, start: partial.start, end: partial.end, status: "tentative" }],
    partial.start,
    2,
    { calendars: [], absences: [partial] },
  );
  assert.equal(c.removed, 480);
  assert.equal(c.planned, 0);
  assert.equal(c.overload, 0);
  assert.equal(c.days[1].tentative, 480);
});
test("calendar and leave schemas reject malformed weeks, duplicate effective dates and foreign people", () => {
  for (const calendars of [
    [{ ...calendar, weeklyMinutes: [480] }],
    [{ ...calendar, weeklyMinutes: [61, 0, 0, 0, 0, 0, 0] }],
    [calendar, { ...calendar, id: leave.id }],
    [{ ...calendar, personId: leave.id }],
  ])
    assert.equal(workspaceSchema.safeParse({ ...s, calendars }).success, false);
  for (const absences of [
    [{ ...leave, personId: leave.id }],
    [{ ...leave, category: "holiday" }],
    [{ ...leave, start: "2026-02-30" }],
    [{ ...leave, end: "2026-10-01" }],
  ])
    assert.equal(workspaceSchema.safeParse({ ...s, absences }).success, false);
});
