// Integrity: the record never says two things at once.
//
// Four holes the Stage 4 review found, each a way to leave an athlete's
// record contradicting itself:
//
//   - the Committed target of an athlete already Enrolled, Graduated or
//     Drafted could be removed, leaving a placement with no school and
//     nothing for Reopen Recruiting to put back
//   - an enrollment or graduation date could be in the future, and a
//     graduation date could come before the enrollment it ends
//   - a removed athlete's targets stayed open, editable and writable by
//     id, and the documents screens still named and linked them
//   - the Edit dropdown offered statuses the save then refused
//
// These run the real actions and render the real pages against the
// fixture. Each was proven to bite by planting the violation named
// beside it, watching it fail, and reverting.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";

let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(REDIRECT + url);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: OWNER_ID, recorded: writes }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: writes }),
}));

beforeEach(() => {
  writes = [];
  data = buildFixture();
});

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; notFound: boolean; state: unknown }> {
  try {
    const state = await fn();
    return { redirect: null, notFound: false, state };
  } catch (e) {
    const message = (e as Error).message;
    if (message.startsWith(REDIRECT)) return { redirect: message.slice(REDIRECT.length), notFound: false, state: null };
    if (message === NOT_FOUND) return { redirect: null, notFound: true, state: null };
    throw e;
  }
}

type PageFn = (props: Record<string, unknown>) => Promise<unknown>;

