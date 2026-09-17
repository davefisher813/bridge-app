import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// THE STYLING LAWS, AS TESTS. These encode docs/STYLING_CATALOG.md and the
// two-tier color system in src/app/globals.css. See README.md in this
// folder for the pattern.
//
// The catalog is built on solid saturated fills and tints. Both are the
// easy way to ship text nobody can read in a dark UI, so the rules that
// keep them legible are the ones worth making un-decayable.

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ALL = walk(SRC);
const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);
const SOURCES = ALL.filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(SRC.length + 1);

const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const tw = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");

// Every quoted string in a file: double, single and template. className
// values live in one of these three, so a fill and its foreground being in
// the SAME literal is what proves they were written as a pair.
function stringLiterals(source: string): string[] {
  const out: string[] = [];
  const re = /"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const v = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("LAW: a fill never appears without its paired foreground", () => {
  // A fill is only legible with its own -on token over it: white on
  // systemRed is 3.4:1 and fails outright. Pairing them in the same
  // className string is what makes the pair impossible to half-apply.
  //
  // Verified this law bites: added `const x = "bg-solid-offer text-white";`
  // to StatusPill.tsx, ran `npx vitest run stylingLaws`, watched it fail
  // naming that file, reverted.
  it("every bg-solid-X is written alongside text-solid-X-on", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      for (const lit of stringLiterals(read(f))) {
        for (const m of lit.matchAll(/\bbg-solid-([a-z]+)\b/g)) {
          if (!lit.includes(`text-solid-${m[1]}-on`)) {
            violations.push(`${rel(f)}: "bg-solid-${m[1]}" without its -on`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // Tints have the same failure mode, just quieter: a hue on its own tint
  // is around 3.2:1.
  //
  // Verified this law bites: changed a StatTile class to
  // "bg-tint-contact text-info", watched it fail naming catalog.tsx,
  // reverted.
  it("every bg-tint-X is written alongside text-tint-X-on", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      for (const lit of stringLiterals(read(f))) {
        for (const m of lit.matchAll(/\bbg-tint-([a-z]+)\b/g)) {
          if (!lit.includes(`text-tint-${m[1]}-on`)) {
            violations.push(`${rel(f)}: "bg-tint-${m[1]}" without its -on`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("LAW: colors come from tokens, never raw hex", () => {
  // Every color is a token so an org's branding can replace it
  // (orgs.branding, see docs/DESIGN_SYSTEM.md) and so a contrast-checked
  // pair cannot be quietly swapped for an unchecked literal. globals.css
  // is where the literals are allowed to live.
  //
  // Verified this law bites: added `const c = "#ff0000";` to
  // StatusPill.tsx, watched it fail, reverted.
  it("no raw hex color in any component or page", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      const hits = read(f).match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g);
      if (hits) violations.push(`${rel(f)}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(violations).toEqual([]);
  });
});

describe("LAW: the palette is Apple's, exactly", () => {
  // Tier 1 is Apple's published iOS system colors and nothing else. If a
  // primitive drifts, every role derived from it drifts with it, silently,
  // and the app stops being the thing Dave picked. These are the dark
  // values, which is what the forced-dark org screens resolve to.
  //
  // Verified this law bites: changed --ios-mint to #63E6E3 in globals.css,
  // watched it fail naming mint, reverted.
  const APPLE_DARK: Record<string, string> = {
    red: "#FF453A",
    orange: "#FF9F0A",
    yellow: "#FFD60A",
    green: "#30D158",
    mint: "#63E6E2",
    teal: "#40CBE0",
    cyan: "#64D2FF",
    blue: "#0A84FF",
    indigo: "#5E5CE6",
    purple: "#BF5AF2",
    pink: "#FF375F",
    brown: "#AC8E68",
    gray: "#8E8E93",
  };

  it("every --ios-* primitive is the published Apple value", () => {
    const wrong: string[] = [];
    for (const [name, expected] of Object.entries(APPLE_DARK)) {
      const m = css.match(new RegExp(`--ios-${name}:\\s*(#[0-9a-fA-F]{6})`));
      if (!m) wrong.push(`--ios-${name} missing`);
      else if (m[1].toUpperCase() !== expected.toUpperCase()) {
        wrong.push(`--ios-${name} is ${m[1]}, Apple's is ${expected}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("LAW: the role token set stays complete and legible", () => {
  const declaredSolid = [...new Set([...css.matchAll(/--solid-([a-z]+):/g)].map((m) => m[1]))].filter(
    (n) => !n.endsWith("-on")
  );
  // Only the bodies of the [data-theme="dark"] blocks. Slicing from the
  // first one to the end of the file would sweep in the :root declarations
  // below it and make the both-themes check pass vacuously, which is
  // exactly what it did on the first attempt.
  const darkBlock = [...css.matchAll(/\[data-theme="dark"\]\s*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");

  // The roles the app actually maps statuses and scores onto. A role that
  // exists in statusHue.ts but has no token renders as nothing at all.
  //
  // Verified this law bites: deleted the --solid-visit pair from
  // globals.css, watched it fail naming visit, restored it.
  it("every role has a solid pair and a tint pair in both themes", () => {
    const roles = [
      "target", "contact", "visit", "offer", "committed",
      "high", "mid", "low",
      "time", "people", "place",
      "accent", "danger", "neutral",
    ];
    const problems: string[] = [];
    for (const r of roles) {
      if (!css.includes(`--solid-${r}:`)) problems.push(`--solid-${r} missing`);
      if (!css.includes(`--solid-${r}-on:`)) problems.push(`--solid-${r}-on missing`);
      if (!css.includes(`--tint-${r}:`)) problems.push(`--tint-${r} missing`);
      if (!css.includes(`--tint-${r}-on:`)) problems.push(`--tint-${r}-on missing`);
      if (!darkBlock.includes(`--tint-${r}:`)) problems.push(`--tint-${r} missing in dark`);
      if (!darkBlock.includes(`--tint-${r}-on:`)) problems.push(`--tint-${r}-on missing in dark`);
      if (!tw.includes(`"${r}"`)) problems.push(`${r} not in the Tailwind role list`);
    }
    expect(problems).toEqual([]);
  });

  // Every solid/foreground pair actually clears AA at the sizes the
  // catalog renders them (11px bold pills, below the large-text
  // threshold). This checks the shipped VALUES, not just that both tokens
  // exist, so a hand-edit that skips the generator gets caught.
  //
  // Verified this law bites: hand-edited --solid-offer-on to #b07a00 in
  // globals.css, watched it fail naming offer at 2.53:1, reverted.
  it("every solid pair clears 4.5:1", () => {
    const bad: string[] = [];
    for (const r of declaredSolid) {
      const bg = css.match(new RegExp(`--solid-${r}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      const fg = css.match(new RegExp(`--solid-${r}-on:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      if (!bg || !fg) continue;
      const c = contrast(bg, fg);
      if (c < 4.5) bad.push(`--solid-${r}: ${bg} on ${fg} = ${c.toFixed(2)}:1`);
    }
    expect(bad).toEqual([]);
  });

  // A fill also has to read as a shape against the surface behind it, or
  // a chip becomes floating text. This replaced a hairline-border special
  // case for the old neutral fill, which sat at 1.87:1 against the page.
  // Apple's systemGray is light enough not to need it.
  //
  // Verified this law bites: set --solid-neutral to #1b1b1d in
  // globals.css, watched it fail at 1.09:1, reverted.
  it("every solid fill reads as a shape on the dark page", () => {
    const PAGE_DARK = "#0c0c0c";
    const bad: string[] = [];
    for (const r of declaredSolid) {
      const bg = css.match(new RegExp(`--solid-${r}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      if (!bg) continue;
      const c = contrast(bg, PAGE_DARK);
      if (c < 3) bad.push(`--solid-${r}: ${bg} is ${c.toFixed(2)}:1 against the page`);
    }
    expect(bad).toEqual([]);
  });
});

// ── The type glyphs ──────────────────────────────────────────────────
// Added 2026-09-16, when the coloured left rail was replaced by a type
// icon (Dave: "let's use icons like Jarvis does to identify categories
// instead of the color highlight").
describe("LAW: there is one icon set and everything reads it", () => {
  const ICONS = JSON.parse(readFileSync(join(SRC, "components/rowIcons.json"), "utf8")) as Record<string, string>;

  it("every icon has a real drawing", () => {
    const empty = Object.entries(ICONS)
      .filter(([k]) => k !== "_comment")
      .filter(([, v]) => typeof v !== "string" || !/<(path|circle|rect)/.test(v))
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  // Copies of a shared map drifted three times in one sitting earlier in
  // this project, which is why the generators parse the source. A
  // generator that inlines the drawings instead is the same bug coming
  // back, and it would be invisible: the prototype would keep rendering
  // whatever it was given.
  it("no generator keeps its own copy of the drawings", () => {
    const generators = ["scripts/build_prototype.py", "scripts/build_preview.py", "scripts/build_testbench.py"];
    const offenders: string[] = [];
    for (const g of generators) {
      let src = "";
      try {
        src = readFileSync(join(process.cwd(), g), "utf8");
      } catch {
        continue;
      }
      // A path command string from the set, sitting in a generator, means
      // somebody pasted the map in rather than reading the file.
      for (const [name, d] of Object.entries(ICONS)) {
        if (name === "_comment") continue;
        const firstPath = String(d).match(/d='([^']{12,})'/)?.[1];
        if (firstPath && src.includes(firstPath)) offenders.push(`${g} inlines "${name}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // A glyph is only useful if it renders in the colour its role asks for,
  // and a Tailwind class that was never generated renders as body text
  // while looking perfectly correct in the markup. That shipped once.
  it("every role has a foreground class and the set is complete", () => {
    const hue = readFileSync(join(SRC, "components/statusHue.ts"), "utf8");
    const roles = [...hue.matchAll(/^\s+\|\s+"(\w+)"$/gm)].map((m) => m[1]);
    // [\s\S] rather than the s flag: tsconfig targets es2017 here.
    const fgBody = hue.match(/export const FG: Record<Role, string> = \{([\s\S]*?)\n\};/)?.[1] ?? "";
    const missing = roles.filter((r) => !new RegExp(`\\b${r}:\\s*"text-ios-`).test(fgBody));
    expect(roles.length).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });
});

// ── Findings from the 2026-09-17 audit ───────────────────────────────
// scripts/audit_prototype.mjs renders every screen in both themes and
// both organizations and inspects what the browser computed. These three
// are what it found. They are laws now so the audit does not have to be
// the only thing standing between them and a rerun.
describe("LAW: a solid fill is never used as a text colour", () => {
  // A solid fill exists to be painted behind its paired -on foreground.
  // Used as text on a paper surface it bypasses the pairing entirely:
  // --solid-accent reads 4.65:1 on white and 3.74:1 on the dark card, so
  // it passed in light and failed in dark, in fourteen places, for weeks.
  it("no bare text-solid-* class outside the SOLID pairing map", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC).concat([join(ROOT, "scripts/prototype_app.js")])) {
      if (/statusHue\.ts$|formStyles\.ts$|stylingLaws\.test\.ts$/.test(file)) continue;
      if (!/\.(tsx?|js)$/.test(file)) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/text-solid-([a-z]+)(?!-on)\b/g)) offenders.push(`${file.replace(ROOT, "")}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("LAW: muted text clears AA on the page, not just on a card", () => {
  // The old --muted cleared 4.5:1 against --paper and missed it against
  // --bg, and muted text on the page background is most of the app:
  // every section header, every back link, every date.
  it("light muted reads on both surfaces", () => {
    const light = css.slice(css.indexOf(":root {"), css.indexOf('[data-theme="dark"]'));
    const muted = light.match(/--muted:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const bg = light.match(/--bg:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const paper = light.match(/--paper:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(muted && bg && paper).toBeTruthy();
    expect(Number(contrast(muted!, bg!).toFixed(2))).toBeGreaterThanOrEqual(4.5);
    expect(Number(contrast(muted!, paper!).toFixed(2))).toBeGreaterThanOrEqual(4.5);
  });

  it("dark muted reads on both surfaces", () => {
    const dark = css.slice(css.indexOf('[data-theme="dark"]'));
    const muted = dark.match(/--muted:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const bg = dark.match(/--bg:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const paper = dark.match(/--paper:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(muted && bg && paper).toBeTruthy();
    expect(Number(contrast(muted!, bg!).toFixed(2))).toBeGreaterThanOrEqual(4.5);
    expect(Number(contrast(muted!, paper!).toFixed(2))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("LAW: a row you can tap is at least a thumb tall", () => {
  // 44px is Apple's minimum. The back link was 15px on every screen in
  // the app, which is the control people use most.
  it("the shared card and every back link carry the minimum", () => {
    // Both branches of RailCard, not just one: the stripe form and the
    // glyph form are separate return statements and only one of them
    // carrying the minimum is the bug this law is for.
    const catalog = readFileSync(join(SRC, "components/catalog.tsx"), "utf8");
    const railCard = catalog.slice(catalog.indexOf("export function RailCard"), catalog.indexOf("export function Avatar"));
    const returns = railCard.match(/min-h-\[44px\]/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(2);

    const thin: string[] = [];
    for (const file of walk(join(SRC, "app"))) {
      if (!file.endsWith(".tsx")) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes("&larr;")) continue;
      // The back link's own className, identified by the text style it
      // has always used.
      for (const m of src.matchAll(/className="([^"]*text-\[13px\] font-bold text-muted[^"]*)"/g)) {
        if (!m[1].includes("min-h-[44px]")) thin.push(file.replace(ROOT, ""));
      }
    }
    expect(thin).toEqual([]);
  });
});

describe("LAW: a pill is a glyph and a label, never a coloured block", () => {
  // Dave, 2026-09-17, looking at the roster: "make sure there's no color
  // highlights on the pills, we said we were going with icons, make sure
  // it's consistent throughout."
  //
  // The failure mode this guards is not ugliness, it is drift. The type
  // glyph landed on September 16 and the fills stayed on the pills, so
  // for a day the app had two ways of saying the same thing on the same
  // row. The next person adding a status chip will reach for TINT[role]
  // because that is what a status chip looked like for two weeks.
  //
  // Verified this law bites: put `bg-tint-offer` back on the seat status
  // chip in board-governance/[id]/page.tsx, ran
  // `npx vitest run stylingLaws`, watched it fail naming that file,
  // reverted.
  const PILL_SHAPE = /rounded-full/;

  it("no rounded-full element carries a tint or solid fill", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      // statusHue.ts is where the maps are DEFINED. The definitions are
      // not uses, and TINT and SOLID both still have legitimate callers:
      // the primary action button is a solid fill, which is the whole
      // reason red was reserved for it.
      if (rel(f) === "components/statusHue.ts") continue;
      for (const lit of stringLiterals(read(f))) {
        if (!PILL_SHAPE.test(lit)) continue;
        if (/\bbg-(tint|solid)-[a-z]+\b/.test(lit)) {
          violations.push(`${rel(f)}: a rounded-full element with a fill: "${lit.slice(0, 60)}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // The interpolated form of the same thing, which the literal check
  // above cannot see: `${TINT[role]}` inside a className is a fill whose
  // name is only known at runtime.
  it("no component interpolates TINT or SOLID into a pill", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      if (rel(f) === "components/statusHue.ts") continue;
      const src = read(f);
      for (const m of src.matchAll(/`[^`]*rounded-full[^`]*`/g)) {
        if (/\$\{\s*(TINT|SOLID)\b/.test(m[0])) {
          violations.push(`${rel(f)}: a pill taking its fill from a map: "${m[0].slice(0, 70)}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // The other half of the rule, and the one the audit caught the hard
  // way. Dropping the fill means the colour moves onto the mark, and a
  // glyph and a word need different tokens to stay legible: FG is the raw
  // iOS hue, which is 2.02:1 as text on paper. Coloured TEXT takes
  // TEXT_ON.
  //
  // Checked by shape rather than by name, since a className is a string:
  // an FG lookup in the same literal as a text-size class is type wearing
  // a glyph colour.
  it("no text size is set in the same class string as an FG colour", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      if (rel(f) === "components/statusHue.ts" || rel(f) === "components/RowGlyph.tsx") continue;
      const src = read(f);
      for (const m of src.matchAll(/`[^`]*`/g)) {
        if (/text-\[[\d.]+px\]/.test(m[0]) && /\$\{\s*FG\[/.test(m[0])) {
          violations.push(`${rel(f)}: text sized and coloured with FG: "${m[0].slice(0, 70)}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
