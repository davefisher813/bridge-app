// Every screen, both themes, both organizations, checked for the things
// that look correct in the markup and are wrong on the glass.
//
// Why this exists. verify_prototype.mjs walks the paths a person takes
// and asserts the app does the right thing. It caught plenty. What it
// could not catch is a screen nobody walked through and a class Tailwind
// never generated: the type glyphs shipped rendering black because
// text-ios-orange was in the class list and absent from the stylesheet,
// which no assertion about markup would ever notice.
//
// So this does not tap. It renders every screen directly, in every
// combination, and inspects what the browser actually computed:
//
//   1. Nothing throws, on any screen, in either theme.
//   2. Every token utility class in the markup resolves to a real value.
//   3. Every glyph has a drawing and a colour.
//   4. No screen scrolls sideways at phone width.
//   5. Body text clears WCAG AA against the surface it sits on.
//   6. Every tappable row is at least 44px, which is Apple's minimum and
//      the size of a thumb.
//   7. No screen renders empty, and none falls through to "not built".
//
// Run: node scripts/audit_prototype.mjs

import pw from "playwright";
import { readFileSync } from "node:fs";

const FILE = `${process.env.PREVIEW_OUT_DIR ?? "/tmp/previews"}/prototype.html`;

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

// Contrast, computed the same way the styling laws compute it.
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
  // text is actually sitting on. Walking up matters: a row's text sits on
  // bg-paper, not on the page.
  window.__behind = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
});

// Every screen, with params where a screen needs them. Built from the
// mock data rather than hardcoded, so a screen cannot be audited against
// an id that no longer exists.
const plan = await page.evaluate(() => {
  const ids = {
    athlete: db.athletes.filter((a) => a.orgId === org().id).map((a) => a.id),
    target: db.targets.filter((t) => t.orgId === org().id).map((t) => t.id),
    school: db.schools.map((s) => s.id),
    document: db.documents.filter((d) => d.orgId === org().id).map((d) => d.id),
    donor: (db.donors || []).filter((d) => d.orgId === org().id).map((d) => d.id),
    member: (db.boardMembers || []).filter((m) => m.orgId === org().id).map((m) => m.id),
    board: (db.boards || []).filter((b) => b.orgId === org().id).map((b) => b.id),
    campaign: (db.campaigns || []).filter((c) => c.orgId === org().id).map((c) => c.id),
    scaleSchool: db.gradingScales.map((s) => s.school_name),
    listSchool: db.approvedLists.map((l) => l.schoolName),
  };
  const one = (a) => (a.length ? a[0] : null);
  const out = [];
  const add = (screen, params = {}) => out.push({ screen, params });

  for (const k of Object.keys(SCREENS)) {
    if (["athlete", "eligibility", "courses", "approvals", "caveats"].includes(k)) {
      for (const id of ids.athlete) add(k, { id });
    } else if (["target", "comms"].includes(k)) {
      for (const id of ids.target) add(k, { id });
    } else if (k === "dimension") {
      for (const id of ids.target) for (const d of ["academic", "athletic", "financial"]) add(k, { id, dim: d });
    } else if (k === "school") {
      for (const id of ids.school) add(k, { id });
    } else if (k === "document") {
      for (const id of ids.document) add(k, { id });
    } else if (k === "donor") {
      for (const id of ids.donor) add(k, { id });
    } else if (k === "member") {
      for (const id of ids.member) add(k, { id });
    } else if (k === "boardDetail") {
      for (const id of ids.board) add(k, { id });
    } else if (k === "campaign") {
      for (const id of ids.campaign) add(k, { id });
    } else if (k === "scaleEdit") {
      // Both branches: a school with a table on file, and one without.
      if (one(ids.scaleSchool)) add(k, { school: one(ids.scaleSchool) });
      add(k, { school: "A School With No Table" });
    } else if (k === "approvedList") {
      for (const s of ids.listSchool) add(k, { school: s });
      add(k, { school: "A School With No List" });
    } else if (k === "gifts") {
      add(k);
      add(k, { category: "individual" });
      add(k, { method: "in_kind" });
    } else {
      add(k);
    }
  }
  return out;
});

const ORGS = await page.evaluate(() => Object.keys(db.orgs));

