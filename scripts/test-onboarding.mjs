import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Runs against the real PostgreSQL and signed-identity fixtures used by test:shared.
export async function verifyOnboarding({
  expect,
  request,
  save,
  fixture,
  client,
}) {
  const endpoint = "/v1/onboarding";
  const organization = () => ({
    id: randomUUID(),
    name: "Onboarding studio",
    timezone: "America/New_York",
    currency: "USD",
    version: 1,
  });
  const setup = {
    kind: "personal",
    organization: organization(),
    profile: { name: "Solo planner", dailyMinutes: 420 },
  };
  const unverified = fixture.token("new-solo", {
    "https://kivo.app/email_verified": false,
  });
  assert.deepEqual((await expect("new-solo")).access, []);
  await expect("new-solo", endpoint, setup, 422, undefined, unverified);
  await expect(
    "new-solo",
    "/v1/workspace",
    { kind: "organization", value: setup.organization },
    422,
    undefined,
    unverified,
  );
  assert.equal((await expect("new-solo")).organizations.length, 0);
  const key = randomUUID();
  await Promise.all([
    expect("new-solo", endpoint, setup, 200, key),
    expect("new-solo", endpoint, setup, 200, key),
  ]);
  await expect(
    "new-solo",
    endpoint,
    { ...setup, profile: { ...setup.profile, name: "Different request" } },
    409,
    key,
  );
  const solo = await expect("new-solo");
  assert.equal(solo.access[0].role, "owner");
  assert.equal(solo.people.length, 1);
  assert.equal(solo.people[0].dailyMinutes, 420);
  assert.equal(
    (
      await expect(
        "new-solo",
        `/v1/organizations/${setup.organization.id}/team`,
      )
    ).members[0].personId,
    solo.people[0].id,
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM audit_events WHERE org_id=$1",
        [setup.organization.id],
      )
    ).rows[0].n,
    1,
  );
  const input = { kind: "team", organization: organization() };
  await expect("new-owner", endpoint, input);
  const org = input.organization.id;
  const teamPath = `/v1/organizations/${org}/team`;
  const enrollmentPath = `/v1/organizations/${org}/enrollment`;
  assert.equal((await expect("new-owner")).people.length, 0);
  const members = {};
  for (const role of ["admin", "planner", "member", "viewer"]) {
    const user = `new-${role}`;
    const invitation = await expect("new-owner", teamPath, {
      kind: "invite",
      email: `${user}@studio.test`,
      role,
    });
    const unverifiedToken = fixture.token(user, {
      "https://kivo.app/email_verified": false,
    });
    assert.equal(
      (await expect(user, endpoint, undefined, 200, undefined, unverifiedToken))
        .invitations.length,
      0,
    );
    await expect(
      user,
      "/v1/invitations/accept",
      { id: invitation.invitation.id },
      422,
      undefined,
      unverifiedToken,
    );
    await expect(
      "outsider",
      "/v1/invitations/accept",
      { id: invitation.invitation.id },
      403,
    );
    const status = await expect(user, endpoint);
    assert.equal(status.invitations.length, 1);
    assert.equal(status.invitations[0].role, role);
    assert.equal(
      status.invitations[0].organizationName,
      input.organization.name,
    );
    await expect(user, "/v1/invitations/accept", {
      id: invitation.invitation.id,
    });
    await expect(user, "/v1/invitations/accept", {
      id: invitation.invitation.id,
    });
    const workspace = await expect(user);
    members[role] = workspace.actorId;
    assert.equal(workspace.access[0].role, role);
    assert.equal(
      workspace.people.length,
      0,
      "Accepting an invite silently enrolled the account",
    );
    assert.equal(
      workspace.organizations.length,
      1,
      "Joining created another workspace",
    );
    assert.equal((await expect(user, endpoint)).invitations.length, 0);
  }
  const enroll = {
    userId: members.member,
    membershipVersion: 1,
    enrollment: {
      kind: "create",
      profile: { name: "Sam Member", dailyMinutes: 480 },
    },
  };
  for (const user of ["outsider", "new-planner", "new-member", "new-viewer"])
    await expect(user, enrollmentPath, enroll, 403);
  await expect(
    "new-owner",
    enrollmentPath,
    { ...enroll, userId: solo.actorId },
    409,
  );
  await expect(
    "new-owner",
    enrollmentPath,
    { ...enroll, membershipVersion: 2 },
    409,
  );
  await expect(
    "new-owner",
    enrollmentPath,
    {
      ...enroll,
      enrollment: {
        kind: "create",
        profile: { name: "Invalid", dailyMinutes: 0 },
      },
    },
    422,
  );
  const enrollmentKey = randomUUID();
  await Promise.all([
    expect("new-admin", enrollmentPath, enroll, 204, enrollmentKey),
    expect("new-admin", enrollmentPath, enroll, 204, enrollmentKey),
  ]);
  let team = await expect("new-owner", teamPath);
  const member = team.members.find((m) => m.userId === members.member);
  assert.ok(member.personId);
  assert.equal(member.role, "member");
  assert.equal(member.version, 2);
  assert.equal((await expect("new-member")).people[0].costRate, null);
  const p = (await expect("new-owner")).people[0];
  await save("new-member", "person", { ...p, version: 2 }, 403);
  await save("new-viewer", "person", { ...p, version: 2 }, 403);
  await expect(
    "new-owner",
    enrollmentPath,
    { ...enroll, membershipVersion: 2 },
    422,
  );
  const historyProject = {
    id: randomUUID(),
    orgId: org,
    name: "Retained work",
    client: "Studio",
    color: "sage",
    budgetMinutes: 2400,
    billRate: 10000,
    status: "confirmed",
    version: 1,
  };
  await save("new-owner", "project", historyProject);
  const allocation = {
    id: randomUUID(),
    orgId: org,
    personId: p.id,
    projectId: historyProject.id,
    title: "Retain this schedule",
    start: "2026-10-13",
    end: "2026-10-13",
    dailyMinutes: 60,
    status: "confirmed",
    version: 1,
  };
  await save("new-owner", "assignment", allocation);
  const link = {
    userId: members.viewer,
    membershipVersion: 1,
    enrollment: { kind: "link", personId: member.personId },
  };
  await expect("new-owner", enrollmentPath, link, 409); // one person cannot link to two accounts
  await expect(
    "new-owner",
    enrollmentPath,
    { ...link, enrollment: { kind: "link", personId: solo.people[0].id } },
    409,
  );
  await expect(
    "new-owner",
    enrollmentPath,
    {
      userId: members.member,
      membershipVersion: 2,
      enrollment: { kind: "unlink" },
    },
    204,
  );
  assert.equal((await expect("new-owner")).people.length, 1);
  await expect("new-owner", enrollmentPath, link, 204);
  await expect("new-owner", teamPath, {
    kind: "remove",
    userId: members.viewer,
    version: 2,
  });
  assert.equal(
    (await expect("new-owner")).people.length,
    1,
    "Removing access deleted a resource",
  );
  assert.equal((await expect("new-viewer")).organizations.length, 0);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM member_people WHERE org_id=$1",
        [org],
      )
    ).rows[0].n,
    0,
  );
  assert.deepEqual((await expect("new-owner")).assignments, [allocation]);
  // Authorization is rechecked before a successful receipt can be replayed.
  await expect("new-owner", teamPath, {
    kind: "changeRole",
    userId: members.admin,
    role: "viewer",
    version: 1,
  });
  await expect("new-admin", enrollmentPath, enroll, 403, enrollmentKey);
  await expect("outsider", endpoint, setup, 403);
  const invalid = {
    kind: "personal",
    organization: organization(),
    profile: { name: "", dailyMinutes: 480 },
  };
  await expect("new-owner", endpoint, invalid, 422);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int n FROM organizations WHERE id=$1",
        [invalid.organization.id],
      )
    ).rows[0].n,
    0,
  );
  // Concurrent create/link attempts serialize on the same membership version.
  const race = await Promise.all([
    request("new-owner", enrollmentPath, { ...enroll, membershipVersion: 3 }),
    request("new-owner", enrollmentPath, { ...enroll, membershipVersion: 3 }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [204, 409]);
  console.log(
    "PASS: verified signup gates, personal/team setup, email-scoped invitations, no implicit membership/profile elevation, role matrix, atomic enrollment, tenant/uniqueness/version constraints, removal preservation and revoked-authority retries.",
  );
}
