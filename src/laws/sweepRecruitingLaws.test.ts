// The recruiting sweep (2026-10-13): nineteen defects across the fit
// engine's transfer timing, the target writes, the calendar, and the
// words on the recruiting screens. Each law below failed against the
// code as it was and passes against the fix; every one was planted back
// and watched to fail before this was committed.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { errorsOf, form, run } from "@/testing/actionHarness";
import { scoreEligibility } from "@/lib/fit/transfer";
import type { Athlete, School, TransferWindow } from "@/lib/fit/types";
import { divisionForTargets } from "@/lib/data/loadEligibility";
import { daysSinceCheckin } from "@/lib/checkins";
import { calendarDaysBetween, inDaysText, orgToday } from "@/lib/datetime/today";
import { longDate } from "@/lib/copy/dates";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let revalidated: string[] = [];
let searchParams = new URLSearchParams();

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error("NEXT_REDIRECT:" + url);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => searchParams,
  usePathname: () => "/",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  revalidated = [];
  searchParams = new URLSearchParams();
});

const SRC = join(process.cwd(), "src");
const source = (p: string) => readFileSync(join(SRC, p), "utf8");

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never);
}
const params = (v: Record<string, string>) => Promise.resolve(v);

const fitUpserts = () => writes.filter((w) => w.table === "athlete_school_fits" && w.op === "upsert").flatMap((w) => w.rows as { athlete_id: string; org_id: string }[]);
const daysFrom = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// 1, 2. Transfer timing: every window of the season, and a season typed
// the way the form asks for it.

describe("LAW: a portal entry is judged against every window of its season, and a season like 2026-27 is read", () => {
  const athlete = (portalEntryDate: string): Athlete => ({
    id: "a",
    orgId: "o",
    recruitType: "transfer_4to4",
    name: "Test",
    sport: "football",
    detail: { kind: "transfer", currentSchool: "Old U", eligibilityYearsRemaining: 2, transferCount: 1, portalEntryDate },
  });
  const school: School = { id: "s", name: "New U", division: "D1", sportsSponsored: ["football"] };
  const windows: TransferWindow[] = [
    { sport: "football", division: "D1", seasonYear: "2026-27", windowLabel: "Winter", opensOn: "2026-12-08", closesOn: "2026-12-28" },
    { sport: "football", division: "D1", seasonYear: "2026-27", windowLabel: "Spring", opensOn: "2027-04-16", closesOn: "2027-04-25" },
  ];

  it("an entry in the second window of the season passes (matches[0] used to veto it)", () => {
    const r = scoreEligibility(athlete("2027-04-20"), school, windows);
    expect(r.veto).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/within the Spring window/);
  });

  it("an entry in the first window passes, and one between the two is vetoed naming both", () => {
    expect(scoreEligibility(athlete("2026-12-10"), school, windows).veto).toBe(false);
    const between = scoreEligibility(athlete("2027-02-01"), school, windows);
    expect(between.veto).toBe(true);
    expect(between.warnings.join(" ")).toMatch(/Winter[\s\S]*Spring/);
  });

  it("a season typed 2026-27 is found for an entry in December 2026 (string equality on the year missed it)", () => {
    const r = scoreEligibility(athlete("2026-12-10"), school, [windows[0]!]);
    expect(r.reasons.join(" ")).toMatch(/falls within/);
    expect(r.warnings.join(" ")).not.toMatch(/not on file/);
  });

  it("with no window for the entry's season, timing is unverified, never vetoed", () => {
    const r = scoreEligibility(athlete("2028-12-10"), school, windows);
    expect(r.veto).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/not on file/);
  });
});

// ---------------------------------------------------------------------------
// 3. A window written rescores the stored matches of every org.

