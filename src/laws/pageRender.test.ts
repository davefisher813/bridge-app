// Every page actually runs.
//
// Until this file, nothing in the repo had ever executed a page. They are
// all `force-dynamic` server components, so `npm run build` type-checks
// them and stops there, and the click-through prototype is a second
// implementation of the same screens that shares the engine modules and
// none of the page code.
//
// That left a whole class of bug with no check anywhere: reading a field
// off a null row, mapping over an embed that arrived as an object rather
// than an array, a `!` on something genuinely absent. None of it is
// visible to tsc through an `as` cast, and every one of them is a blank
// screen with a stack trace in a log nobody is reading.
//
// Each page is called directly and the element tree it returns is
// rendered to a string. The pages are async functions returning ordinary
// JSX, so awaiting the function is enough; React never has to resolve an
// async component. `notFound()` and `redirect()` throw sentinels, which
// is what Next does, so a page that bails is asserted on rather than
// counted as a pass.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID } from "@/testing/fixture";
import { PAGES, p } from "@/testing/pages";
import { createFakeClient, type Dataset } from "@/testing/fakeSupabase";

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";

let currentUser: string | null = OWNER_ID;
// One dataset per test, rebuilt in beforeEach, so a law can change a
// row before a render (an athlete set to Transferring, say) and the
// page reads the changed row. The one write a render makes is the
// thread pages' read mark (Stage 3, an idempotent upsert of the
// viewer's own row), so sharing it across the clients one page opens
// changes nothing another page reads.
let data: Dataset = buildFixture();

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(REDIRECT + url);
  },
  // A client component on the page imports this. It is never called
  // during a render, but the module has to export it.
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser }),
}));

// The admin client is the service role. A page never uses it, so reaching
// for one here is a finding rather than something to stub quietly.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("a page reached for the service-role client");
  },
}));

type PageFn = (props: Record<string, unknown>) => Promise<unknown>;

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: PageFn };
  const tree = await mod.default(props);
  return renderToStaticMarkup(tree as never);
}


beforeEach(() => {
  currentUser = OWNER_ID;
  data = buildFixture();
});

// The markup of one Row, from its title to the next Row (or the end),
// so a law can say what sits in the trailing slot of that row and not
// of the one under it.
function rowAfter(html: string, title: string): string {
  const start = html.indexOf(title);
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const next = rest.indexOf('data-kit="row"');
  return next === -1 ? rest : rest.slice(0, next);
}

// What the kit's Score renders (src/components/kit/index.tsx). A Stat
// uses the heading size, so this matches a score and nothing else.
const SCORE = /text-body font-extrabold tabular-nums/;

// The org's side of a school, which a family or member school page must
// never carry (Stage 2, 2026-09-26): an athlete's name, a coach from the
// directory or an org note, a note's text, the staff-only sections and
// the stale-profile instruction, a score, a metric, a donor. The
// school's own Avg GPA and SAT range are the shared facts and are
// allowed; an athlete's are not, and no athlete is on the page.
const ORG_SIDE_OF_A_SCHOOL = /Fixture (Athlete|Unknown|Transfer|Committed|Enrolled|Graduated|Drafted|Coach|Head|Assistant|Donor|Parent)|coach@|assistant@|Wants a shortstop|Positions of Need|Your Notes|Your Athletes Here|Coaches|Days Old|Score|FB Velo/;

describe("LAW: every page renders", () => {
  for (const page of PAGES) {
    it(`${page.name} renders without throwing`, async () => {
      currentUser = page.as ?? OWNER_ID;
      const html = await render(page.path, page.props);
      expect(html.length).toBeGreaterThan(200);
      expect(html).toMatch(page.expect);
    });
  }
});

