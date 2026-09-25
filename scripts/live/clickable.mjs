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
    // The kit's three record surfaces, which it tags itself: a row, a
    // card and a stat tile. A note, a notice, an empty state and a
    // field are not records and are meant to sit still, so they carry
    // no tag and are never counted here.
    for (const el of document.querySelectorAll("[data-kit]")) {
      if (el.closest("a, button, label, form")) continue;
      if (el.querySelector("a, button, label, input, select, textarea")) continue;
      const text = (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 70);
      if (!text) continue;
      out.push(`${el.getAttribute("data-kit")}: ${text}`);
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

// The rest are records with nowhere to go: a family has no dimension
// screen, a grant has no page of its own, a logged call is already on
// the log. The count per screen is kept as a baseline so a screen that
// grows a new dead row fails this, while the ones that are deliberately
// static do not have to be listed one by one.
const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
const BASELINE = "qa/clickable-baseline.json";
const counts = Object.fromEntries(report.filter((r) => !r.status).map((r) => [r.name, r.dead.length]));
if (process.env.UPDATE_BASELINE === "1" || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify({ note: "Per screen, how many kit rows, cards and stat tiles go nowhere. A screen may only ever go down. Rebuild with UPDATE_BASELINE=1.", counts }, null, 2) + "\n");
  console.log(`wrote ${BASELINE}`);
} else {
  const base = JSON.parse(readFileSync(BASELINE, "utf8")).counts ?? {};
  const grew = Object.entries(counts).filter(([name, n]) => n > (base[name] ?? 0));
  if (grew.length) {
    console.log("");
    for (const [name, n] of grew) console.log(`REGRESSION ${name}: ${base[name] ?? 0} -> ${n} surfaces that go nowhere`);
    process.exit(1);
  }
  const shrank = Object.entries(counts).filter(([name, n]) => n < (base[name] ?? 0));
  if (shrank.length) console.log(`${shrank.length} screen(s) improved since the baseline. Rerun with UPDATE_BASELINE=1 to lock it in.`);
  console.log("no screen grew a surface that goes nowhere");
}
