// Every screen of the app preview, both themes, checked for the things
// that look correct in the markup and are wrong on the glass.
//
// The preview is the real pages rendered on fixture data
// (scripts/preview/build_app_preview.ts), so what this inspects is the
// app's own output with the app's own stylesheet. It does not tap. It
// shows every screen in every theme and reads what the browser computed:
//
//   1. Nothing throws, on any screen, in either theme.
//   2. Every class in the markup exists in the stylesheet. A utility
//      Tailwind never generated renders as nothing while looking
//      perfectly correct in the code; that shipped once as black glyphs.
//   3. Every glyph has a drawing.
//   4. No screen scrolls sideways at phone width.
//   5. Text clears WCAG AA against the surface it actually sits on.
//   6. Every link and button is at least 44px tall.
//   7. No screen renders empty.
//   8. Every link points at a route the app has, and every form posts
//      somewhere. A button that goes nowhere is the defect Dave named.
//   9. Nothing hangs past the right edge of a 390 or a 375 screen: text
//      bleeding out of a card is invisible to a scroll-width check when
//      the container clips it.
//
// Run: PREVIEW_OUT_DIR=... node scripts/audit_preview.mjs

import pw from "playwright";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Every route the app serves, as a pattern, read off the filesystem so a
// link to a page that was renamed is caught the day it is renamed.
function routePatterns() {
  const root = join(process.cwd(), "src/app");
  const out = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${rel}/${name}`);
      else if (name === "page.tsx" || name === "route.ts") out.push(rel || "/");
    }
  };
  walk(root, "");
  return out.map((r) => new RegExp("^" + r.replace(/\[[^\]]+\]/g, "[^/]+") + "/?$"));
}
const ROUTES = routePatterns();
const routeExists = (href) => {
  const path = href.split("?")[0].split("#")[0];
  return ROUTES.some((re) => re.test(path));
};

const FILE = `${process.env.PREVIEW_OUT_DIR ?? "/tmp/previews"}/app_preview.html`;

const findings = [];
const note = (where, kind, detail) => findings.push({ where, kind, detail });

const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.setContent(readFileSync(FILE, "utf8"), { waitUntil: "load" });

await page.evaluate(() => {
  window.__rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  window.__lum = (c) => {
    const [r, g, b] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  window.__contrast = (fg, bg) => {
    const a = window.__lum(window.__rgb(fg));
    const b = window.__lum(window.__rgb(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  // The nearest ancestor with a painted background, which is what the
  // text is actually sitting on.
  window.__behind = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  // Every class name the stylesheet defines, read off the rules rather
  // than the source, so a class the build dropped is caught.
  const defined = new Set();
  const collect = (rules) => {
    for (const r of rules) {
      if (r.selectorText) for (const m of r.selectorText.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) defined.add(m[1].replace(/\\(.)/g, "$1"));
      if (r.cssRules) collect(r.cssRules);
    }
  };
  for (const sheet of document.styleSheets) collect(sheet.cssRules);
  window.__defined = defined;
});

const routes = await page.evaluate(() => window.__preview.routes);

// Links and forms are the same in both themes, so they are checked once.
for (const route of routes) {
  await page.evaluate((r) => window.__preview.show(r, false), route);
  const wiring = await page.evaluate(() => {
    const root = document.querySelector(".screen:not([hidden])");
    const hrefs = [...root.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
    const forms = [...root.querySelectorAll("form")].map((f) => ({ action: f.getAttribute("action"), buttons: f.querySelectorAll("button").length }));
    const looseButtons = [...root.querySelectorAll("button")].filter((b) => !b.closest("form") && b.getAttribute("type") !== "button").length;
    return { hrefs, forms, looseButtons };
  });
  for (const h of new Set(wiring.hrefs)) {
    if (!h.startsWith("/")) continue;
    if (!routeExists(h)) note(route, "link to a route the app does not have", h);
  }
  // A server action serialises as a non-empty action attribute; a form
  // with none would post to itself and do nothing.
  for (const f of wiring.forms) {
    if (!f.action) note(route, "form with no action", "");
    if (f.buttons === 0) note(route, "form with no submit button", "");
  }
  if (wiring.looseButtons) note(route, "submit button outside any form", `${wiring.looseButtons}`);
}

for (const width of [390, 375]) {
  await page.setViewportSize({ width, height: 844 });
  for (const route of routes) {
    await page.evaluate((r) => window.__preview.show(r, false), route);
    const spill = await page.evaluate((w) => {
      const root = document.querySelector(".screen:not([hidden])");
      const frame = document.getElementById("frame").getBoundingClientRect();
      const out = [];
      for (const el of root.querySelectorAll("*")) {
        if (el.closest("[hidden]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const label = `${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 24)}"`;
        // Inside a truncating line the text is clipped by design; the
        // inline box still measures wide, so it is not a spill.
        const clipped = el.closest(".truncate") !== null;
        if (!clipped && (r.right > frame.right + 1 || r.left < frame.left - 1)) out.push(`${label} right=${Math.round(r.right - frame.left)}`);
        // Text that paints past its own box. The box stays inside the
        // screen, so only scrollWidth sees it. An ellipsis is deliberate.
        const cs = getComputedStyle(el);
        if (cs.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "auto" && cs.overflowX !== "scroll") out.push(`${label} text ${el.scrollWidth - el.clientWidth}px too wide`);
      }
      return out;
    }, width);
    for (const sp of [...new Set(spill)].slice(0, 3)) note(`${width}px ${route}`, "spills past the screen edge", sp);
  }
}
await page.setViewportSize({ width: 390, height: 844 });