// The family role reads one athlete and nothing else (migrations 0022
// to 0024). The database enforces it; this proves the screens do too,
// so a fixture render, which has no row level security, cannot show a
// family something the real app would not.
describe("LAW: a family login opens family screens and nothing else, and staff cannot open them", () => {
  // The athlete screens served under both /roster and /family (see
  // athleteHome in src/lib/auth/guard.ts). A family may open these; what
  // the law checks is that every link on them stays on the family side.
  const SHARED = /\/roster\/\[id\]\/(eligibility|eligibility\/approvals|eligibility\/caveats|transcript|metrics)\/page$/;
  const family = PAGES.filter((x) => x.as === FAMILY_ID);
  const shared = PAGES.filter((x) => !x.as && SHARED.test(x.path));
  const orgWide = PAGES.filter((x) => !x.as && x.path.startsWith("@/app/org/") && !SHARED.test(x.path));
  const familyShared = family.filter((x) => /\/family\/\[id\]\/(eligibility|eligibility\/approvals|eligibility\/caveats|transcript|metrics)\/page$/.test(x.path));

  it("there are family screens and org screens to check", () => {
    expect(family.length).toBeGreaterThan(5);
    expect(orgWide.length).toBeGreaterThan(20);
    expect(shared.length).toBeGreaterThanOrEqual(6);
  });

  for (const page of shared) {
    it(`a family login opening ${page.name} sees only family links, or nothing if the athlete is not theirs`, async () => {
      currentUser = FAMILY_ID;
      const linked = ((await (page.props.params as Promise<{ id: string }>)).id) !== IDS.athleteTransfer;
      if (!linked) {
        await expect(render(page.path, page.props)).rejects.toThrow(NOT_FOUND);
        return;
      }
      const html = await render(page.path, page.props);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      expect(links.length).toBeGreaterThan(0);
      expect(links.filter((l) => l.startsWith("/org/") && !l.includes("/family/"))).toEqual([]);
      // Nothing to submit: a family changes nothing.
      expect(html).not.toMatch(/<form/);
    });
  }

  for (const page of familyShared) {
    it(`an owner opening ${page.name} is on the roster side`, async () => {
      currentUser = OWNER_ID;
      const html = await render(page.path, page.props);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      expect(links.filter((l) => l.includes("/family/"))).toEqual([]);
    });
  }

  for (const page of orgWide) {
    it(`a family login cannot open ${page.name}`, async () => {
      currentUser = FAMILY_ID;
      const outcome = await render(page.path, page.props).then(
        () => "rendered",
        (e: Error) => e.message,
      );
      // Not Authorized for the org-wide screens; Not Found for the
      // records the org page shows (a second org's page, say). Never a
      // render.
      expect(outcome === "rendered" ? "rendered" : outcome.startsWith(REDIRECT) ? outcome : NOT_FOUND).not.toBe("rendered");
      if (outcome.startsWith(REDIRECT)) expect(outcome).toMatch(/\/unauthorized$|\/family$/);
    });
  }

  for (const page of family.filter((x) => !familyShared.includes(x))) {
    it(`an owner cannot open ${page.name}`, async () => {
      currentUser = OWNER_ID;
      await expect(render(page.path, page.props)).rejects.toThrow(REDIRECT + "/unauthorized");
    });
  }

  // The school directory (Stage 2): a family reads the school row and
  // nothing else, so nothing of the org's side can be on the page, and
  // every link stays on the family side.
  for (const page of family.filter((x) => x.name.startsWith("family-school"))) {
    it(`a family opening ${page.name} sees the school's facts, none of the org's side, and only family links`, async () => {
      currentUser = FAMILY_ID;
      const html = await render(page.path, page.props);
      expect(html).not.toMatch(ORG_SIDE_OF_A_SCHOOL);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      expect(links.length).toBeGreaterThan(0);
      expect(links.filter((l) => l.startsWith("/org/") && !l.includes("/family/"))).toEqual([]);
      expect(html).not.toMatch(/<form/);
    });
  }

  it("a family login cannot open an athlete it is not linked to", async () => {
    currentUser = FAMILY_ID;
    await expect(render("@/app/org/[slug]/family/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) })).rejects.toThrow(NOT_FOUND);
    await expect(render("@/app/org/[slug]/family/[id]/eligibility/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) })).rejects.toThrow(NOT_FOUND);
  });
});

describe("LAW: the list above covers every page in the app", () => {
  // The render list is written out by hand, which is right (a glob would
  // let a new page join without anybody deciding what its arguments are)
  // and which rots the moment somebody adds a route and forgets. So the
  // list is checked against the filesystem rather than trusted.
  it("no page.tsx is missing from PAGES", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { posix } = await import("node:path");
    const appDir = posix.join(process.cwd().replace(/\\/g, "/"), "src/app");

    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = posix.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "page.tsx") {
          const rel = full.slice(appDir.length + 1);
          // The root page is "page.tsx" with no directory, which slices
          // to itself rather than to "".
          found.push(rel === "page.tsx" ? "" : rel.replace(/\/page\.tsx$/, ""));
        }
      }
    };
    walk(appDir);

    const covered = new Set(PAGES.map((x) => x.path.replace(/^@\/app\//, "").replace(/\/page$/, "")));
    // Nothing is exempt any more. The forms used to be, on the grounds
    // that a render proves nothing about a post, which was true of the
    // post and false of the rest of the screen.
    const missing = found.filter((f) => !covered.has(f) && f !== "" && !f.startsWith("unauthorized") && !f.startsWith("login") && !f.startsWith("auth"));

    expect(missing).toEqual([]);
  });
});

describe("LAW: recruiting closes for an Enrolled athlete, on the staff side and the family side", () => {
  // Dave, 2026-09-26: once an athlete enrolls, the high school
  // recruiting apparatus should stop looking outstanding. The stepper
  // and the Matches section are what "still recruiting" looks like on
  // screen, so they are what has to disappear.
  it("the athlete page drops the stepper, Matches and Targets for the Mark Enrolled row, and points at Recruiting History", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) });
    expect(html).toMatch(/Enrolled[\s\S]*Fixture State University/);
    expect(html).not.toMatch(/>Profile</);
    expect(html).not.toMatch(/Mark Enrolled/);
    expect(html).not.toMatch(/>Matches</);
    // Stage 1, 2026-09-26: the closed target left the forefront. The
    // profile shows what is live; the record is Recruiting History.
    // Proven to bite by putting the Not Interested row back in the
    // profile's Targets: planted and reverted.
    expect(html).not.toMatch(/Not Interested/);
    expect(html).not.toMatch(/>Targets</);
    expect(html).toMatch(/Recruiting History/);
    expect(html).toMatch(new RegExp(`href="/org/${ORG_WITH_MODULES}/roster/${IDS.athleteEnrolled}/history"`));
  });

  it("Recruiting History keeps every school with its own messages and visits, and only its own", async () => {
    const page = "@/app/org/[slug]/roster/[id]/history/page";
    const enrolled = await render(page, { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) });
    expect(enrolled).toMatch(/Not Interested/);
    expect(enrolled).toMatch(/Closed automatically/);
    expect(enrolled).toMatch(/was In Contact/);
    // That message belongs to IDS.athlete's target, not this one.
    expect(enrolled).not.toMatch(/Fixture note/);

    const active = await render(page, { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(active).toMatch(/Fixture note/);
    expect(active).toMatch(/Unofficial visit/);
    expect(active).toMatch(/Fixture impression/);
    // Every row on the screen opens something (a Row with an href is
    // wrapped in the kit's block link): the clickable baseline starts at
    // zero dead surfaces for a new screen.
    const rows = (active.match(/data-kit="row"/g) ?? []).length;
    expect(rows).toBeGreaterThan(0);
    expect((active.match(/<a [^>]*><div data-kit="row"/g) ?? []).length).toBe(rows);
  });

  it("a Committed athlete not yet enrolled sees the school at the top and the Mark Enrolled button, and no more Matches", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) });
    expect(html).toMatch(/Mark Enrolled/);
    expect(html).toMatch(/Fixture State University/);
    // The school replaces the stepper; ranking more schools is over.
    expect(html).not.toMatch(/Furthest stage/);
    expect(html).not.toMatch(/>Matches</);
  });

  it("the roster names where every Committed and Enrolled athlete is going", async () => {
    // Dave, 2026-09-26: "It doesn't say the school they're committed to
    // anywhere. And when they're enrolled, it doesn't say it anywhere
    // either."
    const html = await render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
    expect(html).toMatch(/Committed to Fixture State University/);
    expect(html).toMatch(/Enrolled at Fixture State University/);
  });

  it("the roster names where Graduated and Drafted athletes ended up", async () => {
    // Dave, 2026-09-26: "I should be able to say graduated or drafted."
    const html = await render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
    expect(html).toMatch(/Graduated from Fixture Tech/);
    expect(html).toMatch(/Drafted by Fixture Pros, Round 5, 2026/);
  });

  it("each athlete gets the close-outs that can still follow, and no others", async () => {
    const page = "@/app/org/[slug]/roster/[id]/page";
    const active = await render(page, { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(active).toMatch(/Mark Enrolled/);
    expect(active).toMatch(/Mark Drafted/);
    expect(active).not.toMatch(/Mark Graduated/);
    const enrolled = await render(page, { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) });
    expect(enrolled).toMatch(/Mark Graduated/);
    expect(enrolled).toMatch(/Mark Drafted/);
    expect(enrolled).not.toMatch(/Mark Enrolled/);
    const drafted = await render(page, { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteDrafted }) });
    expect(drafted).not.toMatch(/Mark (Enrolled|Graduated|Drafted)/);
    expect(drafted).not.toMatch(/>Matches</);
  });

  it("the athlete's schools are called Targets, the same as the board they come from", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(html).not.toMatch(/>Colleges</);
    expect(html).toMatch(/>Targets</);
  });

  it("the full Matches page shows an Enrolled state instead of a ranked list", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/matches/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }), searchParams: p({}) });
    expect(html).toMatch(/Enrolled/);
    expect(html).not.toMatch(/Add to Board/);
  });

  it("the family mirror also drops the stepper and Matches once enrolled", async () => {
    currentUser = FAMILY_ID;
    const html = await render("@/app/org/[slug]/family/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) });
    expect(html).toMatch(/Enrolled[\s\S]*Fixture State University/);
    expect(html).not.toMatch(/>Profile</);
    expect(html).not.toMatch(/>Matches</);
  });

  it("the enroll screen previews what will close, and asks for the school only when nothing on file names it", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/enroll/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) });
    expect(html).toMatch(/Fixture State University/);
    expect(html).toMatch(/Will Close/);

    // No Committed target - still previews what will close (a transfer
    // or historical athlete with only open targets) rather than
    // refusing. Dave, 2026-09-26.
    const noCommitted = await render("@/app/org/[slug]/roster/[id]/enroll/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(noCommitted).toMatch(/Will Close/);
    // ...and asks which school, since nothing on file says.
    expect(noCommitted).toMatch(/Enrolled At/);
    expect(noCommitted).toMatch(/Pick a School/);

    // An athlete already in college: their Current School is the default.
    const transfer = await render("@/app/org/[slug]/roster/[id]/enroll/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) });
    expect(transfer).toMatch(/>City College of New York<\/option>/);

    // A Committed target already names it, so there is nothing to ask.
    expect(html).not.toMatch(/Enrolled At/);

    await expect(render("@/app/org/[slug]/roster/[id]/enroll/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) })).rejects.toThrow(NOT_FOUND);
  });
});

