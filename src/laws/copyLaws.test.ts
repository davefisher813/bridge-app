// The words on a screen are part of the kit too.
//
// Dave, 2026-09-20: "make sure everything is title cased as well, I saw
// a bunch that wasn't." Every literal title in the UI (a screen title, a
// section label, a field label, a button, a chip, a stat, an empty
// state) goes through titleCase() and has to come back unchanged.
// Sentences are exempt: anything ending in punctuation or longer than
// six words is a lede or a hint, not a title.
//
// Verified this law bites: changed `title="Approved Courses"` to
// `title="Approved courses"` on the approvals screen, ran
// `npx vitest run copyLaws`, watched it fail naming the file, reverted.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { isTitleLike, titleCase } from "@/lib/copy/titleCase";

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

const UI = walk(SRC).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx?$/.test(f) && (f.includes("/app/") || f.includes("/components/")));
const rel = (f: string) => f.slice(ROOT.length + 1);

// Where a title literal can sit in a page or a component.
const TITLE_ATTR = /\b(title|label|submitLabel)=\{?"([^"\n]+)"\}?/g;
const BUTTON_TEXT = /<(Button|LinkButton|TextLink|Heading)\b[^>]*>\s*([^<{\n][^<{\n]*?)\s*<\//g;
// A title built from a count, in a title slot: title={`All ${n} things to know`}.
const TEMPLATE_TITLE = /\b(?:title|label|submitLabel)=\{`([^`\n]+)`\}/g;
const PENDING_PAIR = /\?\s*"[^"]*\.\.\."\s*:\s*"([^"\n]+)"/g;
const TAB_LABEL = /label:\s*"([^"\n]+)"/g;

describe("LAW: a title is written in Title Case", () => {
  it("every literal screen title, section label, field label, button, chip and stat is Title Case", () => {
    const offenders: string[] = [];
    for (const f of UI) {
      const src = readFileSync(f, "utf8");
      const found: string[] = [];
      for (const m of src.matchAll(TITLE_ATTR)) found.push(m[2]);
      for (const m of src.matchAll(BUTTON_TEXT)) found.push(m[2]);
      for (const m of src.matchAll(PENDING_PAIR)) found.push(m[1]);
      for (const m of src.matchAll(TEMPLATE_TITLE)) found.push(m[1].replace(/\$\{[^}]+\}/g, "1"));
      if (f.endsWith("TabBar.tsx")) for (const m of src.matchAll(TAB_LABEL)) found.push(m[1]);
      for (const text of found) {
        if (!isTitleLike(text)) continue;
        const want = titleCase(text);
        if (want !== text) offenders.push(`${rel(f)}: "${text}" should be "${want}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("titleCase leaves acronyms, small words and sentences alone", () => {
    expect(titleCase("NCAA eligibility")).toBe("NCAA Eligibility");
    expect(titleCase("Add a school's scale")).toBe("Add a School's Scale");
    expect(titleCase("Give/get per seat")).toBe("Give/Get per Seat");
    expect(titleCase("In kind")).toBe("In Kind");
    expect(titleCase("Avg GPA")).toBe("Avg GPA");
    expect(titleCase("F-1 visa status")).toBe("F-1 Visa Status");
    expect(isTitleLike("Not enough on file to calculate this yet.")).toBe(false);
    expect(isTitleLike("Things to Know")).toBe(true);
  });
});
