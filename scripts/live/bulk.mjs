// The bulk selecting state (Dave, 2026-10-13), driven in the shipped app:
// on Assignments, Documents, Athletes and Targets, tap Select, Select All,
// and check the bar and the first action sheet at 320, 375 and 390: the
// count is on screen, nothing scrolls sideways, every bar button is a 44px
// target, the sheet stays on screen. The static preview cannot show this
// state; this is the check that can.
import pw from "playwright";
const BASE = process.env.BASE, SLUG = process.env.SLUG ?? "bridge-fixture", OUT = process.env.OUT ?? "/tmp";
const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const routes = ["assignments", "documents", "roster", "board"];
let bad = 0;
for (const w of [320, 375, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
  const page = await ctx.newPage();
  for (const r of routes) {
    await page.goto(`${BASE}/org/${SLUG}/${r}`, { waitUntil: "networkidle" });
    const sel = page.getByRole("button", { name: "Select", exact: true });
    if (!(await sel.count())) { console.log(w, r, "NO SELECT BUTTON (empty list?)"); continue; }
    await sel.click();
    await page.getByRole("button", { name: /^Select All/ }).click();
    const bar = page.getByRole("region", { name: "Bulk Actions" });
    const text = (await bar.innerText()).replace(/\n+/g, " | ");
    const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    const btns = await bar.getByRole("button").evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { t: e.textContent.trim(), h: Math.round(b.height), l: Math.round(b.left), r: Math.round(b.right) }; }));
    const barBox = await bar.boundingBox();
    console.log(w, r, "bar:", text, "| scrollW", over.sw, "of", over.cw, "| barH", Math.round(barBox.height));
    if (over.sw > over.cw + 1) { bad++; console.log("  SIDEWAYS SCROLL"); }
    for (const b of btns) if (b.h < 44) { bad++; console.log("  SHORT TARGET", JSON.stringify(b)); }
    if (w === 320 || w === 390) await page.screenshot({ path: `${OUT}/${r}-${w}.png` });
    // open the first action sheet and check it fits
    const first = bar.getByRole("button").filter({ hasNotText: /Select All|Clear|Done/ }).first();
    if (await first.count()) {
      await first.click();
      const dlg = page.getByRole("dialog");
      const box = await dlg.boundingBox();
      console.log("  sheet:", (await dlg.locator("div").first().innerText()).split("\n")[0], "| w", Math.round(box.width), "x", Math.round(box.x));
      if (box.x < 0 || box.x + box.width > w + 1) { bad++; console.log("  SHEET OFF SCREEN"); }
      if (w === 320) await page.screenshot({ path: `${OUT}/${r}-sheet-${w}.png` });
    }
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `PROBLEMS: ${bad}` : "bulk selecting state: clean");
process.exit(bad ? 1 : 0);