describe("LAW: a placed athlete has no score anywhere", () => {
  // Dave, 2026-09-26: no score for an athlete who has committed,
  // enrolled, graduated or been drafted. Their stored fits are deleted
  // at placement (src/lib/data/fits.ts), and the two screens that read
  // an athlete's status directly show the status where the number sat.
  // Proven to bite by removing the status filter in fits.ts (the
  // action law) and by putting the closed target back on the profile
  // (the render law above): planted and reverted.
  it("the board shows the Enrolled athlete's status where the score would sit, and scores the Active one", async () => {
    const html = await render("@/app/org/[slug]/board/page", { params: p({ slug: ORG_WITH_MODULES }) });
    const placed = rowAfter(html, "Fixture Enrolled to Fixture State University");
    expect(placed).toMatch(/>Enrolled</);
    expect(placed).not.toMatch(SCORE);
    expect(placed).not.toMatch(/Not Scored Yet/);
    const active = rowAfter(html, "Fixture Athlete to Fixture State University");
    expect(active).toMatch(SCORE);
    expect(active).toMatch(/>93</);
  });

  it("the target page says recruiting ended instead of building a score", async () => {
    const html = await render("@/app/org/[slug]/board/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.targetEnrolledCommitted }) });
    expect(html).toMatch(/Recruiting ended: Enrolled at Fixture State University\./);
    expect(html).not.toMatch(/How the Score Is Built/);
    expect(html).not.toMatch(/Worth Knowing/);
    expect(html).toMatch(/>Enrolled</);
    const live = await render("@/app/org/[slug]/board/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) });
    expect(live).toMatch(/How the Score Is Built/);
  });

  it("the school page shows the Enrolled chip for the enrolled athlete and a number for the others", async () => {
    const html = await render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
    const enrolled = rowAfter(html, ">Fixture Enrolled<");
    expect(enrolled).toMatch(/>Enrolled</);
    expect(enrolled).not.toMatch(SCORE);
    const committed = rowAfter(html, ">Fixture Committed<");
    expect(committed).toMatch(/>Committed</);
    expect(committed).not.toMatch(SCORE);
    expect(rowAfter(html, ">Fixture Athlete<")).toMatch(SCORE);
  });

  it("the Matches page of an Inactive athlete says scoring stopped rather than ranking", async () => {
    // The lead's call, 2026-09-26: scoring is only for an athlete who
    // is actively recruiting, so Inactive is not scored either.
    data.athletes.find((a) => a.id === IDS.athlete)!.status = "Inactive";
    const html = await render("@/app/org/[slug]/roster/[id]/matches/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({}) });
    expect(html).toMatch(/Matches stopped scoring while Fixture Athlete is inactive\./);
    expect(html).not.toMatch(/Add to Board/);
    // Nor does any other screen build them a number: the target page,
    // the school page and the profile all read the status instead.
    const target = await render("@/app/org/[slug]/board/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) });
    expect(target).toMatch(/Matches stopped scoring while Fixture Athlete is inactive\./);
    expect(target).not.toMatch(/How the Score Is Built/);
    expect(target).toMatch(/>Inactive</);
    const school = await render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
    const row = rowAfter(school, ">Fixture Athlete<");
    expect(row).toMatch(/>Inactive</);
    expect(row).not.toMatch(SCORE);
    const profile = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(profile).not.toMatch(/>Matches</);
    expect(profile).toMatch(/>Targets</);
    currentUser = FAMILY_ID;
    const family = await render("@/app/org/[slug]/family/[id]/matches/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(family).toMatch(/Matches stopped scoring while Fixture Athlete is inactive\./);
  });

  it("a Transferring athlete is scored again: Matches and Targets are back on the profile", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransferring }) });
    expect(html).toMatch(/>Matches</);
    expect(html).toMatch(/>Targets</);
    expect(html).toMatch(/>64</);
    expect(html).toMatch(/Reopen Recruiting|Mark Enrolled/);
    expect(html).not.toMatch(/Recruiting ended/);
  });
});