describe("LAW: adding, correcting or removing a transfer window rescores every org's stored matches", () => {
  const scoredOrgs = () => new Set(data.athletes!.filter((a) => !a.deleted_at && (a.status === "Active" || a.status === "Transferring")).map((a) => a.org_id as string));

  it("adding one", async () => {
    const { createTransferWindow } = await import("@/lib/actions/transferWindows");
    const expected = scoredOrgs();
    const r = await run(() => createTransferWindow(ORG_WITH_MODULES, { errors: {} }, form({ sport: "Baseball", division: "D1", seasonYear: "2026-27", windowLabel: "Winter", opensOn: "2026-12-01", closesOn: "2026-12-15", sourceUrl: "https://ncaa.org/windows" })));
    expect(r.redirect).toMatch(/notice=/);
    expect(new Set(fitUpserts().map((u) => u.org_id))).toEqual(expected);
    expect(expected.size).toBeGreaterThan(1);
  });

  it("correcting one", async () => {
    const { updateTransferWindow } = await import("@/lib/actions/transferWindows");
    const expected = scoredOrgs();
    await run(() => updateTransferWindow(ORG_WITH_MODULES, "tw1", { errors: {} }, form({ sport: "Baseball", division: "D2", seasonYear: "2026", windowLabel: "Fixture window", opensOn: "2026-12-02", closesOn: "2026-12-16", sourceUrl: "https://example.test/fixture-window" })));
    expect(new Set(fitUpserts().map((u) => u.org_id))).toEqual(expected);
  });

  it("removing one", async () => {
    const { deleteTransferWindow } = await import("@/lib/actions/transferWindows");
    const expected = scoredOrgs();
    await run(() => deleteTransferWindow(ORG_WITH_MODULES, "tw1"));
    expect(new Set(fitUpserts().map((u) => u.org_id))).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// 4, 5, 7. Target edits.

describe("LAW: a target edit rescores whoever it touched, refuses a second commitment, and clears a stale closed_from", () => {
  it("a target moved to another school rescores the athlete", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.schoolD3, status: "Offer" })));
    expect(fitUpserts().some((u) => u.athlete_id === IDS.athlete)).toBe(true);
  });

  it("a target handed to another athlete rescores both and refreshes the old athlete's page", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athleteTransferring, schoolId: IDS.school, status: "Offer" })));
    const rescored = new Set(fitUpserts().map((u) => u.athlete_id));
    expect(rescored.has(IDS.athlete)).toBe(true);
    expect(rescored.has(IDS.athleteTransferring)).toBe(true);
    expect(revalidated).toContain(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}`);
  });

  it("a second Committed target for the same athlete is refused on the status field, on create and on edit", async () => {
    const { createTarget, updateTarget } = await import("@/lib/actions/targets");
    const created = await run(() => createTarget(ORG_WITH_MODULES, { errors: {} }, form({ athleteId: IDS.athleteCommitted, schoolId: "00000000-0000-0000-0000-0000000000d9", status: "Committed" })));
    expect(errorsOf(created.state).status).toMatch(/already Committed/);
    const edited = await run(() => updateTarget(ORG_WITH_MODULES, IDS.targetToClose, { errors: {} }, form({ athleteId: IDS.athleteCommitted, schoolId: IDS.schoolD3, status: "Committed" })));
    expect(errorsOf(edited.state).status).toMatch(/already Committed/);
    expect(writes.filter((w) => w.table === "recruiting_targets")).toEqual([]);
  });

  it("re-saving the one Committed target is not refused", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    const r = await run(() => updateTarget(ORG_WITH_MODULES, IDS.targetCommitted, { errors: {} }, form({ athleteId: IDS.athleteCommitted, schoolId: IDS.school, status: "Committed" })));
    expect(r.redirect).toContain(`/board/${IDS.targetCommitted}`);
  });

  it("a status changed by hand writes closed_from null", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Visit" })));
    const w = writes.find((w) => w.table === "recruiting_targets" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === IDS.target));
    expect(w?.rows[0]).toHaveProperty("closed_from", null);
  });
});

// ---------------------------------------------------------------------------
// 6. Eligibility's division.

describe("LAW: eligibility is judged against a school the athlete is aiming for", () => {
  const t = (status: string, division: string) => ({ status, schools: { division } });
  it("a Not Interested target never sets the bar", () => {
    expect(divisionForTargets([t("Not Interested", "D1"), t("Target", "D3")])).toBe("D3");
    expect(divisionForTargets([t("Not Interested", "D1")])).toBe("");
  });
  it("a Committed target's division wins outright", () => {
    expect(divisionForTargets([t("Committed", "D2"), t("Offer", "D1")])).toBe("D2");
  });
  it("the loader reads each target's status, so the rule has something to judge", () => {
    // Read through family_targets (migration 0063), which returns each
    // target's status and its school's division.
    expect(source("lib/data/loadEligibility.ts")).toMatch(/loadFamilyTargets\(/);
    expect(source("lib/data/familyReads.ts")).toMatch(/status: string;[\s\S]*division: string/);
    expect(source("lib/data/loadEligibility.ts")).toMatch(/divisionForTargets\(/);
  });
});

// ---------------------------------------------------------------------------
// 8, 9, 10. The calendar is the org's.

describe("LAW: days and dates are the org's calendar, not the server's clock", () => {
  const evening = new Date("2026-10-02T01:30:00.000Z"); // Oct 1, 9:30pm in New York

  it("a check-in logged yesterday is 1 day ago at 9:30pm, and one logged today is 0", () => {
    expect(daysSinceCheckin("2026-09-30", evening)).toBe(1);
    expect(daysSinceCheckin("2026-10-01", evening)).toBe(0);
    expect(daysSinceCheckin("2026-09-17", evening)).toBe(14);
  });

  it("calendar days count dates, and a meta line says 1 day", () => {
    expect(calendarDaysBetween("2026-10-01", "2026-10-02")).toBe(1);
    expect(calendarDaysBetween("2026-10-01", "2026-09-30")).toBe(-1);
    expect(inDaysText(1)).toBe("in 1 day");
    expect(inDaysText(12)).toBe("in 12 days");
    expect(inDaysText(0)).toBe("today");
  });

  it("a timestamp prints as the org's day; a calendar date prints as itself", () => {
    expect(longDate("2026-10-02T01:30:00.000Z")).toBe("Oct 1, 2026");
    expect(longDate("2026-10-02")).toBe("Oct 2, 2026");
  });

  it("no screen prints a timestamp by slicing it to its UTC date", () => {
    const files = ["components/ActivityRows.tsx", "app/org/[slug]/roster/[id]/page.tsx", "app/org/[slug]/roster/[id]/assignments/[assignmentId]/page.tsx", "lib/data/reopen.ts"];
    for (const f of files) expect(source(f)).not.toMatch(/longDate\([^)]*\.slice\(0,\s*10\)\)/);
  });

  it("Today shows a window opening tomorrow as in 1 day, and no visit on a closed target", async () => {
    const today = orgToday();
    data.transfer_windows!.push({ id: "tw-soon", sport: "baseball", division: "D1", season_year: "2026-27", window_label: "Soon", opens_on: daysFrom(today, 1), closes_on: daysFrom(today, 10), source_url: "https://example.test", notes: null });
    // A visit on a target still being worked, and one on a target closed
    // to Not Interested by the enrollment.
    data.recruiting_targets!.find((t) => t.id === IDS.target)!.visit_date = daysFrom(today, 3);
    data.recruiting_targets!.find((t) => t.id === IDS.targetEnrolledClosed)!.visit_date = daysFrom(today, 2);
    const html = await render("@/app/org/[slug]/page", { params: params({ slug: ORG_WITH_MODULES }) });
    expect(html).toMatch(/Soon · in 1 day</);
    expect(html).not.toMatch(/in 1 days/);
    expect(html).toContain(`/board/${IDS.target}`);
    expect(html).not.toContain(`/board/${IDS.targetEnrolledClosed}"`);
  });
});

