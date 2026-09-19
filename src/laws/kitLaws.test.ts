// The kit is the only way to draw. Everything here is a rule Dave set in
// the clean slate audit on 2026-09-19, after a day on the live app:
// "visuals are not uniform, borders and spacing clearly have not been
// established". The scale is four text sizes, one radius, one spacing
// step (tailwind.config.ts); the kit (src/components/kit/) is the only
// place they are composed; a page uses layout and the kit and nothing
// else. Each law was planted, watched to fail, and reverted.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

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

const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.includes("/testing/") || f.includes("/laws/");
const SOURCES = walk(SRC).filter((f) => /\.(tsx?)$/.test(f) && !isTest(f));
const UI = SOURCES.filter((f) => f.includes("/app/") || f.includes("/components/"));
const KIT = (f: string) => f.includes("/components/kit/");
const PAGES = UI.filter((f) => f.includes("/app/") && /\/(page|layout|error|not-found|loading|global-error)\.tsx$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(ROOT.length + 1);

// Every class string in a file. Both plain literals and template
// literals, since a className is often assembled from either.
function classStrings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/className=\{?\s*(["'`])([\s\S]*?)\1/g)) out.push(m[2]);
  for (const m of src.matchAll(/const\s+\w+\s*=\s*(["'`])([^"'`]*\b(?:rounded|text-|px-|py-|p-)\b[^"'`]*)\1/g)) out.push(m[2]);
  return out;
}

describe("LAW: the scale is the whole vocabulary", () => {
  // Verified this law bites: put `text-[15px]` on the Field input in the
  // kit, watched it fail naming kit/index.tsx, reverted.
  it("no arbitrary value anywhere in the UI", () => {
    const offenders: string[] = [];
    for (const f of UI) {
      for (const cls of classStrings(read(f))) {
        for (const m of cls.matchAll(/\b[a-z-]+-\[[^\]]+\]/g)) {
          // The one allowed escape, and it lives in the kit: the accent
          // colour on a native checkbox has no utility class.
          if (KIT(f) && m[0] === "accent-[var(--accent)]") continue;
          offenders.push(`${rel(f)}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("tailwind's own defaults are replaced, not extended", () => {
    const tw = read(join(ROOT, "tailwind.config.ts"));
    const keys = (block: string) => [...(tw.match(new RegExp(`const ${block}[^=]*= \\{([\\s\\S]*?)\\n\\};`))?.[1] ?? "").matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    expect(keys("fontSize")).toEqual(["label", "body", "heading", "title"]);
    expect(keys("borderRadius")).toEqual(["none", "DEFAULT", "full"]);
    expect(tw).toMatch(/theme:\s*\{\s*fontSize,\s*spacing,\s*borderRadius,/);
  });

  // Verified this law bites: added `text-sm` to a Section label, watched
  // it fail, reverted.
  it("no size class outside the four", () => {
    const offenders: string[] = [];
    for (const f of UI) {
      for (const cls of classStrings(read(f))) {
        for (const m of cls.matchAll(/\btext-(xs|sm|base|lg|xl|\dxl|\d+)\b/g)) offenders.push(`${rel(f)}: ${m[0]}`);
        for (const m of cls.matchAll(/\brounded-(sm|md|lg|xl|\dxl|t|b|l|r|tl|tr|bl|br)\b/g)) offenders.push(`${rel(f)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("LAW: a page composes the kit, it does not style", () => {
  // The layout classes a page may use. Everything else, spacing, radius,
  // type, colour, belongs to a kit component. Verified this law bites:
  // put `px-4 py-3 rounded bg-paper` on a div in the members page,
  // watched it fail naming the page and the classes, reverted.
  const ALLOWED = /^(flex|inline-flex|grid|block|hidden|contents|flex-1|flex-col|flex-row|flex-wrap|flex-shrink-0|grid-cols-[1-4]|col-span-[1-4]|items-(start|center|end|baseline|stretch)|justify-(start|center|end|between)|self-(start|end|center)|gap-(1|2|3|4|6)|min-w-0|w-full|text-(left|center|right)|truncate|tabular-nums|sr-only|order-(1|2|first|last)|max-w-md|mx-auto)$/;

  it("page files use only layout classes", () => {
    const offenders: string[] = [];
    for (const f of PAGES) {
      if (f.endsWith("global-error.tsx")) continue; // carries its own html and body by necessity
      for (const cls of classStrings(read(f))) {
        for (const token of cls.split(/\s+/).filter(Boolean)) {
          if (token.startsWith("${")) continue;
          if (!ALLOWED.test(token)) offenders.push(`${rel(f)}: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Verified this law bites: wrote a bare `<input` into the members
  // invite page, watched it fail, reverted.
  it("every input, select and textarea is a kit field", () => {
    const offenders: string[] = [];
    for (const f of UI) {
      if (KIT(f)) continue;
      for (const m of read(f).matchAll(/<(input|select|textarea)\b/g)) offenders.push(`${rel(f)}: <${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no raw button or anchor with its own styling outside the kit", () => {
    const offenders: string[] = [];
    for (const f of UI) {
      if (KIT(f)) continue;
      for (const m of read(f).matchAll(/<(button|a)\b[^>]*className=/g)) offenders.push(`${rel(f)}: styled <${m[1]}>`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("LAW: the screen holds still", () => {
  // The old tab bar was `sticky` and rode Safari's own bar as it
  // collapsed. The kit's bar is fixed with the safe area accounted for.
  it("nothing is sticky, and only the kit is fixed", () => {
    const offenders: string[] = [];
    for (const f of UI) {
      const src = read(f);
      if (/\bsticky\b/.test(src)) offenders.push(`${rel(f)}: sticky`);
      if (!KIT(f) && /\bfixed\b/.test(src) && /className/.test(src) && /\bfixed\b/.test(classStrings(src).join(" "))) offenders.push(`${rel(f)}: fixed`);
    }
    expect(offenders).toEqual([]);
  });

  // Every input the kit renders is body size, which is 16px, which is
  // the size below which iPhone Safari zooms the page on focus.
  it("every kit field is body size and at least 48px tall", () => {
    const kit = read(join(SRC, "components/kit/index.tsx"));
    expect(kit).toMatch(/FIELD_BASE = "[^"]*\btext-body\b/);
    expect(kit).toMatch(/<input[^>]*min-h-12/);
    expect(kit).toMatch(/<select[^>]*min-h-12/);
    expect(kit).toMatch(/<textarea[^>]*min-h-24/);
  });

  it("the theme follows the phone, nobody forces one", () => {
    const offenders: string[] = [];
    for (const f of UI) {
      if (/data-theme=/.test(read(f))) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
    expect(read(join(SRC, "app/layout.tsx"))).toMatch(/prefers-color-scheme: dark/);
  });
});
