import assert from "node:assert/strict";
import { browser, demo, wait } from "./readme-capture.mjs";

const origin = process.env.KIVO_DEMO_ORIGIN || "http://127.0.0.1:3004";
const frame = (d) => d.page.frames().find((f) => f.url().endsWith("/app"));
const data = (d) =>
  frame(d).evaluate(() =>
    JSON.parse(localStorage.getItem("kivo.workspace.v1")),
  );

try {
  const d = await demo(
    "scheduling",
    "Plan work. Adjust with confidence.",
    "A shared timeline for people, projects and daily effort.",
    origin,
  );
  await d.app.getByText("Local workspace", { exact: true }).waitFor();
  await d.step("01  See the team's plan in one place");
  d.start();
  await wait(1600);
  await d.step("02  Add a focused allocation with dates and daily hours");
  await d.click(d.app.getByRole("button", { name: "Plan work", exact: true }));
  const dialog = d.app.getByRole("dialog");
  await dialog
    .getByLabel("What will they work on?")
    .pressSequentially("Launch handoff", { delay: 65 });
  await dialog
    .getByRole("combobox", { name: /^Project/ })
    .selectOption({ label: "Orbit rebrand" });
  await dialog
    .getByRole("combobox", { name: /^Person/ })
    .selectOption({ label: "Olivia Chen" });
  await dialog.getByLabel("Start date", { exact: true }).fill("2026-10-29");
  await dialog.getByLabel("End date", { exact: true }).fill("2026-10-30");
  await dialog.getByLabel("Hours per workday").fill("2");
  await wait(1700);
  await d.click(dialog.getByRole("button", { name: "Plan work" }));
  const allocation = d.app.locator('.allocation-main[title*="Launch handoff"]');
  await allocation.waitFor();
  await wait(1300);
  await d.step("03  Drag the work to an earlier date");
  const pos = await d.point(allocation);
  const day =
    (await d.app.locator(".day-cell").first().boundingBox())?.width || 65.2;
  await d.page.mouse.down();
  await d.move(pos.x - day * 2, pos.y, 30);
  await d.page.mouse.up();
  await wait(1400);
  let saved = await data(d);
  assert.equal(
    saved.assignments.find((a) => a.title === "Launch handoff").start,
    "2026-10-27",
  );
  await d.step(
    "04  Resize to extend the handoff; changes persist in this demo",
  );
  const resize = d.app.getByRole("button", {
    name: "Resize Launch handoff",
    exact: true,
  });
  const end = await d.point(resize);
  await d.page.mouse.down();
  await d.move(end.x + day, end.y, 25);
  await d.page.mouse.up();
  await wait(1200);
  saved = await data(d);
  assert.equal(
    saved.assignments.find((a) => a.title === "Launch handoff").end,
    "2026-10-29",
  );
  await d.finish();

  const c = await demo(
    "capacity",
    "Understand every hour of capacity.",
    "Working calendars, time off and committed work stay connected.",
    origin,
  );
  await c.click(c.app.getByRole("button", { name: "Capacity", exact: true }));
  await c.step("01  Inspect daily availability across the team");
  c.start();
  await wait(1500);
  await c.step("02  Trace an overload to the work behind it");
  await c.click(
    c.app.getByRole("button", { name: /^Emma Thompson, 2026-10-21:/ }),
  );
  await c.app
    .getByRole("region", { name: "Daily capacity breakdown" })
    .waitFor();
  await wait(2100);
  await c.click(c.app.getByRole("button", { name: "Close daily breakdown" }));
  await c.step("03  Record partial-day leave without removing planned work");
  await c.click(c.app.getByRole("button", { name: "Time off", exact: true }));
  const leave = c.app.getByRole("dialog");
  await leave
    .getByLabel("Time off label")
    .pressSequentially("Personal time", { delay: 65 });
  await leave
    .getByRole("combobox", { name: /^Person/ })
    .selectOption({ label: "Olivia Chen" });
  await leave.getByLabel("Start date", { exact: true }).fill("2026-10-26");
  await leave.getByLabel("End date", { exact: true }).fill("2026-10-26");
  await leave
    .getByRole("combobox", { name: /^Duration/ })
    .selectOption("partial");
  await leave.getByLabel("Hours off per day").fill("4");
  await wait(1400);
  await c.click(leave.getByRole("button", { name: "Add time off" }));
  await wait(900);
  await c.step("04  See 6h of work against 4h available, with leave explained");
  await c.click(
    c.app.getByRole("button", { name: /^Olivia Chen, 2026-10-26:/ }),
  );
  const breakdown = c.app.getByRole("region", {
    name: "Daily capacity breakdown",
  });
  await breakdown.waitFor();
  assert.match(await breakdown.innerText(), /Personal time/);
  await wait(2300);
  await c.click(c.app.getByRole("button", { name: "Close daily breakdown" }));
  await c.step("05  Review each person's effective working calendar");
  await c.click(c.app.getByRole("tab", { name: "Working calendars" }));
  await c.click(c.app.locator("summary").filter({ hasText: "Olivia Chen" }));
  await wait(1700);
  const persisted = await data(c);
  assert.equal(persisted.absences[0].dailyMinutes, 240);
  assert.equal(
    persisted.assignments.filter(
      (a) => a.personId === persisted.absences[0].personId,
    ).length,
    3,
  );
  await c.finish();
} finally {
  await browser.close();
}