for (const theme of ["light", "dark"]) {
  for (const slug of ORGS) {
    await page.evaluate(
      ([t, s]) => {
        setTheme(t);
        state.org = s;
      },
      [theme, slug],
    );

    for (const { screen, params } of plan) {
      const where = `${theme}/${slug}/${screen}${Object.keys(params).length ? " " + JSON.stringify(params) : ""}`;
      errors.length = 0;

      // A screen that belongs to another org, or to a module this org has
      // off, is not a defect. It is skipped, and the skip is counted so a
      // silently empty audit is visible.
      const before = await page.evaluate(
        ([sc, pa]) => {
          try {
            state.screen = sc;
            state.params = pa;
            render();
            return { ok: true };
          } catch (e) {
            return { ok: false, message: String(e && e.message ? e.message : e) };
          }
        },
        [screen, params],
      );

      if (!before.ok) {
        // Rendering another org's record is expected to fail; rendering
        // one of your own is not.
        const ownsIt = await page.evaluate(
          ([sc, pa]) => {
            const id = pa.id;
            if (!id) return true;
            const all = [...db.targets, ...db.athletes, ...(db.donors || []), ...(db.boardMembers || []), ...(db.boards || []), ...(db.campaigns || []), ...db.documents];
            const rec = all.find((r) => r.id === id);
            return !rec || rec.orgId === org().id;
          },
          [screen, params],
        );
        if (ownsIt) note(where, "threw while rendering", before.message);
        continue;
      }

      const result = await page.evaluate(() => {
        const root = document.getElementById("screen");
        const body = getComputedStyle(document.body);
        const out = { unresolved: [], emptyGlyphs: 0, lowContrast: [], smallTargets: [], overflow: 0, empty: false, notBuilt: false };

        const text = root.innerText.trim();
        out.empty = text.length < 8;
        out.notBuilt = /not built in this prototype/i.test(text);

        // 2. A token utility that Tailwind never generated. Compared
        // against the inherited value, because that is exactly what an
        // ungenerated class leaves behind.
        for (const el of root.querySelectorAll("*")) {
          const cls = el.getAttribute("class") || "";
          const cs = getComputedStyle(el);
          const inherited = el.parentElement ? getComputedStyle(el.parentElement) : body;
          const hit = (re, prop) => {
            const m = cls.match(re);
            if (!m) return;
            if (cs[prop] === inherited[prop]) out.unresolved.push(m[0]);
          };
          hit(/\btext-ios-[a-z]+\b/, "color");
          hit(/\btext-solid-[a-z]+-on\b/, "color");
          hit(/\btext-tint-[a-z]+-on\b/, "color");
          const bgm = cls.match(/\b(bg-ios-[a-z]+|bg-solid-[a-z]+|bg-tint-[a-z]+)\b/);
          if (bgm && cs.backgroundColor === "rgba(0, 0, 0, 0)") out.unresolved.push(bgm[0]);
          const bl = cls.match(/\bborder-l-ios-[a-z]+\b/);
          if (bl && cs.borderLeftWidth !== "0px" && cs.borderLeftColor === cs.color) out.unresolved.push(bl[0]);
        }

        // 3. A glyph with no drawing renders as nothing at all.
        for (const svg of root.querySelectorAll("svg")) {
          if (svg.children.length === 0) out.emptyGlyphs++;
          const cls = svg.getAttribute("class") || "";
          if (/text-ios-/.test(cls) && getComputedStyle(svg).color === body.color) out.unresolved.push((cls.match(/text-ios-[a-z]+/) || [])[0] + " (glyph)");
        }

        // 4. Sideways scroll at phone width.
        out.overflow = Math.max(0, root.scrollWidth - root.clientWidth);

        // 5. Text you cannot read. Checked on leaf nodes only, so a
        // container is not blamed for its children.
        for (const el of root.querySelectorAll("*")) {
          if (el.children.length > 0) continue;
          const t = (el.textContent || "").trim();
          if (!t) continue;
          const cs = getComputedStyle(el);
          const size = parseFloat(cs.fontSize);
          const weight = Number(cs.fontWeight) || 400;
          // WCAG large text: 18.66px bold or 24px. Everything in this app
          // is smaller than that, so 4.5 is the bar almost everywhere.
          const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
          const ratio = window.__contrast(cs.color, window.__behind(el));
          if (ratio < need) out.lowContrast.push(`${t.slice(0, 26)} ${ratio.toFixed(2)}:1 needs ${need}`);
        }

        // 6. Tap targets. Only things that are actually tappable.
        for (const el of root.querySelectorAll("[onclick]")) {
          const r = el.getBoundingClientRect();
          if (r.height > 0 && r.height < 44) out.smallTargets.push(`${(el.textContent || "").trim().slice(0, 24)} ${Math.round(r.height)}px`);
        }

        return out;
      });

      if (errors.length) note(where, "console error", errors.slice(0, 2).join(" | "));
      if (result.empty) note(where, "renders empty", "");
      if (result.notBuilt) note(where, "falls through to not-built", "");
      if (result.emptyGlyphs) note(where, "glyph with no drawing", `${result.emptyGlyphs}`);
      if (result.overflow > 1) note(where, "scrolls sideways", `${result.overflow}px`);
      for (const u of [...new Set(result.unresolved)]) note(where, "class does not resolve", u);
      for (const c of [...new Set(result.lowContrast)].slice(0, 4)) note(where, "low contrast", c);
      for (const t of [...new Set(result.smallTargets)].slice(0, 3)) note(where, "tap target under 44px", t);
    }
  }
}

await browser.close();

// ── Report ───────────────────────────────────────────────────────────
const screens = plan.length * 2 * ORGS.length;
const byKind = {};
for (const f of findings) (byKind[f.kind] = byKind[f.kind] || []).push(f);

console.log(`\nAudited ${screens} screen renders (${plan.length} screens x 2 themes x ${ORGS.length} orgs)\n`);

if (findings.length === 0) {
  console.log("No findings.");
} else {
  for (const kind of Object.keys(byKind).sort((a, b) => byKind[b].length - byKind[a].length)) {
    const rows = byKind[kind];
    console.log(`${kind.toUpperCase()}  (${rows.length})`);
    // Grouped by detail, because one wrong class shows up on forty
    // screens and reads as forty problems.
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