describe("LAW: Today counts every status, and each count opens the roster it counts", () => {
  // Stage 1, 2026-09-26, reformatted the same day (Dave: "way too much
  // vertical space and clutter"): one compact line, a count per status
  // with anyone in it, counted by effectiveStatus (src/lib/placement.ts)
  // exactly as the roster filters, so a count and the list it opens
  // never disagree. Statuses with nobody are left out.
  it("shows every status with anyone in it, each linking to the roster filtered by it", async () => {
    const html = await render("@/app/org/[slug]/page", { params: p({ slug: ORG_WITH_MODULES }) });
    const hrefs = [...html.matchAll(/href="([^"]*roster\?status=[^"]*)"/g)].map((m) => m[1]!);
    for (const s of ["Active", "Committed", "Enrolled", "Transferring", "Graduated", "Drafted"]) expect(hrefs).toContain(`/org/${ORG_WITH_MODULES}/roster?status=${s}`);
    expect(hrefs).not.toContain(`/org/${ORG_WITH_MODULES}/roster?status=Inactive`);
    // The count sits in the chip right before the status word.
    const count = (status: string) => html.match(new RegExp(`>(\\d+)<\\/span>\\s*${status}<`))?.[1];
    expect(count("Enrolled")).toBe("1");
    expect(count("Transferring")).toBe("1");
    expect(count("Committed")).toBe("1");
  });

  it("the roster narrowed by a status shows only that status, and offers the way back", async () => {
    const enrolled = await render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ status: "Enrolled" }) });
    expect(enrolled).toMatch(/Fixture Enrolled/);
    expect(enrolled).not.toMatch(/Fixture Athlete/);
    expect(enrolled).toMatch(/Show Every Athlete/);
    expect(enrolled).toMatch(/1 of \d+, Enrolled/);
    const transferring = await render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ status: "Transferring" }) });
    expect(transferring).toMatch(/Fixture Transferring/);
    expect(transferring).not.toMatch(/Fixture Enrolled/);
    // A status the vocabulary does not know narrows nothing.
    const unknown = await render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ status: "Bogus" }) });
    expect(unknown).toMatch(/Fixture Athlete[\s\S]*Fixture Enrolled/);
    expect(unknown).not.toMatch(/Show Every Athlete/);
  });

  it("the tile count and the narrowed roster agree for every status", async () => {
    const { ATHLETE_STATUSES } = await import("@/lib/validation/athlete");
    const today = await render("@/app/org/[slug]/page", { params: p({ slug: ORG_WITH_MODULES }) });
    for (const status of ATHLETE_STATUSES) {
      // A status nobody holds is left off Today, so its count is 0.
      const count = Number(today.match(new RegExp(`>(\\d+)<\\/span>\\s*${status}<`))?.[1] ?? 0);
      const list = await render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ status }) });
      expect(list).toMatch(new RegExp(`${count} of \\d+, ${status}`));
    }
  });
});

describe("LAW: the awkward rows render too", () => {
  // Every one of these is a row the fixture made deliberately incomplete.
  // A page that only ever sees a complete row is a page nobody has tested.
  it("an athlete with no GPA, no position and no detail", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteNoGpa }),
    });
    expect(html).toMatch(/Fixture Unknown/);
  });

  it("a target with no coach and no offer", async () => {
    const html = await render("@/app/org/[slug]/board/[id]/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.targetNoCoach }),
    });
    expect(html).toMatch(/Fixture College/);
  });

  it("a contact log on a target with nothing logged", async () => {
    const html = await render("@/app/org/[slug]/board/[id]/communications/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.targetNoCoach }),
    });
    expect(html).toMatch(/Nothing logged/i);
  });

  it("a donor who sits on no board", async () => {
    const html = await render("@/app/org/[slug]/fundraising/donors/[id]/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.donorNoSeat }),
    });
    expect(html).toMatch(/Fixture Lapsed Donor/);
    expect(html).not.toMatch(/Sits on a board/);
  });

  it("the approved-list form 404s with no school named", async () => {
    // Not a workaround for the test: a list belongs to one school, and a
    // form with no school is a form that cannot be saved. Pinned because
    // the alternative (rendering an empty form) is the kind of thing that
    // gets "fixed" by somebody who does not know why the check is there.
    await expect(
      render("@/app/org/[slug]/approved-courses/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }),
    ).rejects.toThrow(NOT_FOUND);
  });

  it("a board seat with no donor record says so rather than reporting zero", async () => {
    const html = await render("@/app/org/[slug]/board-governance/[id]/seats/[memberId]/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.board, memberId: "bm2" }),
      searchParams: p({}),
    });
    expect(html).toMatch(/No donor record linked/i);
  });
});

describe("LAW: the module gate is a 404, not an empty screen", () => {
  // orgs.modules is the multi-tenant boundary. A gated page that renders
  // an empty shell instead of 404ing is a page that tells Elite Squad the
  // feature exists and is broken.
  const GATED = [
    { name: "fundraising", path: "@/app/org/[slug]/fundraising/page", extra: { searchParams: p({}) } },
    { name: "gifts", path: "@/app/org/[slug]/fundraising/gifts/page", extra: { searchParams: p({}) } },
    { name: "donors", path: "@/app/org/[slug]/fundraising/donors/page", extra: {} },
    { name: "governance", path: "@/app/org/[slug]/board-governance/page", extra: { searchParams: p({}) } },
    { name: "all-seats", path: "@/app/org/[slug]/board-governance/members/page", extra: { searchParams: p({}) } },
  ];

  for (const g of GATED) {
    it(`${g.name} 404s for an org without the module`, async () => {
      await expect(render(g.path, { params: p({ slug: ORG_WITHOUT_MODULES }), ...g.extra })).rejects.toThrow(NOT_FOUND);
    });
  }
});

describe("LAW: a page with no signed-in user does not render", () => {
  // requireRole redirects rather than returning null, so a page cannot
  // accidentally render for a signed-out visitor. Checked on the screen
  // holding the most sensitive rows in the database.
  it("the donor list redirects when nobody is signed in", async () => {
    currentUser = null;
    await expect(
      render("@/app/org/[slug]/fundraising/donors/page", { params: p({ slug: ORG_WITH_MODULES }) }),
    ).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
  });
});

