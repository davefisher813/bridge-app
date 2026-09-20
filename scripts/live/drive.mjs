// Drive the real app (FIXTURE_MODE build) at phone widths and report anything
// that hangs past the right edge, plus document overflow, per theme.
import pw from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { routes } from "./routes.mjs";
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.env.OUT ?? "/tmp/claude-0/-home-user-bridge-app/df43a9b0-28c3-5d96-b9c8-4da69b4c6e14/scratchpad/live/shots";
mkdirSync(OUT, { recursive: true });
const WIDTHS = (process.env.WIDTHS ?? "320,375,390").split(",").map(Number);
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const SHOTS = process.env.SHOTS === "1";
const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const findings = [];
for (const width of WIDTHS) for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  for (const { name, route } of routes) {
    let res = null; for (let i = 0; i < 2 && !res; i++) { try { res = await page.goto(BASE + route, { waitUntil: "load", timeout: 60000 }); } catch (e) { if (i) throw e; } }
    if (!res || res.status() >= 400) { findings.push({ name, width, theme, kind: "status", detail: res?.status() }); continue; }
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate((w) => {
      const out = { docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth, spills: [], font: getComputedStyle(document.body).fontFamily, title: document.title };
      const sr = (el) => el.closest(".sr-only");
      for (const el of document.querySelectorAll("body *")) {
        if (sr(el)) continue;
        const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;
        const rect = el.getBoundingClientRect(); if (rect.width === 0 && rect.height === 0) continue;
        const tag = el.tagName.toLowerCase();
        const text = (el.innerText || el.value || "").trim().slice(0, 60);
        if (rect.right > w + 0.5 || rect.left < -0.5) out.spills.push({ tag, cls: el.className?.toString().slice(0, 80), text, left: Math.round(rect.left), right: Math.round(rect.right), why: "past frame" });
        if (el.children.length === 0 && text && !el.closest(".truncate")) {
          // Exact: a word whose client rects sit on two lines was broken.
          for (const node of el.childNodes) {
            if (node.nodeType !== 3) continue;
            const s = node.textContent; const re = /\S+/g; let m;
            while ((m = re.exec(s))) {
              if (m[0].length < 4 || /[@\/.\-]/.test(m[0])) continue;
              const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
              const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
              if (tops.size > 1) { out.spills.push({ tag, cls: el.className?.toString().slice(0, 80), text, word: m[0], why: "word broken mid-way" }); break; }
            }
          }
        }
        if (el.scrollWidth > el.clientWidth + 1 && !el.closest(".truncate") && cs.overflowX !== "auto" && cs.overflowX !== "scroll" && ["p","span","h1","h2","h3","div","a","button","label","dt","dd","li","td","th"].includes(tag) && el.children.length === 0 && text)
          out.spills.push({ tag, cls: el.className?.toString().slice(0, 80), text, sw: el.scrollWidth, cw: el.clientWidth, why: "text wider than box" });
      }
      return out;
    }, width);
    if (r.docW > width || r.bodyW > width) findings.push({ name, width, theme, kind: "page scrolls sideways", detail: `${r.docW}/${r.bodyW}` });
    for (const s of r.spills.slice(0, 8)) findings.push({ name, width, theme, kind: s.why, detail: s });
    if (!/Inter/i.test(r.font)) findings.push({ name, width, theme, kind: "font", detail: r.font });
    if (SHOTS) await page.screenshot({ path: `${OUT}/${name}-${width}-${theme}.png`, fullPage: true });
  }
  if (errs.length) findings.push({ width, theme, kind: "pageerror", detail: errs.slice(0, 5) });
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/../findings.json`, JSON.stringify(findings, null, 2));
const byKind = {}; for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
console.log("routes:", routes.length, "findings:", findings.length, byKind);
for (const f of findings.slice(0, 80)) console.log(`${f.name ?? ""} @${f.width} ${f.theme} [${f.kind}]`, typeof f.detail === "object" ? JSON.stringify(f.detail) : f.detail);