// ---------------------------------------------------------------------------
// 11, 12, 13, 14. Advisors and check-ins.

describe("LAW: the advisor and check-in screens say what is true", () => {
  it("the empty states point at the Assign button the athlete page actually has", () => {
    expect(source("app/org/[slug]/roster/[id]/page.tsx")).toMatch(/trigger=\{advisor \? "Change" : "Assign"\}/);
    for (const f of ["app/org/[slug]/mine/page.tsx", "app/org/[slug]/roster/page.tsx"]) {
      expect(source(f)).not.toMatch(/Edit screen/);
      expect(source(f)).toMatch(/Open an athlete and use Assign under Advisor\./);
    }
  });

  it("?advisor=none with nobody unadvised says so, not Add the first one", async () => {
    for (const a of data.athletes!) a.advisor_id = OWNER_ID;
    const html = await render("@/app/org/[slug]/roster/page", { params: params({ slug: ORG_WITH_MODULES }), searchParams: params({ advisor: "none" }) });
    expect(html).toMatch(/Every athlete still being recruited has an advisor\./);
    expect(html).not.toMatch(/Add the first one below/);
  });

  it("the check-in log claims a place on Today's reminders only when Today would show them", async () => {
    const old = daysFrom(orgToday(), -30);
    data.athlete_checkins = [
      { id: "ck-old", org_id: data.orgs![0]!.id, athlete_id: IDS.athleteCommitted, advisor_id: OWNER_ID, kind: "call", occurred_on: old, notes: null, photo_path: null, created_at: `${old}T12:00:00.000Z` },
      { id: "ck-old2", org_id: data.orgs![0]!.id, athlete_id: IDS.athlete, advisor_id: OWNER_ID, kind: "call", occurred_on: old, notes: null, photo_path: null, created_at: `${old}T12:00:00.000Z` },
    ];
    // Placed, so not on the reminders, though overdue.
    data.athletes!.find((a) => a.id === IDS.athleteCommitted)!.advisor_id = OWNER_ID;
    const placed = await render("@/app/org/[slug]/roster/[id]/checkins/page", { params: params({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) });
    expect(placed).not.toMatch(/on the reminders on Today/);
    // Advised and recruiting: on them.
    const active = await render("@/app/org/[slug]/roster/[id]/checkins/page", { params: params({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(active).toMatch(/on the reminders on Today/);
  });

  it("a placed athlete's page never says a check-in is due", async () => {
    const old = daysFrom(orgToday(), -30);
    data.athlete_checkins = [{ id: "ck-old", org_id: data.orgs![0]!.id, athlete_id: IDS.athleteCommitted, advisor_id: OWNER_ID, kind: "call", occurred_on: old, notes: null, photo_path: null, created_at: `${old}T12:00:00.000Z` }];
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: params({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }), searchParams: params({}) });
    expect(html).toMatch(/last on/);
    expect(html).not.toMatch(/due for one/);
  });

  it("the Advisors count reads the effective status, the way the Advisor Hub and the roster do", async () => {
    const { loadAdvisorCounts } = await import("@/lib/data/staff");
    const org = data.orgs![0]!.id as string;
    const client = createFakeClient(data, { userId: OWNER_ID });
    const before = (await loadAdvisorCounts(client as never, org)).unassigned;
    // Active on their own row, with a Committed target: placed.
    data.athletes!.push({ ...data.athletes!.find((a) => a.id === IDS.athleteNoGpa)!, id: "a-placed", name: "Fixture Placed", status: "Active", advisor_id: null });
    data.recruiting_targets!.push({ id: "t-placed", org_id: org, athlete_id: "a-placed", school_id: IDS.school, status: "Committed", coach_name: null, offer_type: null, offer_scholarship_percent: null, closed_from: null, updated_at: "2026-09-01" });
    expect((await loadAdvisorCounts(client as never, org)).unassigned).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 15, 16, 19. Small screen truths.

describe("LAW: the recruiting screens' small truths", () => {
  it("Upload a Transcript carries the athlete, and the course count is singular for one", () => {
    const src = source("app/org/[slug]/roster/[id]/transcript/page.tsx");
    expect(src).toMatch(/documents\/new\?athlete=\$\{id\}/);
    expect(src).toMatch(/courses\.length === 1 \? "course" : "courses"/);
  });

  it("Matches with nothing narrowed says every school is a Conflict, not that filters matched nothing", () => {
    expect(source("app/org/[slug]/roster/[id]/matches/page.tsx")).toMatch(/filtering \? "Nothing Matches These Filters" : "Every School Is a Conflict"/);
  });

  it("editing a contact log entry with the date left blank keeps the date on file", async () => {
    const { updateCommunication } = await import("@/lib/actions/communications");
    await run(() => updateCommunication(ORG_WITH_MODULES, IDS.target, "tc1", { errors: {} }, form({ kind: "email", occurredOn: "", notes: "Edited." })));
    const w = writes.find((w) => w.table === "target_communications" && w.op === "update");
    expect(w).toBeDefined();
    expect(w!.rows[0]).not.toHaveProperty("occurred_on");
    expect(data.target_communications!.find((c) => c.id === "tc1")!.occurred_on).toBe("2026-08-20");
  });

  it("You Are Recruiting Here leaves out a school every athlete is Not Interested in", async () => {
    for (const t of data.recruiting_targets!) t.status = "Not Interested";
    const html = await render("@/app/org/[slug]/schools/page", { params: params({ slug: ORG_WITH_MODULES }), searchParams: params({}) });
    expect(html).not.toMatch(/You Are Recruiting Here/);
  });
});

// ---------------------------------------------------------------------------
// 17. Titles the copy law's regexes cannot see: a value in a lookup
// table or a fallback in a data mapping, rendered later as a title.

describe("LAW: titles held in lookup tables and fallbacks are Title Case", () => {
  const BANNED: Record<string, string[]> = {
    "app/org/[slug]/roster/[id]/page.tsx": ['"HS coach"', '"Travel coach"', '"Parent/guardian"', '"College coach"', '"Unknown school"'],
    "components/ContactForm.tsx": ['"HS coach"', '"Travel coach"', '"Parent/guardian"', '"College coach"'],
    "app/org/[slug]/page.tsx": ['"Unknown athlete"', '"Unknown school"'],
    "app/org/[slug]/roster/[id]/enroll/page.tsx": ['"Unknown school"'],
    "app/org/[slug]/schools/[id]/page.tsx": ['"Unknown athlete"'],
    "app/org/[slug]/roster/[id]/history/page.tsx": ['"Visit (logged)"', '"Official visit"', '"Unofficial visit"', '"Junior day"'],
    "app/org/[slug]/board/[id]/communications/page.tsx": ['"Visit (logged)"', '"Official visit"', '"Unofficial visit"', '"Junior day"', '"Last contact today"', '"Last contact yesterday"', "days since the last contact"],
    "app/org/[slug]/board/[id]/edit/page.tsx": ['"Junior day"'],
    "components/VisitForm.tsx": ['"Junior day"'],
    "app/org/[slug]/family/colleges/page.tsx": ['"Junior day"', '"Unknown school"'],
    "app/org/[slug]/family/colleges/[id]/page.tsx": ['"Junior day"'],
    "app/org/[slug]/roster/[id]/transcript/page.tsx": ['"No term"', '"Social science"', '"Other academic"', '"Not academic"'],
    "app/org/[slug]/roster/[id]/eligibility/page.tsx": ['"Social science"', '"Other academic"', '"Add another transcript"', '"Add a transcript"'],
    "app/org/[slug]/roster/[id]/eligibility/approvals/page.tsx": ['"Not on the list"', '"Two matches"', '"On the list"'],
    "app/org/[slug]/board/[id]/page.tsx": ['"No coach on file"'],
  };
  for (const [file, words] of Object.entries(BANNED)) {
    it(file, () => {
      const src = source(file);
      for (const w of words) expect(src, w).not.toContain(w);
    });
  }
});