describe("LAW: a member reads the program as stages, never the roster", () => {
  // Until 2026-09-21 a member opened the roster read-only. A board
  // member now has their own Program screen (migration 0031, the Board
  // Access catalog) and the roster is staff's.
  it("a member is sent away from the roster", async () => {
    currentUser = MEMBER_ID;
    await expect(render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }) })).rejects.toThrow(REDIRECT + "/unauthorized");
  });

  it("a member's Program names the athletes with a stage and no grades", async () => {
    currentUser = MEMBER_ID;
    const html = await render("@/app/org/[slug]/member/program/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(html).toMatch(/Fixture Athlete/);
    expect(html).toMatch(/Offer|Targeting|Committed/);
    expect(html).not.toMatch(/GPA|3\.4/);
  });

  it("a member's Program names Graduated and Drafted athletes too", async () => {
    currentUser = MEMBER_ID;
    const html = await render("@/app/org/[slug]/member/program/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(html).toMatch(/Graduated from Fixture Tech/);
    expect(html).toMatch(/Drafted by Fixture Pros, Round 5, 2026/);
  });

  it("a member's Program says Enrolled at the school, not Committed forever", async () => {
    // Migration 0034; the fake RPC mirrors it. Dave, 2026-09-26.
    currentUser = MEMBER_ID;
    const html = await render("@/app/org/[slug]/member/program/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(html).toMatch(/Enrolled at Fixture State University/);
    expect(html).toMatch(/Committed to Fixture State University/);
    const one = await render("@/app/org/[slug]/member/program/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) });
    expect(one).toMatch(/Enrolled at Fixture State University/);
  });

  it("a member's Program reads a Transferring athlete as Targeting, whatever a leftover Committed target says", async () => {
    // Migration 0038 and src/testing/fakeRpc.ts: a reopened athlete is
    // recruiting again, so the commitment that placed them is history
    // even when the row survived. Stage 1, 2026-09-26.
    currentUser = MEMBER_ID;
    data.athletes.find((a) => a.id === IDS.athleteEnrolled)!.status = "Transferring";
    expect(data.recruiting_targets.find((t) => t.id === IDS.targetEnrolledCommitted)?.status).toBe("Committed");
    const html = await render("@/app/org/[slug]/member/program/page", { params: p({ slug: ORG_WITH_MODULES }) });
    const row = rowAfter(html, ">Fixture Enrolled<");
    expect(row).toMatch(/Targeting/);
    expect(row).not.toMatch(/Committed/);
    expect(row).not.toMatch(/Enrolled at/);
  });
});

describe("LAW: an org without the fundraising module has no money on the member screens", () => {
  // orgs.modules gates board_governance and donor_fundraising off by
  // default, so Elite Squad's board sees the program and nothing else.
  // The tab bar drops Giving (src/components/kit/TabBar.tsx); these are
  // the screens themselves.
  it("the member home shows the program and no seat, budget or giving link", async () => {
    currentUser = MEMBER_ID;
    const html = await render("@/app/org/[slug]/member/page", { params: p({ slug: ORG_WITHOUT_MODULES }) });
    expect(html).toMatch(/The Program/);
    expect(html).not.toMatch(/Your Seat|Of Budget|Give\/Get|raised/i);
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((l) => l.includes("/giving"))).toEqual([]);
  });

  it("the Giving screen itself is a 404 for that org", async () => {
    currentUser = MEMBER_ID;
    await expect(render("@/app/org/[slug]/member/giving/page", { params: p({ slug: ORG_WITHOUT_MODULES }) })).rejects.toThrow(NOT_FOUND);
  });

  it("the member tab bar drops Giving without the module", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { TabBar } = await import("@/components/kit/TabBar");
    const lite = renderToStaticMarkup(createElement(TabBar, { slug: ORG_WITHOUT_MODULES, variant: "member-lite" }));
    expect(lite).not.toMatch(/Giving/);
    const full = renderToStaticMarkup(createElement(TabBar, { slug: ORG_WITH_MODULES, variant: "member" }));
    expect(full).toMatch(/Giving/);
  });
});

describe("LAW: a searched list keeps the box that searched it", () => {
  // A term that narrows a list to one row, or to none, must leave the
  // field on screen: otherwise the only way back is the browser's own
  // address bar, which on a phone is the way nobody takes.
  const searched = PAGES.filter((x) => x.name.endsWith("-search") || x.name.endsWith("-search-empty"));

  it("there are searched screens to check", () => {
    expect(searched.length).toBeGreaterThanOrEqual(6);
  });

  for (const page of searched) {
    it(`${page.name} still shows the search field`, async () => {
      currentUser = page.as ?? OWNER_ID;
      const html = await render(page.path, page.props);
      expect(html).toMatch(/name="q"/);
      expect(html).toMatch(/Search/);
    });
  }
});

describe("LAW: the screens around the pages render too", () => {
  // error.tsx, not-found.tsx and loading.tsx are not pages, so the
  // coverage law above never sees them, and until 2026-09-19 none
  // existed: a thrown error was Next's white default and a slow query
  // was a blank screen. Each is rendered here the way Next would call it.
  // These are client components with hooks, so unlike the async pages
  // above they are mounted as elements and rendered by React itself.
  async function renderElement(modulePath: string, props: Record<string, unknown>): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const mod = (await import(/* @vite-ignore */ modulePath)) as { default: React.ComponentType<Record<string, unknown>> };
    return renderToStaticMarkup(createElement(mod.default, props));
  }

  it("the org error screen offers a retry and keeps its tone", async () => {
    const html = await renderElement("@/app/org/[slug]/error", { error: new Error("boom"), reset: () => {} });
    expect(html).toMatch(/Something broke/i);
    expect(html).toMatch(/Try Again/);
    expect(html).not.toMatch(/boom/);
  });

  it("the root error screen offers a retry", async () => {
    const html = await renderElement("@/app/error", { error: new Error("boom"), reset: () => {} });
    expect(html).toMatch(/Try Again/);
  });

  it("the org not-found screen links back to that org's Today", async () => {
    const html = await renderElement("@/app/org/[slug]/not-found", {});
    expect(html).toMatch(/Nothing here/i);
    expect(html).toMatch(/Back to Today/);
  });

  it("the root not-found screen links to the start", async () => {
    const html = await renderElement("@/app/not-found", {});
    expect(html).toMatch(/Nothing here/i);
  });

  it("the org loading screen is paper, not empty", async () => {
    const html = await renderElement("@/app/org/[slug]/loading", {});
    expect(html).toMatch(/bg-paper/);
    expect(html).toMatch(/aria-busy/);
  });
});

