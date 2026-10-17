import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Dave, 2026-10-17: no unnecessary subtext. These are the lines he had
// removed after clicking through the app; none may come back. Real data
// (counts, dates, amounts, statuses) and real content are not on this list.
const GONE = [
  "Division III sets its own academic standards on campus",
  "The school's own number, unconverted",
  "A course list is what an NCAA core GPA is calculated from",
  "starts calculating against that division",
  "athletic scholarships are not allowed by NCAA rules",
  "No cost or aid data for this D3 school",
  "Not enough on file to judge",
  "enter GPA for an accurate academic fit",
  "enter stats for an accurate athletic fit",
  "Each sees the program and the schools",
  "every message, visit and offer",
  "No coaches listed for this school yet",
  "separated by semicolons. For example, SS 2027",
  "Private to your organization.",
  "NCAA rules, not this school's choice",
  "No cost of attendance on file, so the financial dimension",
  "Shared with every organization.",
  "The school to keep. Every target",
  "Fundraising counts only those who have given cash",
  "Not counted in anything raised",
  "A negative amount records a refund",
  "Leave anonymous for cash collected",
  "The same reference can only be recorded once",
  "Agendas, minutes and materials",
  "Give/get counts both",
  "For seats added from now on",
  "What Each Access Level Sees",
  "Admins add and edit everything",
  "The link works for 24 hours",
  "It is cropped to a square",
  "Like Head Coach or Board Chair",
  "Cannot be removed while they are the only",
  "Placed athletes are not counted",
  "Who is due for a check-in, who has no advisor",
  "A check-in is due every",
  "The athletes you advise",
  "how many each advises",
  "It is read, the reading suggests its type",
  "Optional. Pick the athlete this is about",
  "Optional. Leave it empty for org-wide documents",
  "A suggestion is not a check that the document is genuine",
  "so it is read for a person, not put on an athlete",
  "That is not enough to change an athlete without a look",
  "Download for the rest",
  "What this document is. Left blank",
  "Five rows, not twelve",
  "A school already on file with the same name is updated",
  "Required on every row",
  "Nothing imports until every row is clean",
  "The coach columns go on your",
  "See exactly what one person sees",
  "Their own profile and nothing else",
  "The program and the schools, read only",
  "The whole organization, as another Admin sees it",
  "You will be its Admin. Invite everyone else",
  "Comma separated, in the app's words",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !p.includes("src/laws/")) out.push(p);
  }
  return out;
}

describe("LAW: removed subtext stays removed", () => {
  // fits.ts holds the matchers that clean old stored rows as they are read; it
  // names the old wording in order to remove it.
  const files = walk("src").filter((p) => !p.endsWith("src/lib/data/fits.ts"));
  const text = files.map((p) => [p, readFileSync(p, "utf8")] as const);
  it.each(GONE)("%s", (line) => {
    const hit = text.find(([, src]) => src.includes(line));
    expect(hit?.[0]).toBeUndefined();
  });
});

describe("LAW: stored fit rows are tidied on every read", () => {
  it("both loaders pass rows through tidyFitRow", () => {
    const src = readFileSync("src/lib/data/fits.ts", "utf8");
    expect(src).toMatch(/\.\.\.tidyFitRow\(rest\)/);
    expect(src).toMatch(/out\.set\([^)]*tidyFitRow\(r\)\)/);
  });
});
