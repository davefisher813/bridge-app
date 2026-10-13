// An Athlete login reads columns, not whole rows (migration 0063, role
// audit 2026-10-13). recruiting_targets, target_visits and documents
// carry staff-only columns (a target's notes and coach, a visit's notes,
// a document's reading, whose candidates name other athletes), and
// row-level security cannot hide a column. So the family clause is off
// those tables, and a screen an Athlete login reaches reads them only
// through src/lib/data/familyReads.ts.
//
// Held here: no family screen, no shared screen an Athlete login opens,
// and no loader those screens call selects from the three tables; the
// migration takes the family clause off all three; the loaders return
// none of the staff-only columns.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFixture, IDS, FAMILY_ID } from "@/testing/fixture";
import { createFakeClient } from "@/testing/fakeSupabase";
import { loadFamilyDocuments, loadFamilyTargets, loadFamilyVisits } from "@/lib/data/familyReads";

const SRC = join(process.cwd(), "src");
const STAFF_TABLES = /\.from\(\s*["'](recruiting_targets|target_visits|documents)["']\s*\)/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") || e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

// Every page outside /family that admits the family role, found by
// reading the pages rather than listed, so a new one cannot slip by.
function sharedFamilyPages(): string[] {
  return walk(join(SRC, "app")).filter((f) => !f.includes("/family/") && f.endsWith("page.tsx") && /requireRole\([^)]*"family"/.test(readFileSync(f, "utf8")));
}

describe("LAW: a screen an Athlete login reaches never reads a whole target, visit or document row", () => {
  it("no family screen selects from recruiting_targets, target_visits or documents", () => {
    const offenders = walk(join(SRC, "app", "org", "[slug]", "family")).filter((f) => STAFF_TABLES.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no shared screen that admits the family role selects from them either", () => {
    const pages = sharedFamilyPages();
    expect(pages.length).toBeGreaterThanOrEqual(4);
    const offenders = pages.filter((f) => STAFF_TABLES.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("nor do the loaders those screens call (eligibility, the assignment upload's duplicate check)", () => {
    for (const f of ["lib/data/loadEligibility.ts", "lib/data/family.ts", "lib/data/familyReads.ts"]) {
      expect(STAFF_TABLES.test(readFileSync(join(SRC, f), "utf8")), f).toBe(false);
    }
    const submit = readFileSync(join(SRC, "lib/actions/assignments.ts"), "utf8");
    expect(submit).toContain("findFamilyTwin(");
  });

  it("the migration takes the family clause off all three read policies", () => {
    const sql = ["0063_family_reads_columns_not_rows.sql", "0065_family_reads_policies.sql"].map((f) => readFileSync(join(process.cwd(), "migrations", f), "utf8")).join("\n").replace(/--.*$/gm, "");
    for (const t of ["documents", "recruiting_targets", "target_visits"]) {
      const policy = sql.match(new RegExp(`create policy ${t}_read on ${t} for select\\s+using \\(([^;]*)\\);`));
      expect(policy, t).not.toBeNull();
      expect(policy![1]).not.toContain("_family_athlete_ids");
    }
    // And the functions do not hand the staff-only columns back.
    for (const col of ["notes", "coach_name", "candidates", "extracted", "triage", "applied_changes", "storage_paths"]) {
      expect(sql).not.toMatch(new RegExp(`returns table \\([^)]*\\b${col}\\b`));
    }
  });
});

describe("the family loaders return what the screens show and nothing else", () => {
  it("targets carry status, offer and school, never notes or the coach", async () => {
    const data = buildFixture();
    const orgId = data.athletes!.find((a) => a.id === IDS.athlete)!.org_id as string;
    const client = (createFakeClient(data, { userId: FAMILY_ID }) as never);
    const rows = await loadFamilyTargets(client, orgId, [IDS.athlete]);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).not.toHaveProperty("notes");
      expect(r).not.toHaveProperty("coach_name");
      expect(r.schools.name).toBeTruthy();
    }
    const visits = await loadFamilyVisits(client, orgId, rows.map((r) => r.id));
    for (const v of visits) expect(v).not.toHaveProperty("notes");
  });

  it("documents carry the file and its state, never the reading", async () => {
    const data = buildFixture();
    const orgId = data.athletes!.find((a) => a.id === IDS.athlete)!.org_id as string;
    const rows = await loadFamilyDocuments((createFakeClient(data, { userId: FAMILY_ID }) as never), orgId, IDS.athlete);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) for (const col of ["candidates", "extracted", "triage", "applied_changes", "storage_paths", "failure_reason"]) expect(r).not.toHaveProperty(col);
  });

  it("a login linked to nobody gets nothing", async () => {
    const data = buildFixture();
    const orgId = data.athletes!.find((a) => a.id === IDS.athlete)!.org_id as string;
    const stranger = (createFakeClient(data, { userId: "nobody" }) as never);
    expect(await loadFamilyTargets(stranger, orgId, [IDS.athlete])).toEqual([]);
    expect(await loadFamilyDocuments(stranger, orgId, IDS.athlete)).toEqual([]);
  });
});