describe("LAW: the members screens are the owner's alone", () => {
  it("a member is turned away from the list", async () => {
    currentUser = MEMBER_ID;
    await expect(render("@/app/org/[slug]/members/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) })).rejects.toThrow(REDIRECT + "/unauthorized");
  });

  it("the only owner is told why they cannot be removed", async () => {
    const html = await render("@/app/org/[slug]/members/[userId]/page", { params: p({ slug: ORG_WITH_MODULES, userId: OWNER_ID }), searchParams: p({}) });
    expect(html).toMatch(/only Executive Director/);
    expect(html).not.toMatch(/Remove From/);
  });

  it("the sign-in screen leads with the password and keeps the magic link one tap away", async () => {
    const html = await render("@/app/login/page", { searchParams: p({}) });
    expect(html).toMatch(/type="password"/);
    expect(html).toMatch(/Email Me a Link Instead/);
    const link = await render("@/app/login/page", { searchParams: p({ mode: "link" }) });
    expect(link).toMatch(/Email Me a Link/);
  });
});

// The member role (Bridge: Board) reads summaries, never rows
// (migration 0031), and has its own screens under /member (Dave's picks
// in the Board Access catalog, 2026-09-21). The database enforces the
// reads; this proves the screens do too: a member login opens the
// member screens and nothing else, every link on them stays on the
// member side, and staff cannot open them.
describe("LAW: a member login opens member screens and nothing else, and staff cannot open them", () => {
  const member = PAGES.filter((x) => x.as === MEMBER_ID);
  const everythingElse = PAGES.filter((x) => x.as !== MEMBER_ID && x.path.startsWith("@/app/org/"));

  it("there are member screens to check", () => {
    expect(member.length).toBeGreaterThanOrEqual(5);
  });

  for (const page of member) {
    it(`a member opening ${page.name} sees only member links, and a form only to sign out`, async () => {
      currentUser = MEMBER_ID;
      const html = await render(page.path, page.props);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      expect(links.filter((l) => l.startsWith("/org/") && !l.includes("/member"))).toEqual([]);
      const forms = (html.match(/<form/g) ?? []).length;
      expect(forms).toBe(page.name.startsWith("member-more") ? 1 : 0);
      // Nothing a board member must not see: a GPA, a test score, a
      // metric, a call note, a donor's name. The school pages are the one
      // split (Stage 2, 2026-09-26): a school's own Avg GPA and SAT range
      // are reference facts, not an athlete's, so there the ban is on the
      // org's side of the school instead, which is where an athlete, a
      // coach or a note would come from.
      if (page.name.startsWith("member-school")) expect(html).not.toMatch(ORG_SIDE_OF_A_SCHOOL);
      else expect(html).not.toMatch(/GPA|SAT|ACT|FB Velo|Fixture Donor|coach@/);
    });

    it(`an owner cannot open ${page.name}`, async () => {
      currentUser = OWNER_ID;
      await expect(render(page.path, page.props)).rejects.toThrow(REDIRECT + "/unauthorized");
    });
  }

  for (const page of everythingElse) {
    it(`a member login cannot open ${page.name}`, async () => {
      currentUser = MEMBER_ID;
      const outcome = await render(page.path, page.props).then(
        () => "rendered",
        (e: Error) => e.message,
      );
      expect(outcome).not.toBe("rendered");
      if (outcome.startsWith(REDIRECT)) expect(outcome).toMatch(/\/unauthorized$|\/member$/);
    });
  }

  it("a member cannot open an athlete that is not in the program", async () => {
    currentUser = MEMBER_ID;
    await expect(render("@/app/org/[slug]/member/program/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: "00000000-0000-0000-0000-00000000dead" }) })).rejects.toThrow(NOT_FOUND);
  });
});

describe("LAW: the coach directory shows where staff reach out, and only there", () => {
  // Migration 0036; Dave, 2026-09-26: a shared list for owners and staff.
  it("the school page lists its coaches, head coach first, each one tappable", async () => {
    const html = await render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
    expect(html).toMatch(/>Coaches</);
    expect(html.indexOf("Fixture Head")).toBeLessThan(html.indexOf("Fixture Assistant"));
    expect(html).toMatch(/href="mailto:assistant@fixture\.example"/);
    expect(html).toMatch(/href="tel:5550100"/);
    expect(html).toMatch(/Programs of Interest[\s\S]*Biology \(BS\) and Exercise Science \(BS\)\./);
  });

  it("the target page lists the same coaches", async () => {
    const html = await render("@/app/org/[slug]/board/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) });
    expect(html).toMatch(/>Coaches</);
    expect(html).toMatch(/Fixture Head/);
  });

  it("a school with no coaches on file shows no empty Coaches section", async () => {
    const html = await render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.schoolD3 }) });
    expect(html).not.toMatch(/>Coaches</);
  });

  // Stage 2: the same school is on the family and member directories,
  // and the coaches are not (college_coaches_staff_read, migration 0036).
  it("the family and member school pages never name a coach", async () => {
    for (const [as, role] of [[FAMILY_ID, "family"], [MEMBER_ID, "member"]] as const) {
      currentUser = as;
      const html = await render(`@/app/org/[slug]/${role}/schools/[id]/page`, { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
      expect(html).toMatch(/Fixture State University/);
      expect(html).not.toMatch(/Fixture Head|Fixture Assistant|assistant@fixture|mailto:|tel:/);
    }
  });
});

// Stage 2, 2026-09-26: every signed-in role browses the same school
// directory, under its own prefix (docs/DECISIONS.md). The facts are
// the same for everyone; the org's side (coaches, notes, its athletes,
// the stale-profile instruction) is staff's alone.
describe("LAW: the school directory shows the shared facts to everyone and the org's side to staff only", () => {
  const ROLES = [
    { as: OWNER_ID, role: "owner", dir: "@/app/org/[slug]/schools/page", one: "@/app/org/[slug]/schools/[id]/page", base: `/org/${ORG_WITH_MODULES}/schools/` },
    { as: FAMILY_ID, role: "family", dir: "@/app/org/[slug]/family/schools/page", one: "@/app/org/[slug]/family/schools/[id]/page", base: `/org/${ORG_WITH_MODULES}/family/schools/` },
    { as: MEMBER_ID, role: "member", dir: "@/app/org/[slug]/member/schools/page", one: "@/app/org/[slug]/member/schools/[id]/page", base: `/org/${ORG_WITH_MODULES}/member/schools/` },
  ] as const;

  it("staff see the org's side of a school: coaches, their notes, their athletes", async () => {
    const html = await render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
    expect(html).toMatch(/>Coaches</);
    expect(html).toMatch(/Your Notes/);
    expect(html).toMatch(/Your Athletes Here[\s\S]*Fixture Athlete/);
    expect(html).toMatch(/Days Old/);
  });

  for (const r of ROLES.filter((x) => x.role !== "owner")) {
    it(`a ${r.role} sees the shared facts of a school, and every row on it opens something`, async () => {
      currentUser = r.as;
      const html = await render(r.one, { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
      expect(html).toMatch(/Fixture City, CT/);
      expect(html).toMatch(/Avg GPA/);
      expect(html).toMatch(/SAT 1050-1250/);
      expect(html).toMatch(/Sports Sponsored/);
      expect(html).toMatch(/Majors Offered/);
      expect(html).toMatch(/Programs of Interest/);
      expect(html).toMatch(/Money[\s\S]*Out of State: \$38,000/);
      expect(html).toMatch(/Depth Chart/);
      expect(html).not.toMatch(ORG_SIDE_OF_A_SCHOOL);
      // Lead's decision: the cost lines are notes for everyone but an
      // owner, so no row on the page goes nowhere.
      const rows = (html.match(/data-kit="row"/g) ?? []).length;
      expect((html.match(/<a [^>]*><div data-kit="row"/g) ?? []).length).toBe(rows);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      expect(links).toEqual([r.base.slice(0, -1)]);
    });
  }

  for (const r of ROLES) {
    it(`a D3 school never offers athletic money, as ${r.role} sees it`, async () => {
      currentUser = r.as;
      const html = await render(r.one, { params: p({ slug: ORG_WITH_MODULES, id: IDS.schoolD3 }) });
      expect(html).toMatch(/No athletic scholarships at D3/);
      expect(html).not.toMatch(/Full scholarships available/);
      expect(html).toMatch(/Flags on This School[\s\S]*Fixture flag on this school/);
    });

    it(`the ${r.role} directory lists every school A to Z, each row linked on the ${r.role} side`, async () => {
      currentUser = r.as;
      const html = await render(r.dir, { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
      expect(html).toMatch(/Fixture College[\s\S]*Fixture State University/);
      expect(html).toMatch(/Fixture Town, NY/);
      expect(html).toContain(`href="${r.base}${IDS.school}"`);
      expect(html).toContain(`href="${r.base}${IDS.schoolD3}"`);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((l) => l.startsWith("/org/"));
      // Besides the rows: the member back link to Home, an owner's Add and Import.
      expect(links.filter((l) => !l.startsWith(r.base) && l !== `/org/${ORG_WITH_MODULES}/${r.role}` && !l.endsWith("/schools/new") && !l.endsWith("/schools/import"))).toEqual([]);
    });

    // One case per filter, and the search. Each fixture school carries
    // its own division, state and conference, and only one has Biology.
    const CASES: Array<[string, Record<string, string>, "college" | "state" | "both" | "none"]> = [
      ["division D3", { division: "D3" }, "college"],
      ["division D2", { division: "D2" }, "state"],
      ["state NY", { state: "NY" }, "college"],
      ["conference Fixture League", { conference: "Fixture League" }, "college"],
      ["major Biology", { major: "Biology" }, "state"],
      ["major biology in any case", { major: "biology" }, "state"],
      ["a search that reaches the conference", { q: "league" }, "college"],
      ["a search with a filter, neither clearing the other", { q: "fixture", state: "CT" }, "state"],
      ["a division the data does not carry, which is dropped", { division: "Nope" }, "both"],
      ["a search nothing matches", { q: "zzzz" }, "none"],
    ];
    for (const [label, search, shows] of CASES) {
      it(`the ${r.role} directory filtered by ${label}`, async () => {
        currentUser = r.as;
        const html = await render(r.dir, { params: p({ slug: ORG_WITH_MODULES }), searchParams: p(search) });
        const college = html.includes(`${r.base}${IDS.schoolD3}"`);
        const state = html.includes(`${r.base}${IDS.school}"`);
        expect({ college, state }).toEqual({ college: shows === "college" || shows === "both", state: shows === "state" || shows === "both" });
        if (shows === "none") expect(html).toMatch(/No School Matches/);
        // An applied major shows in its dropdown whatever case the
        // address carried it in, so the screen never says "Any Major"
        // over a filtered list.
        if (search.major) expect(html).toMatch(/<option value="Biology" selected/);
      });
    }
  }
});

// Stage 3, 2026-09-26: an athlete has an advisor, and the advisor and
// the athlete's family share one message thread (migration 0039). A
// member (Bridge: Board) never reads the thread. Check-ins are staff
// only (the lead's decision: these athletes are minors, and RLS is row
// level, so the only safe place for a call note is a table the family
// cannot read at all): no family screen names them, links to them or
// shows a note, and a family login is refused from the staff log.
//
// Each assertion was planted against and reverted before this was
// called done: the family athlete page's section retitled, the /mine
// sort reversed, a Check-Ins row added to the family athlete page, the
// staff check-ins page and the staff thread each opened to the family
// role, the family guard dropped from the family thread, a message body
// shown on the member's athlete page, and Today's reminder pointed at
// the athlete instead of the log. Each failed here, and passes again
// reverted.
describe("LAW: an advisor and the family share one thread, the member never sees it, and check-ins stay with staff", () => {
  const ATHLETE = { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) };
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
  const BODIES = /Fixture message from staff|Fixture reply from the family/;
  // The word in any form a screen could carry it: a title, a chip, a
  // link to a /checkins route, the fixture note itself.
  const CHECKIN = /check-?ins?\b|Fixture check-in note/i;

  it("the family athlete page names the advisor, with a way to write to them", async () => {
    currentUser = FAMILY_ID;
    const html = await render("@/app/org/[slug]/family/[id]/page", ATHLETE);
    expect(html).toMatch(/Your Advisor[\s\S]*Example Owner/);
    expect(html).toContain('href="mailto:owner@example.test"');
    expect(html).toContain(`href="/org/${ORG_WITH_MODULES}/family/${IDS.athlete}/messages"`);
  });

  it("the staff athlete page names the advisor and opens the thread and the log", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", ATHLETE);
    expect(html).toMatch(/Advisor[\s\S]*Example Owner/);
    expect(html).toContain('href="mailto:owner@example.test"');
    expect(html).toContain(`href="/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/messages"`);
    expect(html).toContain(`href="/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/checkins"`);
  });

  // Opening the thread clears the count on both athlete pages, and a
  // read thread says how many messages it holds, never "0 new".
  it("opening the thread clears its new count on the athlete page", async () => {
    // The Row bolds the first meta clause, so the text is read with tags out.
    const text = (html: string) => html.replace(/<[^>]+>/g, "");
    expect(text(await render("@/app/org/[slug]/roster/[id]/page", ATHLETE))).toMatch(/2 messages · 1 new/);
    await render("@/app/org/[slug]/roster/[id]/messages/page", ATHLETE);
    const after = text(await render("@/app/org/[slug]/roster/[id]/page", ATHLETE));
    expect(after).toMatch(/2 messages/);
    expect(after).not.toMatch(/2 messages · \d+ new/);
  });

  it("staff and family read the same thread, each with a composer", async () => {
    const staff = await render("@/app/org/[slug]/roster/[id]/messages/page", ATHLETE);
    currentUser = FAMILY_ID;
    const family = await render("@/app/org/[slug]/family/[id]/messages/page", ATHLETE);
    for (const html of [staff, family]) {
      expect(html).toMatch(/Fixture message from staff[\s\S]*Fixture reply from the family/);
      expect(html).toMatch(/<form/);
    }
    // The family's copy keeps every link on the family side.
    expect(hrefs(family).filter((l) => l.startsWith("/org/") && !l.startsWith(`/org/${ORG_WITH_MODULES}/family/`))).toEqual([]);
  });

  it("each side is refused from the other's thread, and a family from a thread that is not theirs", async () => {
    currentUser = OWNER_ID;
    await expect(render("@/app/org/[slug]/family/[id]/messages/page", ATHLETE)).rejects.toThrow(REDIRECT + "/unauthorized");
    currentUser = FAMILY_ID;
    await expect(render("@/app/org/[slug]/roster/[id]/messages/page", ATHLETE)).rejects.toThrow(REDIRECT + "/unauthorized");
    await expect(render("@/app/org/[slug]/family/[id]/messages/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) })).rejects.toThrow(NOT_FOUND);
  });

  it("My Athletes lists the athlete never checked in with first, and only the ones this person advises", async () => {
    const html = await render("@/app/org/[slug]/mine/page", { params: p({ slug: ORG_WITH_MODULES }) });
    const never = html.indexOf("Fixture Unknown");
    const recent = html.indexOf("Fixture Athlete");
    expect(never).toBeGreaterThan(-1);
    expect(recent).toBeGreaterThan(-1);
    expect(never).toBeLessThan(recent);
    expect(html).not.toMatch(/Fixture (Transfer|Committed|Enrolled|Graduated|Drafted)/);
  });

  // A placed or graduated athlete is never due: the reminders on Today
  // skip them, so the counts on Today and My Athletes must too, or the
  // tile promises a check-in the reminders never show. Planted (the
  // status check dropped from each count) and watched fail.
  it("an athlete who is no longer being recruited is never counted as due", async () => {
    const before = await render("@/app/org/[slug]/mine/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(before).toMatch(/2 athletes · 1 due for a check-in/);
    const row = data.athletes.find((a) => a.id === IDS.athleteNoGpa)!;
    row.status = "Graduated";
    const mine = await render("@/app/org/[slug]/mine/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(mine).toMatch(/2 athletes · 0 due for a check-in/);
    const today = await render("@/app/org/[slug]/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(today).toMatch(/2 athletes, 0 due for a check-in/);
    expect(today).not.toContain(`/roster/${IDS.athleteNoGpa}/checkins`);
  });

  it("Today opens My Athletes and reminds staff of the athlete never checked in with", async () => {
    const html = await render("@/app/org/[slug]/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(html).toContain(`href="/org/${ORG_WITH_MODULES}/mine"`);
    const href = `href="/org/${ORG_WITH_MODULES}/roster/${IDS.athleteNoGpa}/checkins"`;
    const at = html.indexOf(href);
    expect(at).toBeGreaterThan(-1);
    const row = html.slice(at, html.indexOf("</a>", at));
    expect(row).toMatch(/Fixture Unknown/);
    expect(row).toMatch(/never checked in/);
  });

  it("a member opens none of it, and the member's athlete page carries no message and no note", async () => {
    currentUser = MEMBER_ID;
    for (const path of ["@/app/org/[slug]/roster/[id]/messages/page", "@/app/org/[slug]/roster/[id]/checkins/page", "@/app/org/[slug]/family/[id]/messages/page"]) {
      await expect(render(path, ATHLETE)).rejects.toThrow(REDIRECT + "/unauthorized");
    }
    await expect(render("@/app/org/[slug]/mine/page", { params: p({ slug: ORG_WITH_MODULES }) })).rejects.toThrow(REDIRECT + "/unauthorized");
    const html = await render("@/app/org/[slug]/member/program/[id]/page", ATHLETE);
    expect(html).toMatch(/Fixture Athlete/);
    expect(html).not.toMatch(BODIES);
    expect(html).not.toMatch(CHECKIN);
  });

  it("a family login is refused from the staff check-in log, for its own athlete and any other", async () => {
    currentUser = FAMILY_ID;
    for (const id of [IDS.athlete, IDS.athleteNoGpa, IDS.athleteTransfer]) {
      await expect(render("@/app/org/[slug]/roster/[id]/checkins/page", { params: p({ slug: ORG_WITH_MODULES, id }) })).rejects.toThrow(REDIRECT + "/unauthorized");
    }
  });

  // Every family screen, not only the two this stage touched: a check-in
  // row added to the family home or Colleges later would leak the same
  // way. The fixture athlete carries a check-in with a note, so a screen
  // that read the log would have something to show.
  const family = PAGES.filter((x) => x.as === FAMILY_ID);
  it("there are family screens to check, the athlete page and the thread among them", () => {
    expect(family.map((x) => x.name)).toEqual(expect.arrayContaining(["family-athlete", "family-messages"]));
    expect(data.athlete_checkins.some((c) => c.athlete_id === IDS.athlete && c.notes)).toBe(true);
  });
  for (const page of family) {
    it(`${page.name} never shows a check-in, its note or a link to the log`, async () => {
      currentUser = FAMILY_ID;
      const html = await render(page.path, page.props);
      expect(html).not.toMatch(CHECKIN);
      expect(hrefs(html).filter((l) => /checkin/i.test(l))).toEqual([]);
    });
  }
});
