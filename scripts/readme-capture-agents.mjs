// Record the actual A0 human review flow against the disposable import QA stack.
// Run the QA harness and set the Playwright/Chromium paths documented in docs/media.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { demo, browser, wait } from "./readme-capture.mjs";

const origin = "http://127.0.0.1:3002";
const capture = await demo(
  "agent-review",
  "Scoped agents. Human decisions.",
  "Inspect a proposed move and its capacity evidence before recording a review.",
  origin,
);
const { page, app, step, click, point } = capture;
// A0 checks the server date. Derive future work from the current host clock;
// the application reload below also recalculates its visible fortnight.
await page.clock.setFixedTime(new Date());

// Human fixture mutations use the same-origin BFF. Credentials remain in memory.
async function human(path = "/api/workspace", body, expected = 200) {
  return app.locator("body").evaluate(
    async (_element, { path, body, expected }) => {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(body === undefined
            ? {}
            : { "Idempotency-Key": crypto.randomUUID() }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status !== expected)
        throw Error(`Fixture BFF request failed: ${response.status} ${path}`);
      return response.status === 204 ? null : response.json();
    },
    { path, body, expected },
  );
}
const save = (kind, value) => human("/api/workspace", { kind, value }, 204);
async function machine(token, path, body) {
  const response = await fetch(`http://127.0.0.1:4300${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(body === undefined ? {} : { "Idempotency-Key": randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, 200, `Machine fixture request failed: ${path}`);
  return response.json();
}
const plus = (iso, days) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

try {
  const captureOrigin = new URL(origin);
  assert.equal(captureOrigin.protocol, "http:");
  assert.equal(captureOrigin.hostname, "127.0.0.1");
  const fixture = JSON.parse(
    await readFile(
      new URL("../output/import-browser-fixture.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    fixture.webOrigin,
    origin,
    "Capture requires the disposable QA origin",
  );
  const initialWorkspace = await human();
  assert.ok(
    initialWorkspace.organizations.some(
      (organization) => organization.id === fixture.orgId,
    ),
    "Capture requires the current disposable import fixture organization",
  );

  const org = {
    id: randomUUID(),
    name: "Northstar Studio",
    timezone: "America/New_York",
    currency: "USD",
    version: 1,
  };
  await save("organization", org);
  const people = [
    { name: "Maya Chen", role: "Design lead", team: "Brand", color: "lilac" },
    {
      name: "Theo Brooks",
      role: "Product designer",
      team: "Digital",
      color: "sage",
    },
    {
      name: "Nina Park",
      role: "Content strategist",
      team: "Brand",
      color: "peach",
    },
  ].map((person) => ({
    ...person,
    id: randomUUID(),
    orgId: org.id,
    dailyMinutes: 480,
    costRate: null,
    version: 1,
  }));
  for (const person of people) await save("person", person);
  const projects = [
    { name: "Orbit launch", client: "Orbit", color: "lilac" },
    { name: "Fieldnotes campaign", client: "Fieldnotes", color: "sage" },
  ].map((project) => ({
    ...project,
    id: randomUUID(),
    orgId: org.id,
    budgetMinutes: 24000,
    billRate: null,
    status: "confirmed",
    version: 1,
  }));
  for (const project of projects) await save("project", project);
  const start = await app.locator("body").evaluate(() => {
    const date = new Date();
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    const monday = new Date(`${iso}T12:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) + 7);
    return monday.toISOString().slice(0, 10);
  });
  const original = {
    id: randomUUID(),
    orgId: org.id,
    personId: people[0].id,
    projectId: projects[0].id,
    title: "Launch identity",
    start,
    end: plus(start, 1),
    dailyMinutes: 240,
    status: "confirmed",
    version: 1,
  };
  const assignments = [
    original,
    {
      ...original,
      id: randomUUID(),
      projectId: projects[1].id,
      title: "Campaign direction",
      dailyMinutes: 360,
    },
    {
      ...original,
      id: randomUUID(),
      personId: people[1].id,
      title: "Web experience",
      dailyMinutes: 300,
      end: plus(start, 4),
    },
    {
      ...original,
      id: randomUUID(),
      personId: people[2].id,
      projectId: projects[1].id,
      title: "Content strategy",
      dailyMinutes: 240,
      end: plus(start, 4),
    },
  ];
  for (const assignment of assignments) await save("assignment", assignment);
  const issued = await human(`/api/organizations/${org.id}/agents`, {
    kind: "register",
    id: randomUUID(),
    name: "Studio planning assistant",
    purpose: "Review Orbit launch capacity and propose future schedule moves",
    scope: {
      projectIds: [projects[0].id],
      capabilities: [
        "readSchedule",
        "readCapacity",
        "proposeMove",
        "readProposal",
      ],
      mode: "propose",
    },
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    parentId: null,
  });
  assert.ok(issued.credential?.startsWith("kivo_agent_"));
  const session = await machine(issued.credential, "/v1/agent-sessions", {
    credential: issued.credential,
  });
  const base = `/v1/organizations/${org.id}`;
  const snapshot = await machine(
    session.accessToken,
    `${base}/schedule?start=${start}&end=${plus(start, 11)}`,
  );
  assert.ok(
    snapshot.assignments.some((assignment) => assignment.id === original.id),
  );
  assert.ok(
    !snapshot.projects.some((project) => project.id === projects[1].id),
  );
  assert.ok(!JSON.stringify(snapshot).includes("costRate"));
  assert.ok(!JSON.stringify(snapshot).includes("billRate"));
  const proposal = await machine(session.accessToken, `${base}/proposals`, {
    kind: "propose",
    id: randomUUID(),
    request: {
      assignmentId: original.id,
      expectedVersion: original.version,
      sourceRevision: snapshot.revision,
      personId: original.personId,
      start: plus(start, 2),
      end: plus(start, 3),
      reason:
        "Move launch identity later in the week to clear Maya’s capacity conflict while keeping the same daily effort.",
    },
  });
  assert.equal(proposal.status, "pending");
  const overload = (days) =>
    days.reduce((sum, day) => sum + day.overloadMinutes, 0);
  assert.equal(overload(proposal.preview.impacts[0].before), 240);
  assert.equal(overload(proposal.preview.impacts[0].after), 0);
  assert.deepEqual(
    (await human()).assignments.find(
      (assignment) => assignment.id === original.id,
    ),
    original,
  );

  const studioIndex = (await human()).organizations
    .filter((item) => item.name === org.name)
    .findIndex((item) => item.id === org.id);
  assert.ok(studioIndex >= 0);

  // Refresh the real application after fixture creation and select its organization.
  const frame = page
    .frames()
    .find((candidate) => candidate.url() === `${origin}/app`);
  assert.ok(frame);
  await frame.goto(`${origin}/app`);
  await app.getByRole("button", { name: "Schedule", exact: true }).waitFor();
  await app.locator("body").evaluate((body) => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    body.append(style);
  });
  await app.getByRole("button", { name: /switch workspace/ }).click();
  await app
    .getByRole("menuitem", { name: "Northstar Studio", exact: true })
    .nth(studioIndex)
    .click();
  await app
    .getByRole("button", { name: "Northstar Studio · switch workspace" })
    .waitFor();
  await app.getByText("Maya Chen", { exact: true }).waitFor();
  await wait(1000);

  await step(
    "A shared plan with clear ownership and a visible capacity conflict",
  );
  capture.start();
  await wait(1800);
  await click(
    app.getByRole("button", { name: "Northstar Studio · switch workspace" }),
  );
  await wait(450);
  await click(
    app.getByRole("menuitem", { name: "Agent activity", exact: true }),
  );
  await app.getByRole("heading", { name: "Planning proposals" }).waitFor();
  await app.getByRole("button", { name: /Launch identity.*pending/ }).waitFor();
  await step(
    "One delegated project · bounded schedule reads · a proposal awaiting review",
  );
  await wait(1900);
  await click(app.getByRole("button", { name: /Launch identity.*pending/ }));
  const dialog = app.getByRole("dialog");
  await dialog.waitFor();
  await step("Inspect the dates, daily effort and overload change: 4h → 0h");
  await point(dialog.getByText("4h → 0h", { exact: true }));
  await wait(2500);
  await point(dialog.getByLabel("Decision", { exact: true }));
  await dialog
    .getByLabel("Decision", { exact: true })
    .selectOption("markReviewed");
  await click(dialog.getByLabel("Review note", { exact: true }));
  await dialog
    .getByLabel("Review note", { exact: true })
    .pressSequentially(
      "Capacity impact reviewed. Confirm timing with the client.",
      { delay: 30 },
    );
  await step(
    "Record the human review; the proposal does not publish a schedule change",
  );
  await wait(900);
  await click(dialog.getByRole("button", { name: "Save review", exact: true }));
  await app
    .getByText("Review recorded. The live schedule is unchanged.", {
      exact: true,
    })
    .waitFor();
  await app
    .getByRole("button", { name: /Launch identity.*reviewed/ })
    .waitFor();
  await wait(2000);

  const after = (await human()).assignments.find(
    (assignment) => assignment.id === original.id,
  );
  assert.deepEqual(after, original);
  const reviewed = await human(`/api/organizations/${org.id}/proposals`);
  assert.equal(
    reviewed.proposals.find((item) => item.id === proposal.id).status,
    "reviewed",
  );
  assert.equal(await app.getByLabel("Agent credential").count(), 0);
  await step(
    "Review saved. Return to the live schedule to verify the original work.",
  );
  await click(app.getByRole("button", { name: "Schedule", exact: true }));
  const allocation = app.getByTitle(/^Orbit launch · Launch identity ·/);
  await allocation.waitFor();
  await click(allocation);
  const liveEditor = app.getByRole("dialog");
  await liveEditor
    .getByRole("heading", { name: "Edit allocation", exact: true })
    .waitFor();
  assert.equal(
    await liveEditor.getByLabel("Start date", { exact: true }).inputValue(),
    original.start,
  );
  assert.equal(
    await liveEditor.getByLabel("End date", { exact: true }).inputValue(),
    original.end,
  );
  await step(
    `Live allocation verified: ${original.start} – ${original.end}. Review did not move it.`,
  );
  await wait(2000);
  await click(
    liveEditor.getByRole("button", { name: "Close editor", exact: true }),
  );
  await point(allocation);
  await step(
    `Live schedule unchanged · ${original.start} – ${original.end} · version ${original.version}`,
  );
  await wait(2000);
  assert.deepEqual(
    (await human()).assignments.find(
      (assignment) => assignment.id === original.id,
    ),
    original,
  );
  await capture.finish();
  console.log(
    "PASS: actual scoped proposal reviewed; assignment dates, person, effort and version are unchanged; no credential UI was shown.",
  );
} finally {
  await browser.close();
}
