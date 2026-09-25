// Every link on every screen, followed.
//
// "Make sure it's clickable and taking you to the correct places"
// (Dave, 2026-09-25). A row that links to a route nobody built, or to a
// record the signed-in person may not open, is worse than a row that
// does nothing: it looks like the app broke. So each link is collected
// with the login of the screen it was found on, and then followed.
import pw from "playwright";
import { routes } from "./routes.mjs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

// link -> the screen and login it was found on
const found = new Map();
for (const { name, route, as } of routes) {
  await ctx.clearCookies();
  if (as) await ctx.addCookies([{ name: "fixture_user", value: as, url: BASE }]);
  const res = await page.goto(BASE + route, { waitUntil: "load", timeout: 60000 });
  if (!res || res.status() >= 400) continue;
  const hrefs = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));
  for (const h of hrefs) {
    if (!h || !h.startsWith("/")) continue; // mailto and tel are for the phone to answer
    const key = `${as ?? ""}|${h}`;
    if (!found.has(key)) found.set(key, { href: h, as, from: name });
  }
}

const broken = [];
for (const { href, as, from } of found.values()) {
  await ctx.clearCookies();
  if (as) await ctx.addCookies([{ name: "fixture_user", value: as, url: BASE }]);
  // A file the browser downloads rather than renders (the CSV template)
  // is checked with a plain request instead of a navigation.
  if (/\.(csv|pdf|png|jpg|webmanifest|ico)$/i.test(href)) {
    const r = await ctx.request.get(BASE + href);
    if (!r.ok()) broken.push({ href, from, as: as ?? "owner", status: r.status(), landed: href, why: `HTTP ${r.status()}` });
    continue;
  }
  const res = await page.goto(BASE + href, { waitUntil: "domcontentloaded", timeout: 60000 });
  const status = res?.status() ?? 0;
  // A redirect to the sign-in or to the unauthorized screen means the
  // link was shown to somebody who may not follow it, which is the same
  // bug as a 404 from where they are standing.
  const landed = new URL(page.url()).pathname;
  const refused = landed === "/unauthorized" || landed === "/login";
  const text = await page.evaluate(() => document.body.innerText.slice(0, 80));
  const broke = /Something broke on this screen/i.test(text);
  if (status >= 400 || refused || broke) broken.push({ href, from, as: as ?? "owner", status, landed, why: broke ? "error screen" : refused ? "refused" : `HTTP ${status}` });
}
await browser.close();

for (const b of broken) console.log(`BROKEN ${b.from} -> ${b.href} (${b.why}) as ${b.as}`);
console.log(`\nlinks followed: ${found.size}  broken: ${broken.length}`);
process.exit(broken.length ? 1 : 0);
