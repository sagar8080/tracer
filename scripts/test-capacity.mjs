import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyCapacity({
  request,
  save,
  client,
  org,
  org2,
  p,
  otherPerson,
  project,
  hiddenOrg,
}) {
  const calendar = {
    id: randomUUID(),
    orgId: org.id,
    personId: p.id,
    effectiveFrom: "2026-10-14",
    weeklyMinutes: [480, 480, 240, 0, 0, 360, 0],
    version: 1,
  };
  const leave = {
    id: randomUUID(),
    orgId: org.id,
    personId: p.id,
    category: "timeOff",
    title: "Annual leave",
    start: "2026-10-12",
    end: "2026-10-14",
    dailyMinutes: null,
    version: 1,
  };
  const holiday = {
    ...leave,
    id: randomUUID(),
    personId: null,
    category: "holiday",
    title: "Studio holiday",
  };
  const auditBefore = (
    await client.query("SELECT count(*)::int AS count FROM audit_events")
  ).rows[0].count;
  await save("calendar", calendar);
  await save("absence", leave);
  await save("absence", holiday);
  await save("calendar", { ...calendar, id: randomUUID() }, 409);
  await save(
    "calendar",
    { ...calendar, id: randomUUID(), weeklyMinutes: [480] },
    422,
  );
  await save(
    "calendar",
    { ...calendar, id: randomUUID(), weeklyMinutes: [61, 0, 0, 0, 0, 0, 0] },
    422,
  );
  await save(
    "calendar",
    { ...calendar, id: randomUUID(), personId: otherPerson.id },
    422,
  );
  await save(
    "absence",
    { ...leave, id: randomUUID(), personId: otherPerson.id },
    422,
  );
  await save(
    "absence",
    { ...holiday, id: randomUUID(), dailyMinutes: 240 },
    422,
  );
  await save("absence", { ...leave, id: randomUUID(), end: "2026-10-10" }, 422);
  await save("absence", { ...leave, id: randomUUID(), orgId: hiddenOrg }, 403);
  await save(
    "calendar",
    { ...calendar, id: randomUUID(), orgId: hiddenOrg },
    403,
  );
  await save(
    "calendar",
    { ...calendar, orgId: org2.id, personId: otherPerson.id, version: 2 },
    409,
  );
  await save(
    "absence",
    { ...leave, orgId: org2.id, personId: otherPerson.id, version: 2 },
    409,
  );
  const assignment = {
    id: randomUUID(),
    orgId: org.id,
    personId: p.id,
    projectId: project.id,
    title: "Weekend work",
    start: "2026-10-17",
    end: "2026-10-17",
    dailyMinutes: 120,
    status: "confirmed",
    version: 1,
  };
  await save("assignment", assignment); // Calendar makes Saturday a working day.
  await save(
    "assignment",
    { ...assignment, id: randomUUID(), start: "2026-10-16", end: "2026-10-16" },
    422,
  );
  await save(
    "assignment",
    { ...assignment, id: randomUUID(), start: "2026-10-10", end: "2026-10-10" },
    422,
  );
  const leaveWork = {
    ...assignment,
    id: randomUUID(),
    start: leave.start,
    end: leave.start,
  };
  await save("assignment", leaveWork); // Leave and holidays reduce capacity, not planned effort.
  const concurrent = await Promise.all(
    ["One", "Two"].map((title) =>
      request("POST", {
        kind: "absence",
        value: { ...leave, title, dailyMinutes: 240, version: 2 },
      }),
    ),
  );
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [204, 409]);
  await save("calendar", {
    ...calendar,
    weeklyMinutes: [480, 480, 240, 0, 0, 480, 0],
    version: 2,
  });
  await save("calendar", { ...calendar, version: 2 }, 409);
  await save(
    "deleteCalendar",
    { id: calendar.id, orgId: org.id, version: 1 },
    409,
  );
  await save("deleteAbsence", { id: leave.id, orgId: org.id, version: 1 }, 409);
  await client.query("UPDATE memberships SET role='planner' WHERE org_id=$1", [
    org.id,
  ]);
  await save("calendar", { ...calendar, version: 3 }, 403);
  await save(
    "deleteCalendar",
    { id: calendar.id, orgId: org.id, version: 2 },
    403,
  );
  await save("absence", { ...holiday, version: 2 }, 403);
  await save(
    "deleteAbsence",
    { id: holiday.id, orgId: org.id, version: 1 },
    403,
  );
  await save(
    "absence",
    { ...holiday, category: "timeOff", personId: p.id, version: 2 },
    409,
  );
  await save("absence", { ...leave, version: 3 });
  await client.query("UPDATE memberships SET role='viewer' WHERE org_id=$1", [
    org.id,
  ]);
  await save("absence", { ...leave, version: 4 }, 403);
  await save("deleteAbsence", { id: leave.id, orgId: org.id, version: 3 }, 403);
  await client.query("UPDATE memberships SET role='owner' WHERE org_id=$1", [
    org.id,
  ]);
  const visible = await (await request("GET")).json();
  assert.equal(visible.calendars.find((c) => c.id === calendar.id).version, 2);
  assert.equal(visible.absences.find((a) => a.id === leave.id).version, 3);
  assert.equal(
    visible.absences.find((a) => a.id === holiday.id).personId,
    null,
  );
  await assert.rejects(
    client.query(
      "INSERT INTO working_calendars(id,org_id,person_id,effective_from,weekly_minutes,version) VALUES($1,$2,$3,'2027-01-01',ARRAY[480,NULL,0,0,0,0,0],1)",
      [randomUUID(), org.id, p.id],
    ),
  );
  await assert.rejects(
    client.query(
      "INSERT INTO absences(id,org_id,person_id,category,title,start_date,end_date,version) VALUES($1,$2,$3,'timeOff','Foreign','2026-10-12','2026-10-12',1)",
      [randomUUID(), org.id, otherPerson.id],
    ),
  );
  await save("deleteCalendar", { id: calendar.id, orgId: org.id, version: 2 });
  await save("deleteAbsence", { id: leave.id, orgId: org.id, version: 3 });
  await save("deleteAbsence", { id: holiday.id, orgId: org.id, version: 1 });
  await save("deleteAssignment", {
    id: assignment.id,
    orgId: org.id,
    version: 1,
  });
  await save("deleteAssignment", {
    id: leaveWork.id,
    orgId: org.id,
    version: 1,
  });
  const final = await (await request("GET")).json();
  assert.equal(final.calendars.length, 0);
  assert.equal(final.absences.length, 0);
  const auditAfter = (
    await client.query("SELECT count(*)::int AS count FROM audit_events")
  ).rows[0].count;
  assert.equal(auditAfter - auditBefore, 13); // Only successful mutations produce audit events.
  console.log(
    "PASS: effective calendars, weekend scheduling, time off/holidays, concurrent edit conflicts, deletion, tenant boundaries, role permissions, database constraints and transactional audit.",
  );
}