for (const theme of ["light", "dark"]) {
  await page.evaluate((t) => window.__preview.theme(t), theme);
  for (const route of routes) {
    const where = `${theme} ${route}`;
    errors.length = 0;
    const shown = await page.evaluate((r) => window.__preview.show(r, false), route);
    if (!shown) {
      note(where, "could not show", "");
      continue;
    }

    const result = await page.evaluate(() => {
      const root = document.querySelector(".screen:not([hidden])");
      const frame = document.getElementById("frame");
      const out = { unresolved: [], emptyGlyphs: 0, lowContrast: [], smallTargets: [], overflow: 0, empty: false };

      out.empty = root.innerText.trim().length < 8;

      // 2. A class that is not in the stylesheet. Variant and state
      // prefixes are defined with their prefix, so the raw token is
      // checked as written.
      const preview = new Set(["screen"]);
      for (const el of root.querySelectorAll("[class]")) {
        for (const cls of (el.getAttribute("class") || "").split(/\s+/)) {
          if (!cls || preview.has(cls)) continue;
          if (!window.__defined.has(cls)) out.unresolved.push(cls);
        }
      }

      // 3. A glyph with no drawing renders as nothing at all.
      for (const svg of root.querySelectorAll("svg")) {
        if (svg.children.length === 0) out.emptyGlyphs++;
      }

      // 4. Sideways scroll at phone width.
      out.overflow = Math.max(0, frame.scrollWidth - frame.clientWidth);

      // 5. Text you cannot read. Leaf nodes only.
      for (const el of root.querySelectorAll("*")) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || "").trim();
        if (!t) continue;
        if (el.closest("[hidden]") || el.tagName === "OPTION" || el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const size = parseFloat(cs.fontSize);
        const weight = Number(cs.fontWeight) || 400;
        const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
        const ratio = window.__contrast(cs.color, window.__behind(el));
        if (ratio < need) out.lowContrast.push(`${t.slice(0, 26)} ${ratio.toFixed(2)}:1 needs ${need}`);
      }

      // 6. Tap targets: every link and button.
      for (const el of root.querySelectorAll("a[href], button")) {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.height < 44) out.smallTargets.push(`${(el.textContent || "").trim().slice(0, 24)} ${Math.round(r.height)}px`);
      }

      return out;
    });

    if (errors.length) note(where, "console error", errors.slice(0, 2).join(" | "));
    if (result.empty) note(where, "renders empty", "");
    if (result.emptyGlyphs) note(where, "glyph with no drawing", `${result.emptyGlyphs}`);
    if (result.overflow > 1) note(where, "scrolls sideways", `${result.overflow}px`);
    for (const u of [...new Set(result.unresolved)]) note(where, "class not in the stylesheet", u);
    for (const c of [...new Set(result.lowContrast)].slice(0, 4)) note(where, "low contrast", c);
    for (const t of [...new Set(result.smallTargets)].slice(0, 3)) note(where, "tap target under 44px", t);
  }
}

await browser.close();

const byKind = {};
for (const f of findings) (byKind[f.kind] = byKind[f.kind] || []).push(f);

console.log(`\nAudited ${routes.length * 2} screen renders (${routes.length} screens x 2 themes)\n`);

if (findings.length === 0) {
  console.log("No findings.");
} else {
  for (const kind of Object.keys(byKind).sort((a, b) => byKind[b].length - byKind[a].length)) {
    const rows = byKind[kind];
    console.log(`${kind.toUpperCase()}  (${rows.length})`);
    const byDetail = {};
    for (const r of rows) (byDetail[r.detail] = byDetail[r.detail] || []).push(r.where);
    for (const d of Object.keys(byDetail).sort((a, b) => byDetail[b].length - byDetail[a].length)) {
      console.log(`  ${d || "(no detail)"}  x${byDetail[d].length}`);
      console.log(`      e.g. ${byDetail[d][0]}`);
    }
    console.log("");
  }
}
console.log(`${findings.length} findings\n`);
process.exit(findings.length ? 1 : 0);