async function render(modulePath: string, params: Record<string, string>, searchParams: Record<string, string> = {}): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: PageFn };
  const tree = await mod.default({ params: Promise.resolve({ slug: ORG_WITH_MODULES, ...params }), searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(tree as never);
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

const deletes = (table: string) => writes.filter((w) => w.op === "delete" && w.table === table);
const bridgeId = () => data.orgs[0]!.id as string;
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type State = { errors: Record<string, string> };
const errorsOf = (r: { state: unknown }) => (r.state as State | null)?.errors ?? {};

describe("LAW: a placed athlete's Committed target stays until recruiting is reopened", () => {
  // Planted: dropped the Committed-and-placed refusal from deleteTarget;
  // the first case failed with the target and its log deleted. Reverted.
  it("removing the Committed target of an Enrolled athlete is refused and points to Reopen Recruiting", async () => {
    const { deleteTarget } = await import("@/lib/actions/targets");
    for (const status of ["Enrolled", "Graduated", "Drafted"]) {
      data = buildFixture();
      writes.length = 0;
      data.athletes.find((a) => a.id === IDS.athleteEnrolled)!.status = status;
      const r = await run(() => deleteTarget(ORG_WITH_MODULES, IDS.targetEnrolledCommitted));
      expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/board/${IDS.targetEnrolledCommitted}/edit?error=${encodeURIComponent("Reopen Recruiting first, then remove it.")}`);
      expect(writes).toEqual([]);
      expect(data.recruiting_targets.some((t) => t.id === IDS.targetEnrolledCommitted)).toBe(true);
    }
  });

  // Planted: dropped the same refusal from updateTarget; the status
  // went to Offer and the athlete moved with nothing stopping it.
  // Reverted.
  it("editing that commitment off Committed, or onto another athlete, is refused the same way; a note still saves", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    const t = () => data.recruiting_targets.find((x) => x.id === IDS.targetEnrolledCommitted)!;
    const edit = (values: Record<string, string>) => run(() => updateTarget(ORG_WITH_MODULES, IDS.targetEnrolledCommitted, { errors: {} }, form({ athleteId: IDS.athleteEnrolled, schoolId: t().school_id as string, status: "Committed", ...values })));
    const offer = await edit({ status: "Offer" });
    expect(errorsOf(offer).form).toMatch(/Reopen Recruiting first/);
    const moved = await edit({ athleteId: IDS.athleteNoGpa });
    expect(errorsOf(moved).form).toMatch(/Reopen Recruiting first/);
    expect(writes).toEqual([]);
    expect(t()).toMatchObject({ status: "Committed", athlete_id: IDS.athleteEnrolled });
    const noted = await edit({ notes: "Signed the NLI." });
    expect(noted.redirect).toBe(`/org/${ORG_WITH_MODULES}/board/${IDS.targetEnrolledCommitted}`);
    expect(t()).toMatchObject({ status: "Committed", notes: "Signed the NLI." });
  });

  it("the edit screen shows the refusal it was sent back with", async () => {
    const html = await render("@/app/org/[slug]/board/[id]/edit/page", { id: IDS.targetEnrolledCommitted }, { error: "Reopen Recruiting first, then remove it." });
    expect(html).toContain("Reopen Recruiting first, then remove it.");
  });

  it("every other target of a placed athlete, and a Committed athlete's own commitment, can still be removed", async () => {
    const { deleteTarget } = await import("@/lib/actions/targets");
    const closed = await run(() => deleteTarget(ORG_WITH_MODULES, IDS.targetEnrolledClosed));
    expect(closed.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athleteEnrolled}`);
    expect(data.recruiting_targets.some((t) => t.id === IDS.targetEnrolledClosed)).toBe(false);

    const committed = await run(() => deleteTarget(ORG_WITH_MODULES, IDS.targetCommitted));
    expect(committed.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athleteCommitted}`);
    expect(data.recruiting_targets.some((t) => t.id === IDS.targetCommitted)).toBe(false);
  });
});

describe("LAW: enrollment and graduation dates are never in the future, and graduation never comes first", () => {
  // Planted: removed the future check from markEnrolled; the first case
  // failed with the athlete enrolled on a day not yet come. Planted:
  // removed the before-enrollment check from markGraduated; the third
  // case failed with the athlete graduated before enrolling. Planted:
  // removed the future check from updateAthlete's corrections; the last
  // case failed. All reverted.
  it("Mark Enrolled refuses a date past tomorrow in UTC and takes tomorrow", async () => {
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    const future = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ enrolledOn: dayFromNow(3) })));
    expect(errorsOf(future).enrolledOn).toBe("The enrollment date can't be in the future.");
    expect(writes).toEqual([]);

    const tomorrow = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ enrolledOn: dayFromNow(1) })));
    expect(tomorrow.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/${IDS.athleteCommitted}\\?notice=`));
  });

  it("Mark Graduated refuses a date past tomorrow in UTC", async () => {
    const { markGraduated } = await import("@/lib/actions/enrollment");
    const r = await run(() => markGraduated(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ graduatedOn: dayFromNow(3) })));
    expect(errorsOf(r).graduatedOn).toBe("The graduation date can't be in the future.");
    expect(writes).toEqual([]);
  });

  it("Mark Graduated refuses a date before the enrollment date, in updateAthlete's words", async () => {
    const { markGraduated } = await import("@/lib/actions/enrollment");
    const enrolled = data.athletes.find((a) => a.id === IDS.athleteEnrolled)!.first_full_time_enrollment as string;
    const r = await run(() => markGraduated(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ graduatedOn: "2026-07-01" })));
    expect("2026-07-01" < enrolled).toBe(true);
    expect(errorsOf(r).graduatedOn).toBe("Graduated On comes after the Enrollment Date.");
    expect(writes).toEqual([]);
    expect(data.athletes.find((a) => a.id === IDS.athleteEnrolled)?.status).toBe("Enrolled");

    const onTime = await run(() => markGraduated(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ graduatedOn: dayFromNow(0) })));
    expect(onTime.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/${IDS.athleteEnrolled}\\?notice=`));
  });

  it("a correction on Edit refuses a future Enrollment Date or Graduated On", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const transfer = { name: "Fixture Transfer", sport: "Baseball", recruitType: "transfer_4to4", status: "Active", currentSchool: "City College of New York", eligibilityYearsRemaining: "3", transferCount: "1" };
    const enroll = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athleteTransfer, { errors: {}, values: {} }, form({ ...transfer, enrollmentDate: dayFromNow(3) })));
    expect(errorsOf(enroll).enrollmentDate).toBe("The enrollment date can't be in the future.");

    const graduated = { name: "Fixture Graduated", sport: "Baseball", recruitType: "transfer_4to4", status: "Graduated", currentSchool: "Fixture Tech", eligibilityYearsRemaining: "0", transferCount: "0" };
    const grad = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athleteGraduated, { errors: {}, values: {} }, form({ ...graduated, graduatedOn: dayFromNow(3) })));
    expect(errorsOf(grad).graduatedOn).toBe("The graduation date can't be in the future.");
    expect(writes).toEqual([]);
  });
});

describe("LAW: a removed athlete takes their targets with them, and the documents screens do not name them", () => {
  const remove = () => {
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-01T00:00:00.000Z";
  };

  // Planted: dropped the deleted_at check from loadTarget; the loader
  // returned the bundle. Planted: dropped it from the target page; the
  // page rendered. Both reverted.
  it("every target screen is a 404 for a removed athlete's target", async () => {
    remove();
    const { loadTarget } = await import("@/lib/data/loadTarget");
    expect(await loadTarget(bridgeId(), IDS.target)).toBeNull();
    const screens: [string, Record<string, string>][] = [
      ["@/app/org/[slug]/board/[id]/page", { id: IDS.target }],
      ["@/app/org/[slug]/board/[id]/edit/page", { id: IDS.target }],
      ["@/app/org/[slug]/board/[id]/communications/page", { id: IDS.target }],
      ["@/app/org/[slug]/board/[id]/dimensions/[dim]/page", { id: IDS.target, dim: "academic" }],
      ["@/app/org/[slug]/board/[id]/communications/[entryId]/page", { id: IDS.target, entryId: "tc1" }],
      ["@/app/org/[slug]/board/[id]/visits/[visitId]/page", { id: IDS.target, visitId: "tv1" }],
    ];
    for (const [path, params] of screens) {
      const r = await run(() => render(path, params));
      expect(r.notFound, path).toBe(true);
    }
  });

  it("the same screens render for an athlete still on the roster", async () => {
    const { loadTarget } = await import("@/lib/data/loadTarget");
    expect(await loadTarget(bridgeId(), IDS.target)).not.toBeNull();
    expect(await render("@/app/org/[slug]/board/[id]/edit/page", { id: IDS.target })).toContain("Remove Target");
  });

  // Planted: dropped the deleted_at check from loadLiveTarget, the read
  // all four actions make first; this case failed with the target and
  // its log deleted. Reverted.
  it("delete, edit, award and clear award all refuse a removed athlete's target and write nothing", async () => {
    remove();
    const { deleteTarget, updateTarget, saveTargetAid, clearTargetAid } = await import("@/lib/actions/targets");
    expect((await run(() => deleteTarget(ORG_WITH_MODULES, IDS.target))).redirect).toBe(`/org/${ORG_WITH_MODULES}/board`);
    const aid = await run(() => saveTargetAid(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ totalCostOfAttendance: "40000", netCost: "26000" })));
    expect(errorsOf(aid).form).toMatch(/isn't on this org's board/);
    expect((await run(() => clearTargetAid(ORG_WITH_MODULES, IDS.target))).redirect).toBe(`/org/${ORG_WITH_MODULES}/board`);
    const moved = await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athleteNoGpa, schoolId: IDS.school, status: "Offer" })));
    expect(errorsOf(moved).form).toMatch(/isn't on this org's board/);
    expect(writes).toEqual([]);
    expect(deletes("recruiting_targets")).toEqual([]);
    expect(data.recruiting_targets.some((t) => t.id === IDS.target)).toBe(true);
  });

  // Planted: assertTargetInOrg in communications.ts back to a bare
  // org-and-id read, and the same in visits.ts; the log, correction and
  // removal each went through on the removed athlete's target. Reverted.
  it("the contact log and visits refuse a removed athlete's target: nothing logged, corrected or removed", async () => {
    remove();
    const { logCommunication, updateCommunication, removeCommunication } = await import("@/lib/actions/communications");
    const { logVisit, updateVisit, removeVisit } = await import("@/lib/actions/visits");
    const logged = await run(() => logCommunication(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ kind: "email", notes: "After removal.", occurredOn: "2026-09-01" })));
    expect(errorsOf(logged).form).toMatch(/isn't on this org's board/);
    const fixed = await run(() => updateCommunication(ORG_WITH_MODULES, IDS.target, "tc1", { errors: {} }, form({ kind: "call", occurredOn: "2026-09-01", notes: "Changed." })));
    expect(errorsOf(fixed).form).toMatch(/isn't on this org's board/);
    expect((await run(() => removeCommunication(ORG_WITH_MODULES, IDS.target, "tc1"))).redirect).toBe(`/org/${ORG_WITH_MODULES}/board`);
    const visited = await run(() => logVisit(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ visitType: "official", visitDate: "2026-09-01" })));
    expect(errorsOf(visited).form).toMatch(/isn't on this org's board/);
    const moved = await run(() => updateVisit(ORG_WITH_MODULES, IDS.target, "tv1", { errors: {} }, form({ visitType: "official", visitDate: "2026-09-01" })));
    expect(errorsOf(moved).form).toMatch(/isn't on this org's board/);
    expect((await run(() => removeVisit(ORG_WITH_MODULES, IDS.target, "tv1"))).redirect).toBe(`/org/${ORG_WITH_MODULES}/board`);
    expect(writes).toEqual([]);
    expect(data.target_communications.some((c) => c.id === "tc1")).toBe(true);
    expect(data.target_visits.some((v) => v.id === "tv1")).toBe(true);
  });

  // Planted: dropped the Removed Athlete branch from the list's label;
  // the athlete's name was on the list again. Planted: set
  // matchedRemoved to false on the document page; the name and its
  // roster link came back. Both reverted.
  it("the documents list says Removed Athlete, with no name and no link to them", async () => {
    remove();
    const html = await render("@/app/org/[slug]/documents/page", {});
    expect(html).toContain("Removed Athlete");
    expect(html).not.toContain("Fixture Athlete");
    expect(html).not.toContain(`/roster/${IDS.athlete}`);
    // A search for the removed name finds nothing through the label.
    const searched = await render("@/app/org/[slug]/documents/page", {}, { q: "fixture athlete" });
    expect(searched).not.toContain("Fixture Athlete");
  });

  it("the document page says Removed Athlete, with no name and no link to them", async () => {
    remove();
    for (const id of [IDS.document, IDS.documentStub]) {
      const html = await render("@/app/org/[slug]/documents/[id]/page", { id });
      expect(html, id).toContain("Removed Athlete");
      expect(html, id).not.toContain("Fixture Athlete");
      expect(html, id).not.toContain(`/roster/${IDS.athlete}`);
    }
  });

  it("an athlete still on the roster is named and linked as before", async () => {
    const html = await render("@/app/org/[slug]/documents/[id]/page", { id: IDS.document });
    expect(html).toContain(`/roster/${IDS.athlete}`);
    expect(html).not.toContain("Removed Athlete");
  });
});

describe("LAW: the Edit dropdown offers exactly the statuses a save accepts", () => {
  // One athlete per status, with the fields a valid save needs.
  const hs = (name: string) => ({ name, sport: "Baseball", recruitType: "hs" });
  const transfer = (name: string, currentSchool: string) => ({ name, sport: "Baseball", recruitType: "transfer_4to4", currentSchool, eligibilityYearsRemaining: "2", transferCount: "1" });
  const cases: { status: string; id: string; base: Record<string, string>; setup?: (d: Dataset) => void }[] = [
    { status: "Active", id: IDS.athlete, base: hs("Fixture Athlete") },
    { status: "Inactive", id: IDS.athlete, base: hs("Fixture Athlete"), setup: (d) => void (d.athletes.find((a) => a.id === IDS.athlete)!.status = "Inactive") },
    { status: "Transferring", id: IDS.athleteTransferring, base: transfer("Fixture Transferring", "Fixture State University") },
    { status: "Committed", id: IDS.athleteCommitted, base: hs("Fixture Committed") },
    { status: "Enrolled", id: IDS.athleteEnrolled, base: hs("Fixture Enrolled") },
    { status: "Graduated", id: IDS.athleteGraduated, base: transfer("Fixture Graduated", "Fixture Tech") },
    { status: "Drafted", id: IDS.athleteDrafted, base: hs("Fixture Drafted") },
  ];

  function offered(html: string): string[] {
    const select = html.match(/<select[^>]*name="status"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
    return [...select.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]!);
  }

  // Planted: put ATHLETE_STATUSES back as the Edit dropdown's options;
  // the Enrolled case failed offering Active, which the save refuses.
  // Planted: took Committed out of HAND_EDIT_BLOCKED; the Active case
  // failed offering a Committed the save refuses. Both reverted.
  it("from every status, what the dropdown offers is what updateAthlete saves, and the current status is always there", async () => {
    const { ATHLETE_STATUSES } = await import("@/lib/validation/athlete");
    const { updateAthlete } = await import("@/lib/actions/athletes");
    for (const c of cases) {
      data = buildFixture();
      c.setup?.(data);
      expect(data.athletes.find((a) => a.id === c.id)?.status).toBe(c.status);
      const options = offered(await render("@/app/org/[slug]/roster/[id]/edit/page", { id: c.id }));
      expect(options, c.status).toContain(c.status);

      for (const next of ATHLETE_STATUSES) {
        data = buildFixture();
        c.setup?.(data);
        writes.length = 0;
        const r = await run(() => updateAthlete(ORG_WITH_MODULES, c.id, { errors: {}, values: {} }, form({ ...c.base, status: next })));
        const saved = r.redirect?.startsWith(`/org/${ORG_WITH_MODULES}/roster/${c.id}`) ?? false;
        expect({ from: c.status, to: next, offered: options.includes(next) }).toEqual({ from: c.status, to: next, offered: saved });
        if (!saved) expect(errorsOf(r).status, `${c.status} to ${next}`).toBeTruthy();
      }
    }
  });

  it("Add offers every status", async () => {
    const { ATHLETE_STATUSES } = await import("@/lib/validation/athlete");
    const options = offered(await render("@/app/org/[slug]/roster/new/page", {}));
    expect(options).toEqual([...ATHLETE_STATUSES]);
  });
});
