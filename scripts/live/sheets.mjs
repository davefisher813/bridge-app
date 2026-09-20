// Contact sheets: four full-page screenshots side by side, so a whole
// width/theme pass can be eyeballed in a dozen images instead of sixty.
import pw from "playwright";
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
const DIR = process.env.OUT ?? "/tmp/claude-0/-home-user-bridge-app/df43a9b0-28c3-5d96-b9c8-4da69b4c6e14/scratchpad/live/shots";
const SHEETS = `${DIR}/../sheets`; mkdirSync(SHEETS, { recursive: true });
const suffix = process.env.SUFFIX ?? "320-dark";
const files = readdirSync(DIR).filter((f) => f.endsWith(`-${suffix}.png`)).sort();
const browser = await pw.chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const per = 4; let n = 0;
for (let i = 0; i < files.length; i += per) {
  const chunk = files.slice(i, i + per);
  const html = `<html><body style="margin:0;background:#888;display:flex;gap:8px;align-items:flex-start;padding:8px">${chunk.map((f) => `<div style="width:340px"><div style="font:12px sans-serif;background:#fff;padding:2px 4px">${f}</div><img src="file://${DIR}/${f}" style="width:340px;display:block"></div>`).join("")}</body></html>`;
  writeFileSync(`${SHEETS}/tmp.html`, html);
  await page.goto(`file://${SHEETS}/tmp.html`);
  await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode())));
  await page.screenshot({ path: `${SHEETS}/${suffix}-${String(++n).padStart(2, "0")}.png`, fullPage: true });
}
await browser.close();
console.log(n, "sheets for", suffix);
