// What on each screen looks tappable and is not.
//
// Dave, 2026-09-25: "I can't click on anything pretty much ... virtually
// anything should be clickable". This walks the shipped app (FIXTURE_MODE
// build) and reports every paper surface (a row, a card, a stat tile)
// that is not inside a link, a button or a label, with the text it shows,
// so the fix is a list rather than a hunt.
import pw from "playwright";
import { routes } from "./routes.mjs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const report = [];

for (const { name, route, as } of routes) {
  await ctx.clearCookies();
  if (as) await ctx.addCookies([{ name: "fixture_user", value: as, url: BASE }]);
  const res = await page.goto(BASE + route, { waitUntil: "load", timeout: 60000 });
  if (!res || res.status() >= 400) { report.push({ name, dead: [], status: res?.status() }); continue; }
  const dead = await page.evaluate(() => {
    const out = [];
    // A paper surface: the kit's own row, card, stat tile and empty state.
    for (const el of document.querySelectorAll(".bg-paper")) {
      if (el.closest("a, button, label, form")) continue;
      if (el.querySelector("a, button, label, input, select, textarea")) continue;
      const text = (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 70);
      if (!text) continue;
      out.push(text);
    }
    return out;
  });
  if (dead.length) report.push({ name, dead });
}
await browser.close();

let total = 0;
for (const r of report) {
  if (r.status) { console.log(`${r.name}: HTTP ${r.status}`); continue; }
  total += r.dead.length;
  console.log(`\n== ${r.name} (${r.dead.length})`);
  for (const d of r.dead) console.log(`   - ${d}`);
}
console.log(`\nscreens: ${routes.length}  unlinked surfaces: ${total}`);
