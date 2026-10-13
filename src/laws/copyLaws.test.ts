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

  // The regexes above only read a literal sitting alone in a title slot.
  // A title picked by a condition (title={gap === 0 ? "Last contact
  // today" : ...}), a fallback (title={coachName || "No coach on file"})
  // and a `label:` in a list of groups all reached the screen in
  // sentence case (sweep, 2026-10-13). These read them too.
  //
  // Verified this bites: put "Last contact today" back on the
  // communications page, then separately "On the list" back in the
  // approvals groups, ran `npx vitest run copyLaws`, watched each fail,
  // reverted.
  //
  // Not yet swept: screens another pass owns (documents, fundraising,
  // board governance) still carry sentence-case titles this check finds.
  // Each comes off this list when its screen is fixed; nothing new goes
  // on it.
  const NOT_YET_SWEPT: string[] = [];
  it("a title chosen by a condition or a fallback, and every label: in a list, is Title Case", () => {
    const offenders: string[] = [];
    for (const f of UI.filter((f) => !NOT_YET_SWEPT.some((p) => rel(f).startsWith(p)))) {
      const src = readFileSync(f, "utf8");
      const found: string[] = [];
      for (const line of src.split("\n")) {
        if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) continue;
        for (const m of line.matchAll(/\b(?:title|label|submitLabel)=\{/g)) {
          // The expression up to the next prop or the end of the tag. A
          // template literal is TEMPLATE_TITLE's, and the words picked
          // inside one ("a" or "an") are pieces of it, not titles.
          const rest = line.slice(m.index! + m[0].length);
          if (rest.startsWith("`")) continue;
          const end = rest.search(/\}\s+[A-Za-z]+=|\}\s*\/?>|\}\s*$/);
          const expr = end === -1 ? rest : rest.slice(0, end);
          // A literal only counts as a title when it is a branch or a
          // fallback; one being compared against (x === "none") is a key.
          for (const s of expr.matchAll(/(?:\?\??|:|\|\|)\s*"([^"\n]+)"/g)) found.push(s[1]);
        }
        for (const s of line.matchAll(/\blabel:\s*"([^"\n]+)"/g)) found.push(s[1]);
      }
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

// Dave, 2026-09-27: "Change family to a more generic term." The login
// tied to one athlete is called an Athlete login on every screen, not a
// Family one. The enum value, the /family routes and the code names stay
// `family`; only the words a person reads changed. "Family Budget per
// Year" and "what the family pays" are about the household's money, not
// the login, and are left alone.
//
// Verified this law bites: put `family: "Family"` back in the access
// names (ACCESS_LEVEL in src/lib/org/roleLabels.ts), then separately `title="Invite Family"` back on the
// athlete page, ran `npx vitest run copyLaws`, watched each fail, reverted.
describe("LAW: the login tied to one athlete is called Athlete, not Family", () => {
  it("the default access name for the family role is Athlete", async () => {
    const { ACCESS_LEVEL, labelForRole } = await import("@/lib/org/roleLabels");
    expect(ACCESS_LEVEL.family).toBe("Athlete");
    expect(labelForRole("family")).toBe("Athlete");
  });

  it("no screen, component or action names the login Family", () => {
    const LOGIN_AS_FAMILY = /Invite Family|Family Logins?\b|family logins?\b|family sign-in|Family access|"Family"/;
    const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && (f.includes("/app/") || f.includes("/components/") || f.includes("/lib/actions/") || f.includes("/lib/org/") || f.includes("/lib/copy/")));
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // Comments explain the code to the next engineer; the rule is
          // about what reaches the screen.
          if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
          if (LOGIN_AS_FAMILY.test(line)) offenders.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

// The same rule for a file the athlete login sent in: it is an Athlete
// Upload. The assignment screen said Family Upload after the login was
// renamed (sweep, 2026-10-13); the regex above looked for the login's
// name, not the upload's.
//
// Verified this bites: put "Family Upload" back on the assignment
// screen, ran `npx vitest run copyLaws`, watched it fail, reverted.
describe("LAW: a file the athlete login sent is an Athlete Upload, not a Family one", () => {
  // The documents screens belong to another pass and still say Family
  // Upload; they come off this list when that pass lands. Nothing new
  // goes on it.
  const NOT_YET_SWEPT: string[] = [];
  it("no screen or component outside that list says Family Upload", () => {
    const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && (f.includes("/app/") || f.includes("/components/")) && !NOT_YET_SWEPT.some((p) => rel(f).startsWith(p)));
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
          if (/Family Upload/i.test(line)) offenders.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
