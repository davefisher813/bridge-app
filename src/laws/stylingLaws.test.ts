import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// THE STYLING LAWS, AS TESTS. These encode docs/STYLING_CATALOG.md,
// locked 2026-09-15 after Dave picked all fourteen component treatments
// from the visual catalog. See README.md in this folder for the pattern.
//
// The catalog is built almost entirely on solid saturated fills. A solid
// fill is the easiest way in a dark UI to end up with text nobody can
// read, so the rules that keep a fill legible are the ones worth making
// un-decayable.

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

// Every quoted string in a file: double, single and template. className
// values live in one of these three, so a fill and its foreground being
// in the SAME literal is what proves they were written as a pair.
function stringLiterals(source: string): string[] {
  const out: string[] = [];
  const re = /"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

describe("LAW: a solid fill never appears without its paired foreground", () => {
  // docs/STYLING_CATALOG.md, "The solid fill rule". bg-solid-info is only
  // legible with text-solid-info-on over it; white on the raw --accent is
  // 3.4:1 and fails outright. Pairing them in the same className string is
  // what makes the pair impossible to half-apply.
  //
  // Verified this law bites: added
  // `const x = "bg-solid-info text-white";` to StatusPill.tsx, ran
  // `npx vitest run stylingLaws`, watched it fail naming that file,
  // reverted.
  it("every bg-solid-X is written alongside text-solid-X-on", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      for (const lit of stringLiterals(read(f))) {
        const fills = [...lit.matchAll(/\bbg-solid-([a-z]+)\b/g)].map((m) => m[1]);
        for (const hue of fills) {
          if (!lit.includes(`text-solid-${hue}-on`)) {
            violations.push(`${rel(f)}: "bg-solid-${hue}" without "text-solid-${hue}-on"`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // The neutral fill sits at 1.87:1 against the dark app background, close
  // by design, so it is the one fill that cannot read as a shape on its
  // own and always carries a hairline.
  //
  // Verified this law bites: removed `border border-line` from
  // DEFAULT_STYLE in StatusPill.tsx, ran the test, watched it fail,
  // restored it.
  // Tints have the same failure mode as fills, just quieter: the hue on
  // its own tint is about 3.2:1. So a tint is paired exactly like a fill.
  //
  // Verified this law bites: changed a StatTile class to
  // "bg-tint-info text-info", ran `npx vitest run stylingLaws`, watched it
  // fail naming catalog.tsx, reverted.
  it("every bg-tint-X is written alongside text-tint-X-on", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      for (const lit of stringLiterals(read(f))) {
        const tints = [...lit.matchAll(/\bbg-tint-([a-z]+)\b/g)].map((m) => m[1]);
        for (const hue of tints) {
          if (!lit.includes(`text-tint-${hue}-on`)) {
            violations.push(`${rel(f)}: "bg-tint-${hue}" without "text-tint-${hue}-on"`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("bg-solid-neutral always carries a border-line hairline", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      for (const lit of stringLiterals(read(f))) {
        if (lit.includes("bg-solid-neutral") && !lit.includes("border-line")) {
          violations.push(`${rel(f)}: neutral fill with no hairline`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("LAW: colors come from tokens, never raw hex", () => {
  // Every color in the catalog is a token so that an org's branding can
  // replace it (orgs.branding, see docs/DESIGN_SYSTEM.md) and so that a
  // contrast-checked pair cannot be quietly swapped for an unchecked
  // literal. globals.css is where the literals are allowed to live.
  //
  // Verified this law bites: added `const c = "#ff0000";` to
  // StatusPill.tsx, ran the test, watched it fail, reverted.
  it("no raw hex color in any component or page", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      const hits = read(f).match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g);
      if (hits) violations.push(`${rel(f)}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(violations).toEqual([]);
  });
});

describe("LAW: the solid token set stays complete", () => {
  const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
  const tw = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");

  const declared = [...css.matchAll(/--solid-([a-z]+):/g)].map((m) => m[1]);
  const fills = [...new Set(declared.filter((n) => !n.endsWith("-on")))];
  const tintsDeclared = [...new Set([...css.matchAll(/--tint-([a-z]+):/g)].map((m) => m[1]))];

  // A fill without its foreground is a fill someone will pair with
  // whatever looks right that day, which is how white on a 3.4:1 red
  // becomes normal.
  //
  // Verified this law bites: deleted the --solid-place-on declaration
  // from globals.css, ran `npx vitest run stylingLaws`, watched this one
  // case fail, restored it.
  it("every declared fill has a matching -on foreground", () => {
    const missing = fills.filter((n) => !css.includes(`--solid-${n}-on:`));
    expect(missing).toEqual([]);
  });

  // Verified this law bites: removed the `place` entry from the solid
  // palette in tailwind.config.ts, ran the test, watched it fail,
  // restored it.
  it("every declared fill and foreground is exposed to Tailwind", () => {
    const missing: string[] = [];
    for (const n of fills) {
      if (!tw.includes(`var(--solid-${n})`)) missing.push(`--solid-${n}`);
      if (!tw.includes(`var(--solid-${n}-on)`)) missing.push(`--solid-${n}-on`);
    }
    expect(missing).toEqual([]);
  });

  // Verified this law bites: deleted the --solid-people pair from
  // globals.css, ran the test, watched it fail, restored it.
  it("declares the seven pairs the locked catalog specifies", () => {
    expect(fills.sort()).toEqual(
      ["accent", "info", "neutral", "people", "place", "success", "time"]
    );
  });

  // A tint is defined against the paper behind it, and that paper flips
  // between themes, so unlike the solid pairs a tint MUST be declared in
  // both. A tint declared only once is a tint that is wrong in one theme.
  //
  // Verified this law bites: removed the --tint-info override from the
  // dark block in globals.css, ran the test, watched it fail, restored it.
  it("every tint has a paired foreground, in both themes, and reaches Tailwind", () => {
    const tintFills = tintsDeclared.filter((n) => !n.endsWith("-on"));
    expect(tintFills.sort()).toEqual(["accent", "info", "neutral", "success"]);

    // Only the bodies of the [data-theme="dark"] blocks. Slicing from the
    // first one to the end of the file would sweep in the :root tint
    // declarations below it and make this check pass vacuously, which is
    // exactly what it did on the first attempt.
    const darkBlock = [...css.matchAll(/\[data-theme="dark"\]\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .join("\n");
    const problems: string[] = [];
    for (const n of tintFills) {
      if (!css.includes(`--tint-${n}-on:`)) problems.push(`--tint-${n} has no -on`);
      if (!darkBlock.includes(`--tint-${n}:`)) problems.push(`--tint-${n} missing in dark`);
      if (!darkBlock.includes(`--tint-${n}-on:`)) problems.push(`--tint-${n}-on missing in dark`);
      if (!tw.includes(`var(--tint-${n})`)) problems.push(`--tint-${n} not in Tailwind`);
      if (!tw.includes(`var(--tint-${n}-on)`)) problems.push(`--tint-${n}-on not in Tailwind`);
    }
    expect(problems).toEqual([]);
  });
});
