import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function verifySelfService({
  expect,
  request,
  save,
  fixture,
  client,
}) {
  const owner = "ian",
    member = "hannah",
    admin = "jules",
    viewer = "kelly",
    planner = "liam";
  const organization = {
    id: randomUUID(),
    name: "Timesheet studio",
    timezone: "America/New_York",
    currency: "USD",
    version: 1,
  };
  await expect(owner, "/v1/onboarding", { kind: "team", organization });
  const org = organization.id,
    team = `/v1/organizations/${org}/team`,
    time = `/v1/organizations/${org}/time`,
    leave = `/v1/organizations/${org}/leave`,
    reports = `/v1/organizations/${org}/reports`;
  const week = "2026-10-12";
  const snapshot = (user = member, date = week) =>
    expect(user, `${time}?week=${date}`);
  const users = {};
  for (const [user, role] of [
    [member, "member"],
    [admin, "admin"],
    [viewer, "viewer"],
    [planner, "planner"],
  ]) {
    const invite = await expect(owner, team, {
      kind: "invite",
      email: `${user}@studio.test`,
      role,
    });
    await expect(user, "/v1/invitations/accept", { token: invite.token });
    users[user] = (await expect(user)).actorId;
  }
  await expect(
    owner,
    `/v1/organizations/${org}/enrollment`,
    {
      userId: users[member],
      membershipVersion: 1,
      enrollment: {
        kind: "create",
        profile: { name: "Hannah Maker", dailyMinutes: 480 },
      },
    },
    204,
  );
  const person = (await expect(owner)).people.find((p) => p.orgId === org);
  const project = {
    id: randomUUID(),
    orgId: org,
    name: "Website launch",
    client: "Studio",
    color: "blue",
    budgetMinutes: 2400,
    billRate: 10000,
    status: "confirmed",
    version: 1,
  };
  await save(owner, "project", project);
  const assignment = {
    id: randomUUID(),
    orgId: org,
    personId: person.id,
    projectId: project.id,
    title: "Build website",
    start: week,
    end: "2026-10-16",
    dailyMinutes: 360,
    status: "confirmed",
    version: 1,
  };
  await save(owner, "assignment", assignment);
  await save(owner, "calendar", {
    id: randomUUID(),
    orgId: org,
    personId: person.id,
    effectiveFrom: week,
    weeklyMinutes: [480, 480, 420, 420, 420, 0, 0],
    version: 1,
  });
  assert.equal((await snapshot()).personId, person.id);
  assert.equal((await snapshot()).canRecord, true);
  assert.equal((await snapshot(viewer)).canRecord, false);
  await expect("outsider", `${time}?week=${week}`, undefined, 403);
  await expect("outsider", leave, undefined, 403);
  await expect(
    "outsider",
    `${reports}?start=${week}&end=2026-10-18`,
    undefined,
    403,
  );
  await expect(member, `${time}?week=2026-10-13`, undefined, 422);
  const entry = {
    kind: "save",
    id: randomUUID(),
    date: week,
    projectId: project.id,
    minutes: 300,
    billable: true,
    note: "Design and build",
    version: 1,
    sheetVersion: 0,
  };
  await expect(viewer, time, entry, 403);
  await expect(planner, time, entry, 422); // a scheduling association is required
  await expect(admin, time, entry, 422); // admin authority does not imply their own profile
  await expect(member, time, { ...entry, projectId: randomUUID() }, 422);
  assert.equal(
    (await snapshot()).own,
    null,
    "Rejected insert leaked an empty sheet",
  );
  const key = randomUUID();
  await Promise.all([
    expect(member, time, entry, 204, key),
    expect(member, time, entry, 204, key),
  ]);
  let own = (await snapshot()).own;
  assert.equal(own.entries.length, 1);
  assert.equal(own.version, 2);
  await expect(member, time, { ...entry, note: "Different" }, 409, key);
  await expect(member, time, { ...entry, version: 2, sheetVersion: 1 }, 409);
  const second = {
    ...entry,
    id: randomUUID(),
    date: "2026-10-13",
    minutes: 120,
    billable: false,
    note: "Internal review",
    sheetVersion: own.version,
  };
  await expect(member, time, second, 204);
  own = (await snapshot()).own;
  await expect(
    member,
    time,
    { ...entry, id: randomUUID(), minutes: 1200, sheetVersion: own.version },
    422,
  );
  assert.equal((await snapshot()).own.entries.length, 2);
  await expect(
    planner,
    time,
    {
      kind: "review",
      id: own.id,
      version: own.version,
      decision: "approve",
      note: "",
    },
    403,
  );
  assert.equal((await snapshot(planner)).reviews.length, 0);
  assert.equal((await snapshot(viewer)).reviews.length, 0);
  assert.equal((await snapshot(admin)).reviews.length, 1);
  await expect(
    member,
    time,
    { kind: "submit", week, version: own.version },
    204,
  );
  own = (await snapshot()).own;
  const revise = { ...entry, version: 2, sheetVersion: own.version };
  await expect(member, time, revise, 422);
  await expect(
    member,
    time,
    {
      kind: "delete",
      id: entry.id,
      week,
      version: 1,
      sheetVersion: own.version,
    },
    422,
  );
  await expect(
    member,
    time,
    {
      kind: "review",
      id: own.id,
      version: own.version,
      decision: "approve",
      note: "",
    },
    403,
  );
  await expect(
    admin,
    time,
    {
      kind: "review",
      id: own.id,
      version: own.version,
      decision: "return",
      note: "",
    },
    422,
  );
  await expect(
    admin,
    time,
    {
      kind: "review",
      id: own.id,
      version: own.version,
      decision: "return",
      note: "Please include the review meeting",
    },
    204,
  );
  own = (await snapshot()).own;
  assert.equal(own.status, "draft");
  assert.match(own.reviewNote, /review meeting/);
  const third = {
    ...entry,
    id: randomUUID(),
    date: "2026-10-14",
    minutes: 60,
    billable: true,
    note: "Review meeting",
    sheetVersion: own.version,
  };
  await expect(member, time, third, 204);
  own = (await snapshot()).own;
  await expect(
    member,
    time,
    { kind: "submit", week, version: own.version },
    204,
  );
  own = (await snapshot()).own;
  await expect(
    member,
    time,
    { kind: "withdraw", week, version: own.version },
    204,
  );
  own = (await snapshot()).own;
  await expect(
    member,
    time,
    { kind: "submit", week, version: own.version },
    204,
  );
  own = (await snapshot()).own;
  const approve = {
    kind: "review",
    id: own.id,
    version: own.version,
    decision: "approve",
    note: "Checked",
  };
  const reviewKey = randomUUID();
  await expect(admin, time, approve, 204, reviewKey);
  await expect(admin, time, approve, 204, reviewKey);
  own = (await snapshot()).own;
  assert.equal(own.status, "approved");
  await expect(member, time, { ...revise, sheetVersion: own.version }, 422);
  await expect(
    member,
    time,
    { kind: "withdraw", week, version: own.version },
    422,
  );
  await expect(
    admin,
    time,
    { ...approve, version: own.version, decision: "return", note: "Reopen" },
    422,
  );
  // Concurrent edits/deletes use both entry and aggregate sheet versions.
  const next = {
    ...entry,
    id: randomUUID(),
    date: "2026-10-19",
    sheetVersion: 0,
  };
  await expect(member, time, next, 204);
  let future = (await snapshot(member, "2026-10-19")).own;
  const edit = { ...next, version: 2, sheetVersion: future.version };
  const race = await Promise.all([
    request(member, time, { ...edit, minutes: 200 }),
    request(member, time, { ...edit, minutes: 240 }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [204, 409]);
  future = (await snapshot(member, "2026-10-19")).own;
  await expect(
    member,
    time,
    {
      kind: "delete",
      id: next.id,
      week: "2026-10-19",
      version: 2,
      sheetVersion: future.version,
    },
    204,
  );
  future = (await snapshot(member, "2026-10-19")).own;
  await expect(
    member,
    time,
    { kind: "submit", week: "2026-10-19", version: future.version },
    422,
  );
  // Another linked account cannot change someone else's entries or submission.
  await expect(
    owner,
    `/v1/organizations/${org}/enrollment`,
    {
      userId: users[planner],
      membershipVersion: 1,
      enrollment: {
        kind: "create",
        profile: { name: "Liam Planner", dailyMinutes: 480 },
      },
    },
    204,
  );
  await expect(planner, time, { ...entry, version: 2, sheetVersion: 0 }, 409);
  assert.equal((await snapshot(planner)).own, null);
  const leaveInput = {
    kind: "request",
    id: randomUUID(),
    title: "Medical appointment",
    start: "2026-10-14",
    end: "2026-10-14",
    dailyMinutes: 180,
  };
  await expect(viewer, leave, leaveInput, 403);
  const before = (await expect(owner)).absences.length;
  const leaveKey = randomUUID();
  await expect(member, leave, leaveInput, 204, leaveKey);
  await expect(member, leave, leaveInput, 204, leaveKey);
  assert.equal((await expect(owner)).absences.length, before);
  assert.equal((await expect(member, leave)).requests.length, 1);
  assert.equal((await expect(planner, leave)).requests.length, 0);
  const leaveId = leaveInput.id;
  await expect(
    planner,
    leave,
    { kind: "review", id: leaveId, version: 1, decision: "approve", note: "" },
    403,
  );
  await expect(
    member,
    leave,
    { kind: "review", id: leaveId, version: 1, decision: "approve", note: "" },
    403,
  );
  const leaveApprove = {
    kind: "review",
    id: leaveId,
    version: 1,
    decision: "approve",
    note: "Approved",
  };
  const leaveReviewKey = randomUUID();
  await expect(admin, leave, leaveApprove, 204, leaveReviewKey);
  await expect(admin, leave, leaveApprove, 204, leaveReviewKey);
  const absence = (await expect(owner)).absences.find(
    (a) => a.title === leaveInput.title,
  );
  assert.ok(absence);
  assert.equal(absence.personId, person.id);
  await save(
    planner,
    "absence",
    { ...absence, version: 2, dailyMinutes: 240 },
    422,
  );
  await expect(
    planner,
    "/v1/workspace",
    {
      kind: "deleteAbsence",
      value: { id: absence.id, orgId: org, version: 1 },
    },
    422,
  );
  await expect(member, leave, { kind: "cancel", id: leaveId, version: 2 }, 403);
  const report = await expect(
    viewer,
    `${reports}?start=${week}&end=2026-10-18`,
  );
  assert.equal(report.totals.plannedMinutes, 1800);
  assert.equal(report.totals.recordedMinutes, 480);
  assert.equal(report.totals.approvedMinutes, 480);
  assert.equal(report.totals.billableMinutes, 360);
  assert.equal(report.totals.capacityMinutes, 4620 - 180); // Hannah 2220 + Liam 2400
  assert.equal(report.projects[0].budgetMinutes, 2400);
  assert.equal(report.projects[0].lifetimeApprovedMinutes, 480);
  assert.equal(
    report.people.find((p) => p.id === person.id).capacityMinutes,
    2040,
  );
  assert.equal(
    report.days.find((d) => d.date === "2026-10-14").capacityMinutes,
    720,
  );
  assert.equal(JSON.stringify(report).includes("Medical appointment"), false);
  assert.equal(JSON.stringify(report).includes("costRate"), false);
  await expect(
    viewer,
    `${reports}?start=2026-01-01&end=2027-01-02`,
    undefined,
    422,
  );
  await expect(owner, leave, { kind: "cancel", id: leaveId, version: 2 }, 204);
  assert.equal((await expect(owner)).absences.length, before);
  const denied = { ...leaveInput, id: randomUUID(), title: "Leave to reject" };
  await expect(member, leave, denied, 204);
  await expect(
    admin,
    leave,
    { kind: "review", id: denied.id, version: 1, decision: "reject", note: "" },
    422,
  );
  await expect(
    admin,
    leave,
    {
      kind: "review",
      id: denied.id,
      version: 1,
      decision: "reject",
      note: "Please choose another date",
    },
    204,
  );
  const cancel = {
    ...leaveInput,
    id: randomUUID(),
    title: "Cancelled request",
  };
  await expect(member, leave, cancel, 204);
  await expect(
    member,
    leave,
    { kind: "cancel", id: cancel.id, version: 1 },
    204,
  );
  assert.equal((await expect(owner)).absences.length, before);
  // Recheck the role even when a successful command receipt exists.
  await expect(owner, team, {
    kind: "changeRole",
    userId: users[admin],
    role: "viewer",
    version: 1,
  });
  await expect(admin, time, approve, 403, reviewKey);
  await expect(admin, leave, leaveApprove, 403, leaveReviewKey);
  await expect(owner, team, {
    kind: "changeRole",
    userId: users[admin],
    role: "admin",
    version: 2,
  });
  const audit = (
    await client.query(
      "SELECT count(*)::int n FROM audit_events WHERE org_id=$1 AND action='timesheet.approve'",
      [org],
    )
  ).rows[0].n;
  assert.equal(audit, 1);
  console.log(
    "PASS: linked member time ownership, daily/weekly versions and limits, submit/withdraw/return/approval locks, review privacy, role/tenant denials, leave approval/cancellation capacity, exact retries, audit atomicity and independently calculated reporting totals.",
  );
  return { org, person, project, owner, member, admin, viewer, planner };
}
