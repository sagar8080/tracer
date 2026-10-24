// Capture real local UI interactions. See docs/media/README.md for reproduction.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.KIVO_PLAYWRIGHT_MODULE || "playwright",
);
const output = resolve("output/readme-capture");
await mkdir(output, { recursive: true });
export const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.KIVO_CAPTURE_CHROMIUM || undefined,
});
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function demo(name, title, subtitle, origin) {
  const captureOrigin = new URL(origin);
  if (
    captureOrigin.protocol !== "http:" ||
    captureOrigin.hostname !== "127.0.0.1" ||
    captureOrigin.origin !== origin
  )
    throw Error(
      "README captures require an explicit http://127.0.0.1 loopback origin.",
    );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.clock.setFixedTime(new Date("2026-10-23T14:00:00-04:00"));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#111214;color:#e9eaed;font-family:Arial,sans-serif}
    header{height:108px;padding:27px 34px;display:flex;align-items:center;gap:24px}
    .brand{font-size:25px;font-weight:600;letter-spacing:-1px;padding-right:25px;border-right:1px solid #36363d}
    h1{font-size:23px;font-weight:500;letter-spacing:-.5px;margin:0 0 7px}p{font-size:14px;color:#a0a1aa;margin:0}
    .fixture{margin-left:auto;font-size:12px;color:#a0a1aa;white-space:nowrap}
    iframe{display:block;border:1px solid #34343b;border-radius:10px;width:1376px;height:820px;margin:0 32px;background:#191a1d}
    footer{height:72px;display:flex;align-items:center;padding:0 35px;gap:12px;font-size:15px;color:#cdcdd5}
    .dot{width:7px;height:7px;background:#a6a3f5;border-radius:100%}#step{flex:1}
    .kind{font-size:12px;color:#777983}#pointer{position:fixed;top:0;left:0;width:18px;height:23px;z-index:99999;pointer-events:none;opacity:0;filter:drop-shadow(0 2px 3px #0008)}
  </style></head><body><header><div class="brand">kivo</div><div><h1></h1><p></p></div><span class="fixture">Local demo · Fictional data</span></header>
  <iframe title="Kivo product workspace" src="${origin}/app"></iframe><footer><span class="dot"></span><span id="step">Explore the workspace</span><span class="kind">Actual application capture</span></footer>
  <svg id="pointer" viewBox="0 0 18 23"><path d="M1 1v18l5-5 4 8 3-2-4-8h8Z" fill="#e9eaed" stroke="#111214" stroke-width="1.5"/></svg></body></html>`;
  await page.route(`${origin}/__readme_capture`, (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto(`${origin}/__readme_capture`);
  await page
    .locator("h1")
    .evaluate((el, text) => (el.textContent = text), title);
  await page
    .locator("header p")
    .evaluate((el, text) => (el.textContent = text), subtitle);
  const app = page.frameLocator("iframe");
  await app.getByRole("button", { name: "Schedule", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Hide the development runtime indicator only; product UI is unchanged.
  await app.locator("body").evaluate((body) => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    body.append(style);
  });
  const directory = resolve(output, name);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  let active = false;
  let running;
  let count = 0;
  const manifest = {
    name,
    title,
    subtitle,
    width: 1440,
    height: 1000,
    fps: 8,
    steps: [],
  };
  const capture = async () => {
    while (active) {
      const started = Date.now();
      try {
        await page.screenshot({
          path: resolve(directory, `${String(count).padStart(5, "0")}.png`),
        });
        count++;
      } catch (error) {
        if (!page.isClosed()) errors.push(error.message);
        break;
      }
      await wait(Math.max(0, 125 - (Date.now() - started)));
    }
  };
  const step = async (text) => {
    await page
      .locator("#step")
      .evaluate((el, value) => (el.textContent = value), text);
    manifest.steps.push({ frame: count, text });
  };
  let pointer = { x: 1250, y: 965 };
  const move = async (x, y, frames = 12) => {
    const from = pointer;
    for (let i = 1; i <= frames; i++) {
      const pos = {
        x: from.x + ((x - from.x) * i) / frames,
        y: from.y + ((y - from.y) * i) / frames,
      };
      await page.mouse.move(pos.x, pos.y);
      await page.locator("#pointer").evaluate((el, value) => {
        el.style.opacity = "1";
        el.style.transform = `translate(${value.x}px,${value.y}px)`;
      }, pos);
      await wait(20);
    }
    pointer = { x, y };
  };
  const point = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw Error("Capture target is not visible");
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await move(x, y);
    return { x, y };
  };
  return {
    page,
    app,
    context,
    errors,
    step,
    point,
    move,
    start() {
      active = true;
      running = capture();
    },
    async click(locator) {
      await point(locator);
      await wait(180);
      await locator.click();
    },
    async finish() {
      await wait(1600);
      active = false;
      await running;
      manifest.frames = count;
      manifest.errors = errors;
      await writeFile(
        resolve(directory, "capture.json"),
        JSON.stringify(manifest, null, 2) + "\n",
      );
      await context.close();
      console.log(JSON.stringify({ name, frames: count, errors }));
    },
  };
}
