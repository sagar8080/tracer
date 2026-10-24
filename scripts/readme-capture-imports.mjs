import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { browser, demo, wait } from "./readme-capture.mjs";

try {
  const origin = process.env.KIVO_SHARED_ORIGIN || "http://127.0.0.1:3002";
  const fixture = JSON.parse(
    await readFile("output/import-browser-fixture.json", "utf8"),
  );
  assert.equal(
    fixture.webOrigin,
    origin,
    "Use only the current disposable import-QA frontend.",
  );
  const d = await demo(
    "spreadsheet-import",
    "From spreadsheet to shared plan.",
    "Review the mapping. Inspect the changes. Publish when ready.",
    origin,
  );
  const request = (path, body) =>
    d.app.locator("body").evaluate(
      async (_, { path, body }) => {
        const response = await fetch(path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok)
          throw Error(
            `Fixture setup ${response.status}: ${await response.text()}`,
          );
        return response.status === 204 ? null : response.json();
      },
      { path, body },
    );
  const existing = await request("/api/workspace");
  assert(
    existing.organizations.some(
      (o) => o.id === fixture.orgId && o.name === "Import studio",
    ),
    "The current disposable QA organization must be present before capture setup.",
  );
  const previous = existing.organizations.find(
    (o) => o.name === "Studio Atlas",
  );
  const org = previous || {
    id: randomUUID(),
    name: "Studio Atlas",
    timezone: "America/New_York",
    currency: "USD",
    version: 1,
  };
  const people = ["Olivia Chen", "Noah Williams"].map((name, i) => ({
    id: randomUUID(),
    orgId: org.id,
    name,
    role: i ? "Frontend engineer" : "Design lead",
    team: i ? "Engineering" : "Design",
    dailyMinutes: 480,
    costRate: 8500,
    color: i ? "blue" : "sage",
    version: 1,
  }));
  const projects = ["Orbit rebrand", "Lumina website"].map((name, i) => ({
    id: randomUUID(),
    orgId: org.id,
    name,
    client: i ? "Lumina" : "Orbit",
    color: i ? "sage" : "lilac",
    budgetMinutes: 24000,
    billRate: 15000,
    status: "confirmed",
    version: 1,
  }));
  if (!previous)
    for (const [kind, value] of [
      ["organization", org],
      ...people.map((p) => ["person", p]),
      ...projects.map((p) => ["project", p]),
    ])
      await request("/api/workspace", { kind, value });
  assert.equal(
    existing.assignments.filter((a) => a.orgId === org.id).length,
    0,
    "Restart the disposable fixture before repeating a completed import recording.",
  );
  const f = d.page.frames().find((f) => f.url().endsWith("/app"));
  await f.goto(`${origin}/app`);
  await d.app.getByRole("button", { name: /switch workspace/ }).waitFor();
  await d.click(d.app.getByRole("button", { name: /switch workspace/ }));
  await d.click(d.app.getByRole("menuitem", { name: org.name, exact: true }));
  await d.click(d.app.getByRole("button", { name: /switch workspace/ }));
  await d.click(
    d.app.getByRole("menuitem", { name: "Spreadsheet imports", exact: true }),
  );
  await d.app.getByLabel("Workbook file").waitFor();
  await d.step("01  Upload a supported CSV or XLSX into private staging");
  d.start();
  await wait(1500);
  const csv =
    "ID,Person,Project,Start,End,Hours per day\n" +
    "plan-01,Olivia Chen,Orbit rebrand,2026-10-19,2026-10-23,6\n" +
    "plan-02,Noah Williams,Lumina website,2026-10-19,2026-10-23,8\n" +
    "plan-03,Olivia Chen,Orbit rebrand,2026-10-26,2026-10-30,4\n" +
    "plan-04,Noah Williams,Lumina website,2026-10-26,2026-10-30,6\n";
  await d.app.getByLabel("Workbook file").setInputFiles({
    name: "studio-atlas-plan.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await wait(800);
  await d.click(
    d.app.getByRole("button", { name: "Review workbook", exact: true }),
  );
  await d.app.getByLabel("Person column").waitFor({ timeout: 30000 });
  await d.step("02  Map the columns explicitly; no AI key is required");
  for (const [name, value] of [
    ["Person", "1"],
    ["Project", "2"],
    ["Start date", "3"],
    ["End date", "4"],
    ["Effort", "5"],
    ["Stable row ID", "0"],
  ]) {
    const field = d.app.getByLabel(`${name} column`, { exact: true });
    await d.point(field);
    await field.selectOption(value);
    await wait(200);
  }
  await wait(1000);
  await d.step("03  Confirm the people, projects and calendar assumptions");
  await d.app.getByLabel(/Use each existing person/).check();
  await d.point(
    d.app.getByRole("button", { name: "Preview reconciliation", exact: true }),
  );
  await wait(1700);
  await d.click(
    d.app.getByRole("button", { name: "Preview reconciliation", exact: true }),
  );
  const publish = d.app.getByRole("button", {
    name: "Publish reviewed plan",
    exact: true,
  });
  await publish.waitFor();
  await d.step(
    "04  Inspect four additions and 120 planned hours before publishing",
  );
  assert.match(
    await d.app
      .getByRole("region", { name: "Reconciliation preview" })
      .innerText()
      .catch(() => d.app.locator(".import-reconciliation").innerText()),
    /120 planned hours/,
  );
  await wait(2000);
  await d.click(publish);
  await d.app.getByText(/Published at workspace revision/).waitFor();
  await d.step(
    "05  Publish the reviewed plan, with a reconciled CSV available",
  );
  await wait(1900);
  const snapshot = await request("/api/workspace");
  assert.equal(
    snapshot.assignments.filter((a) => a.orgId === org.id).length,
    4,
  );
  assert.equal(
    snapshot.assignments
      .filter((a) => a.orgId === org.id)
      .reduce((sum, a) => sum + a.dailyMinutes * 5, 0),
    7200,
  );
  await d.click(d.app.getByRole("button", { name: "Schedule", exact: true }));
  await d.step("06  Continue planning in the shared workspace");
  await d.app.locator(".allocation-main").first().waitFor();
  await d.finish();
} finally {
  await browser.close();
}
