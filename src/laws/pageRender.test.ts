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
// What the client components on a page (a filter, a sort) read as the
// current address. Empty unless a law sets it before a render.
let searchParams = new URLSearchParams();
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
  useSearchParams: () => searchParams,
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
  searchParams = new URLSearchParams();
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
      // render. The family login belongs to Bridge only, so a screen of
      // the org without modules (more-lite, Stage 5 Phase 3) sends it to
      // sign in, which is the guard's answer to no membership at all.
      const slug = ((await (page.props.params as Promise<{ slug?: string }>))?.slug) ?? ORG_WITH_MODULES;
      expect(outcome === "rendered" ? "rendered" : outcome.startsWith(REDIRECT) ? outcome : NOT_FOUND).not.toBe("rendered");
      if (outcome.startsWith(REDIRECT)) expect(outcome).toMatch(slug === ORG_WITHOUT_MODULES ? /\/unauthorized$|\/family$|\/login$/ : /\/unauthorized$|\/family$/);
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
    expect(html).not.toMatch(/Schools? Evaluated/);
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
    expect(html).not.toMatch(/Schools? Evaluated/);
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
    // Any athlete not yet Graduated or Drafted can be marked Graduated,
    // so an alumnus is never left Inactive (Dave, 2026-09-27).
    expect(active).toMatch(/Mark Graduated/);
    const enrolled = await render(page, { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) });
    expect(enrolled).toMatch(/Mark Graduated/);
    expect(enrolled).toMatch(/Mark Drafted/);
    expect(enrolled).not.toMatch(/Mark Enrolled/);
    const drafted = await render(page, { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteDrafted }) });
    expect(drafted).not.toMatch(/Mark (Enrolled|Graduated|Drafted)/);
    expect(drafted).not.toMatch(/Schools? Evaluated/);
  });

  it("the board shows a placed athlete's commitment and none of their other targets", async () => {
    // Dave, 2026-09-27: Derek committed and still showed Yale and
    // Bucknell under Not Interested. Once placed, the rest is recruiting
    // history. The fixture's committed athlete still has an open target
    // (IDS.targetToClose, In Contact): it must not be on the board.
    const board = await render("@/app/org/[slug]/board/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
    expect(board).not.toContain(`/board/${IDS.targetToClose}"`);
    expect(board).toMatch(/Fixture Committed/);
  });

  it("the athlete's schools are called Targets, the same as the board they come from", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(html).not.toMatch(/>Colleges</);
    expect(html).toMatch(/>Targets</);
  });

  it("the full Matches page shows an Enrolled state instead of a ranked list", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/matches/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }), searchParams: p({}) });
    expect(html).toMatch(/Enrolled/);
    expect(html).not.toMatch(/Add Target/);
  });

  it("the family mirror also drops the stepper and Matches once enrolled", async () => {
    currentUser = FAMILY_ID;
    const html = await render("@/app/org/[slug]/family/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) });
    expect(html).toMatch(/Enrolled[\s\S]*Fixture State University/);
    expect(html).not.toMatch(/>Profile</);
    expect(html).not.toMatch(/Schools? Evaluated/);
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
    // A search over every school on file, not a scroll through a list
    // (Dave, 2026-09-27).
    expect(noCommitted).toMatch(/placeholder="Search Schools"/);
    expect(noCommitted).toMatch(/<datalist id="schoolName-options">[\s\S]*value="Fixture College"/);

    // An athlete already in college: their Current School is the default.
    const transfer = await render("@/app/org/[slug]/roster/[id]/enroll/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) });
    expect(transfer).toMatch(/placeholder="City College of New York"/);

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
    expect(html).not.toMatch(/Add Target/);
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
    expect(profile).not.toMatch(/Schools? Evaluated/);
    expect(profile).toMatch(/>Targets</);
    currentUser = FAMILY_ID;
    const family = await render("@/app/org/[slug]/family/[id]/matches/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(family).toMatch(/Matches stopped scoring while Fixture Athlete is inactive\./);
  });

  it("a Transferring athlete is scored again: Matches and Targets are back on the profile", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransferring }) });
    // The section is named for its count ("1 School Evaluated"),
    // amended 2026-09-27.
    expect(html).toMatch(/1 School Evaluated/);
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
    // The count sits in the tile right before the status word (Dave's
    // tile layout, 2026-09-27).
    const count = (status: string) => html.match(new RegExp(`>(\\d+)<\\/span><span[^>]*>${status}<`))?.[1];
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
      const count = Number(today.match(new RegExp(`>(\\d+)<\\/span><span[^>]*>${status}<`))?.[1] ?? 0);
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

  it("the approved-list form with no school named asks Which School", async () => {
    // It used to 404: a list belongs to one school, and a form with no
    // school cannot be saved. Stage 4 (2026-09-27, lead decision B6)
    // turned that dead end into a step: pick the school, then the form.
    // Still pinned so nobody "fixes" it back into an empty course form.
    const html = await render("@/app/org/[slug]/approved-courses/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
    expect(html).toMatch(/Which School/);
    expect(html).not.toMatch(/Paste the List/);
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
    expect(html).toMatch(/only Admin/);
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

describe("LAW: every record can be corrected and removed by the people who may, and by nobody else", () => {
  // Stage 4 and the audit fixes, 2026-09-27. Dave: "everything should be
  // very easy for anyone to edit anything... add and delete and all that
  // good stuff." The actions check the role on the server (the crud law
  // files prove that); this proves the screens a person actually sees:
  // staff get Remove where staff may remove, the owner alone gets the
  // shared directory and the org's settings, an edit screen opens on the
  // record it edits, and a family or member screen carries no note, no
  // coach control and no Remove at all. Each assertion was proven to bite
  // by a plant in the page it names (see src/laws/README.md).
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
  const asStaff = () => {
    // The fixture's Bridge member, made a leftover staff row for the test. No
    // other row changes, so what differs from the owner is the role.
    data.org_members.find((m) => m.id === "m2")!.role = "staff";
    currentUser = MEMBER_ID;
  };
  const params = (o: Record<string, string>) => ({ params: p({ slug: ORG_WITH_MODULES, ...o }), searchParams: p({}) });

  it("staff see Remove on an athlete, a target, a message and a course, each behind a confirm (a document has no Remove at all)", async () => {
    asStaff();
    const screens: Array<[string, Record<string, string>, RegExp]> = [
      ["@/app/org/[slug]/roster/[id]/page", { id: IDS.athlete }, /<button type="button"[^>]*>Remove Athlete<\/button>/],
      ["@/app/org/[slug]/board/[id]/edit/page", { id: IDS.target }, /<button type="button"[^>]*>Remove Target<\/button>/],
      ["@/app/org/[slug]/roster/[id]/messages/page", { id: IDS.athlete }, /<button type="button"[^>]*>Remove<\/button>/],
      ["@/app/org/[slug]/roster/[id]/transcript/[courseId]/page", { id: IDS.athlete, courseId: "ac1" }, /<button type="button"[^>]*>Remove Course<\/button>/],
    ];
    // type="button" is the ConfirmButton: it opens the question first. A
    // bare destructive Button inside the Form would be a submit.
    for (const [path, o, want] of screens) {
      const html = await render(path, params(o));
      expect(html, path).toMatch(want);
    }
  });

  it("staff read and add the athlete's notes on the athlete page", async () => {
    asStaff();
    const html = await render("@/app/org/[slug]/roster/[id]/page", params({ id: IDS.athlete }));
    expect(html).toMatch(/Notes[\s\S]*Fixture note\.[\s\S]*Add Note/);
  });

  it("the owner alone removes or merges a school and manages its coaches", async () => {
    const edit = await render("@/app/org/[slug]/schools/[id]/edit/page", params({ id: IDS.school }));
    expect(edit).toMatch(/Merge Into[\s\S]*Remove School/);
    const school = await render("@/app/org/[slug]/schools/[id]/page", params({ id: IDS.school }));
    expect(hrefs(school)).toContain(`/org/${ORG_WITH_MODULES}/schools/${IDS.school}/coaches`);
    const coach = await render("@/app/org/[slug]/schools/[id]/coaches/[coachId]/page", params({ id: IDS.school, coachId: "cc1" }));
    expect(coach).toMatch(/Remove Coach/);

    asStaff();
    const staffSchool = await render("@/app/org/[slug]/schools/[id]/page", params({ id: IDS.school }));
    expect(staffSchool).toMatch(/Fixture Head/);
    expect(hrefs(staffSchool).filter((l) => /\/coaches(\/|$)|\/schools\/[^/]+\/edit$/.test(l))).toEqual([]);
    for (const [path, o] of [
      ["@/app/org/[slug]/schools/[id]/edit/page", { id: IDS.school }],
      ["@/app/org/[slug]/schools/[id]/coaches/page", { id: IDS.school }],
      ["@/app/org/[slug]/schools/[id]/coaches/new/page", { id: IDS.school }],
      ["@/app/org/[slug]/schools/[id]/coaches/[coachId]/page", { id: IDS.school, coachId: "cc1" }],
    ] as Array<[string, Record<string, string>]>) {
      await expect(render(path, params(o)), path).rejects.toThrow(REDIRECT + "/unauthorized");
    }
  });

  it("Organization Settings is the owner's alone, on More and at its address", async () => {
    const more = await render("@/app/org/[slug]/more/page", params({}));
    expect(hrefs(more)).toContain(`/org/${ORG_WITH_MODULES}/settings`);
    const settings = await render("@/app/org/[slug]/settings/page", params({}));
    expect(settings).toMatch(/value="Fixture Foundation"|value="[^"]*Fixture[^"]*"/);

    asStaff();
    const staffMore = await render("@/app/org/[slug]/more/page", params({}));
    expect(hrefs(staffMore).filter((l) => l.endsWith("/settings"))).toEqual([]);
    expect(staffMore).not.toMatch(/Organization Settings/);
    await expect(render("@/app/org/[slug]/settings/page", params({}))).rejects.toThrow(REDIRECT + "/unauthorized");

    data.org_members.find((m) => m.id === "m2")!.role = "member";
    for (const who of [MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      await expect(render("@/app/org/[slug]/settings/page", params({})), who).rejects.toThrow(REDIRECT + "/unauthorized");
    }
  });

  it("each edit screen opens filled in with the record it edits", async () => {
    const screens: Array<[string, Record<string, string>, RegExp]> = [
      ["@/app/org/[slug]/roster/[id]/edit/page", { id: IDS.athlete }, /value="Fixture Athlete"[\s\S]*value="Fixture High School"/],
      ["@/app/org/[slug]/roster/[id]/contacts/[contactId]/edit/page", { id: IDS.athlete, contactId: "ct1" }, /value="Fixture Parent"/],
      ["@/app/org/[slug]/roster/[id]/metrics/[metricId]/edit/page", { id: IDS.athlete, metricId: "mx1" }, /value="86"[\s\S]*value="2026-08-15"/],
      ["@/app/org/[slug]/roster/[id]/checkins/[checkinId]/edit/page", { id: IDS.athlete, checkinId: "ck1" }, /<textarea[^>]*>Fixture check-in note\.<\/textarea>/],
      ["@/app/org/[slug]/roster/[id]/transcript/[courseId]/page", { id: IDS.athlete, courseId: "ac1" }, /value="English 11"/],
      ["@/app/org/[slug]/board/[id]/communications/[entryId]/page", { id: IDS.target, entryId: "tc1" }, /<textarea[^>]*>Fixture note\.<\/textarea>/],
      ["@/app/org/[slug]/schools/[id]/edit/page", { id: IDS.school }, /value="Fixture State University"/],
      ["@/app/org/[slug]/schools/[id]/coaches/[coachId]/page", { id: IDS.school, coachId: "cc1" }, /value="Fixture Assistant"[\s\S]*value="assistant@fixture\.example"/],
      ["@/app/org/[slug]/transfer-windows/[id]/edit/page", { id: "tw1" }, /value="Fixture window"[\s\S]*<textarea[^>]*>Fixture window note\.<\/textarea>/],
      ["@/app/org/[slug]/fundraising/donors/[id]/edit/page", { id: IDS.donor }, /value="Fixture Donor"/],
      ["@/app/org/[slug]/fundraising/gifts/[id]/edit/page", { id: "gf1" }, /value="5000\.00"[\s\S]*value="2026-03-01"/],
      ["@/app/org/[slug]/fundraising/grants/[id]/edit/page", { id: "gr1" }, /value="Fixture Trust"[\s\S]*value="15000\.00"/],
      ["@/app/org/[slug]/board/[id]/visits/[visitId]/page", { id: IDS.target, visitId: "tv1" }, /value="2026-07-04"/],
      ["@/app/org/[slug]/board-governance/[id]/edit/page", { id: IDS.board }, /value="Fixture Executive Board"/],
      ["@/app/org/[slug]/board-governance/[id]/seats/[memberId]/edit/page", { id: IDS.board, memberId: IDS.boardMember }, /value="Fixture Chair"/],
      ["@/app/org/[slug]/fundraising/campaigns/[id]/edit/page", { id: IDS.campaign }, /value="Fixture Campaign"[\s\S]*value="2026-12-31"/],
      ["@/app/org/[slug]/fundraising/pledges/[id]/edit/page", { id: "pl1" }, /value="10000\.00"[\s\S]*value="2026-06-30"/],
    ];
    for (const [path, o, want] of screens) {
      const html = await render(path, params(o));
      expect(html, path).toMatch(want);
    }
  });

  // Every family and member screen, and the athlete screens a family
  // shares with staff, rendered as that login. The athlete notes are
  // given a body nothing else in the fixture carries, so a screen that
  // read the table would have something to show.
  const PRIVATE = "Private staff note for the law";
  const SHARED = /\/roster\/\[id\]\/(eligibility|eligibility\/approvals|eligibility\/caveats|transcript|metrics)\/page$/;
  const outside = [
    ...PAGES.filter((x) => x.as === FAMILY_ID || x.as === MEMBER_ID),
    ...PAGES.filter((x) => !x.as && SHARED.test(x.path) && x.name !== "transcript-transfer" && x.name !== "eligibility-transfer").map((x) => ({ ...x, name: `${x.name} (as family)`, as: FAMILY_ID })),
  ];
  it("there are family and member screens to check", () => {
    expect(outside.filter((x) => x.as === FAMILY_ID).length).toBeGreaterThan(20);
    expect(outside.filter((x) => x.as === MEMBER_ID).length).toBeGreaterThan(8);
  });
  for (const page of outside) {
    it(`${page.name} shows no note, no coach control and no Remove`, async () => {
      for (const n of data.athlete_notes) n.body = PRIVATE;
      currentUser = page.as!;
      const html = await render(page.path, page.props);
      expect(html).not.toContain(PRIVATE);
      expect(html).not.toMatch(/Add Note|Add a Note|Remove|Delete for Good|Merge Into|Edit Course|Correct the Reading|Add a Coach/);
      expect(hrefs(html).filter((l) => /\/coaches(\/|$)|\/edit$|\/transcript\/new$|\/settings$|\/contacts\//.test(l))).toEqual([]);
    });
  }

  it("a removed athlete leaves the board, Today and the school page, and their targets stay on file", async () => {
    // Remove Athlete is a soft delete (audit crud F1): the row keeps
    // deleted_at, its targets stay in the table for the record, and every
    // screen that lists targets has to skip them. Proven to bite by
    // dropping each page's filter in turn.
    const screens = ["@/app/org/[slug]/board/page", "@/app/org/[slug]/page", "@/app/org/[slug]/schools/[id]/page"];
    for (const path of screens) {
      expect(await render(path, params({ id: IDS.school })), path).toMatch(/Fixture Athlete/);
    }
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-27T12:00:00.000Z";
    expect(data.recruiting_targets.some((t) => t.athlete_id === IDS.athlete)).toBe(true);
    for (const path of screens) {
      expect(await render(path, params({ id: IDS.school })), path).not.toMatch(/Fixture Athlete/);
    }
  });

  it("a removed athlete leaves the Schools list's You Are Recruiting Here and a family member's Sees list", async () => {
    // Every athlete removed: no target counts for a school any more, and
    // the family member's links stay on file but list nobody.
    const family = () => render("@/app/org/[slug]/members/[userId]/page", { params: p({ slug: ORG_WITH_MODULES, userId: FAMILY_ID }), searchParams: p({}) });
    expect(await render("@/app/org/[slug]/schools/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) })).toMatch(/You Are Recruiting Here/);
    expect(await family()).toMatch(/Unlink/);
    for (const a of data.athletes) a.deleted_at = "2026-09-27T12:00:00.000Z";
    expect(data.athlete_guardians.length).toBeGreaterThan(0);
    expect(await render("@/app/org/[slug]/schools/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) })).not.toMatch(/You Are Recruiting Here/);
    expect(await family()).not.toMatch(/Unlink/);
  });

  it("a family login and a member are turned away from every staff edit screen", async () => {
    const staffOnly = PAGES.filter((x) => !x.as && /\/(edit|new|\[courseId\]|\[entryId\]|\[visitId\]|\[coachId\]|family\/\[userId\]|coaches|settings)\/page$/.test(x.path) && x.path.startsWith("@/app/org/"));
    expect(staffOnly.length).toBeGreaterThan(30);
    data.org_members.find((m) => m.id === "m2")!.role = "member";
    for (const who of [FAMILY_ID, MEMBER_ID]) {
      for (const page of staffOnly) {
        currentUser = who;
        await expect(render(page.path, page.props), `${page.name} as ${who === FAMILY_ID ? "family" : "member"}`).rejects.toThrow(/NEXT_REDIRECT:\/unauthorized|NEXT_NOT_FOUND/);
      }
    }
  });
});

describe("LAW: matches are ranked full before partial, searched, sorted, capped, and the target action sits outside the row link", () => {
  // Stage 5 Phase 1, docs/MATCHING_CONTRACT.md section 2 amended
  // 2026-09-27, Dave approved the plan the same day. The fixture's
  // no-GPA athlete carries the case: a partial Reach at 48 and a full
  // Reach at 41. Raw score alone would put the partial row first.
  //
  // Verified these bite: reversed the partial split in rank.ts (the
  // ordering cases on the profile, Matches, family Matches and Today
  // failed); set PAGE to 5 on the Matches screen (the cap cases
  // failed); rebuilt MatchFilters' clear address from its own keys
  // only (the filter case failed). Each restored.
  const NO_GPA = { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteNoGpa }) };
  const matches = (id: string, sp: Record<string, string> = {}) => render("@/app/org/[slug]/roster/[id]/matches/page", { params: p({ slug: ORG_WITH_MODULES, id }), searchParams: p(sp) });
  const familyMatches = (id: string, sp: Record<string, string> = {}) => {
    currentUser = FAMILY_ID;
    return render("@/app/org/[slug]/family/[id]/matches/page", { params: p({ slug: ORG_WITH_MODULES, id }), searchParams: p(sp) });
  };
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
  // The Matches section of a profile: from its label to its closing
  // See All link, so a row count counts its rows and not the Targets'.
  const matchesSection = (html: string) => {
    const at = html.search(/\d+ Schools? Evaluated/);
    expect(at).toBeGreaterThan(-1);
    const rest = html.slice(at);
    const end = rest.search(/See All \d+ Matches</);
    return end === -1 ? rest : rest.slice(0, end + 24);
  };
  const before = (html: string, first: string, second: string) => {
    expect(html).toContain(first);
    expect(html).toContain(second);
    expect(html.indexOf(first)).toBeLessThan(html.indexOf(second));
  };
  // A tap target (a form's button, a link) inside a link is invalid
  // markup and the live driver fails it. Every `<a ...>` up to its `</a>`
  // must be free of another one and of a form.
  const nestedTapTargets = (html: string) => {
    const out: string[] = [];
    for (const m of html.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)) if (/<a |<form|<button/.test(m[1]!)) out.push(m[0].slice(0, 120));
    return out;
  };
  // N schools, each sponsoring baseball, each with a full fit for the
  // athlete, so a law can see a list longer than one page.
  const addSchools = (athleteId: string, n: number, score = (i: number) => 60 + (i % 30)) => {
    const model = data.schools.find((s) => s.id === IDS.schoolD3)!;
    for (let i = 0; i < n; i++) {
      const id = `00000000-0000-0000-0000-0000000000e${i.toString(16).padStart(2, "0")}`;
      data.schools.push({ ...model, id, name: `Fixture Extra ${String(i).padStart(2, "0")}`, conflicts: [] });
      data.athlete_school_fits.push({
        id: `fitx${i}`,
        org_id: data.orgs[0]!.id,
        athlete_id: athleteId,
        school_id: id,
        score: score(i),
        tag: score(i) >= 80 ? "Safety" : score(i) >= 55 ? "Fit" : "Reach",
        partial: false,
        dimensions: {
          academic: { score: 70, confidence: "high", veto: false, reasons: [], warnings: [] },
          athletic: { score: 70, confidence: "high", veto: false, reasons: [], warnings: [] },
          financial: { score: 70, confidence: "high", veto: false, reasons: [], warnings: [] },
          counted: ["academic", "athletic", "financial"],
        },
        reasons: ["Fixture reason."],
        warnings: [],
        net_cost: 30000 + i,
        inputs_hash: "fixture",
        computed_at: new Date().toISOString(),
      });
    }
  };

  it("the profile ranks the full 41 above the partial 48, counts the schools evaluated and labels the partial row", async () => {
    const html = matchesSection(await render("@/app/org/[slug]/roster/[id]/page", NO_GPA));
    expect(html).toMatch(/2 Schools Evaluated/);
    before(html, "Fixture State University", "Fixture College");
    expect(html).toMatch(/Partial · 1 of 3 scored/);
    expect(html).not.toMatch(/Scored on financial only/);
  });

  it("the profile shows ten rows, the count in the label, and See All only past ten", async () => {
    const two = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(two).toMatch(/2 Schools Evaluated/);
    // Scoped to Matches: the Activity section has its own See All once
    // the athlete has more than five entries (Stage 5 Phase 6).
    expect(matchesSection(two)).not.toMatch(/>See All</);
    expect(two).toMatch(/See All 2 Matches/);
    addSchools(IDS.athlete, 12);
    const html = matchesSection(await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }));
    expect(html).toMatch(/14 Schools Evaluated/);
    expect(html).toMatch(/>See All</);
    expect(html).toMatch(/See All 14 Matches/);
    expect((html.match(/data-kit="row"/g) ?? []).length).toBe(10);
    // The best ten, in Best Fit order: the 93 first, then the 71s; the
    // four lowest (60 to 63) are past the ten and not shown.
    before(html, ">93<", ">71<");
    expect(html).not.toMatch(/>6[0-3]</);
  });

  it("the family athlete page ranks and labels the same way, under /family/", async () => {
    currentUser = FAMILY_ID;
    const page = await render("@/app/org/[slug]/family/[id]/page", NO_GPA);
    const html = matchesSection(page);
    expect(html).toMatch(/2 Schools Evaluated/);
    before(html, "Fixture State University", "Fixture College");
    expect(html).toMatch(/Partial · 1 of 3 scored/);
    expect(hrefs(page).filter((l) => l.startsWith("/org/") && !/\/family(\/|$)/.test(l))).toEqual([]);
  });

  it("Matches ranks the full row first, wears the partial label, and the engine sentence stays out of the row", async () => {
    const html = await matches(IDS.athleteNoGpa);
    before(html, "Fixture State University", "Fixture College");
    expect(html).toMatch(/D3<\/span> · Partial · 1 of 3 scored · 48 · Reach/);
    expect(html).not.toMatch(/Scored on financial only/);
    expect(html).toMatch(/Some Scores Are Partial/);
  });

  it("Matches searches by school name and says how many matched", async () => {
    const html = await matches(IDS.athlete, { q: "state" });
    expect(html).toMatch(/name="q"/);
    expect(html).toMatch(/2 schools scored for Fixture Athlete · 1 matches the search/);
    expect(html).toMatch(/Fixture State University/);
    expect(html).not.toMatch(/Fixture College/);
    const none = await matches(IDS.athlete, { q: "zzzz" });
    expect(none).toMatch(/No School Matches/);
  });

  it("Matches offers the six sorts and ranks by the one in the address", async () => {
    const html = await matches(IDS.athlete);
    expect(html).toMatch(/name="sort"/);
    for (const label of ["Best Fit", "Academic", "Athletic", "Financial", "Net Cost", "A to Z"]) expect(html).toContain(`>${label}</option>`);
    before(html, "Fixture State University", "Fixture College");
    const az = await matches(IDS.athlete, { sort: "az" });
    before(az, "Fixture College", "Fixture State University");
    const cost = await matches(IDS.athlete, { sort: "net_cost" });
    before(cost, "$14,000 net", "$45,200 net");
    const academic = await matches(IDS.athlete, { sort: "academic" });
    before(academic, "Academic 90", "Academic 78");
    // An unknown sort is Best Fit, not an error.
    before(await matches(IDS.athlete, { sort: "distance" }), "Fixture State University", "Fixture College");
  });

  it("Matches shows 25 rows, then Show More, and ?show=50 shows the rest", async () => {
    addSchools(IDS.athlete, 30);
    const html = await matches(IDS.athlete);
    expect((html.match(/data-kit="row"/g) ?? []).length).toBe(25);
    expect(html).toMatch(/Showing 25 of 32/);
    expect(html).toMatch(new RegExp(`href="/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/matches\\?show=50"[^>]*>Show More<`));
    const more = await matches(IDS.athlete, { show: "50" });
    expect((more.match(/data-kit="row"/g) ?? []).length).toBe(32);
    expect(more).not.toMatch(/Show More/);
    // The Show More address keeps the search and the sort.
    const sorted = await matches(IDS.athlete, { sort: "az", q: "fixture" });
    expect(sorted).toMatch(/matches\?sort=az&amp;q=fixture&amp;show=50"/);
    // Two rows never show it.
    expect(await matches(IDS.athleteNoGpa)).not.toMatch(/Show More/);
  });

  it("Add Target sits inside the row and outside its link; a target's stage pill opens the target on the Board", async () => {
    const html = await matches(IDS.athlete);
    expect(nestedTapTargets(html)).toEqual([]);
    // Fixture State University is already a target: its row shows the
    // stage and links to the Board, and offers no Add Target.
    const target = rowAfter(html, "Fixture State University");
    expect(target).toMatch(new RegExp(`href="/org/${ORG_WITH_MODULES}/board/${IDS.target}"`));
    expect(target).not.toMatch(/Add Target/);
    // Fixture College is not: the row carries the form and the button.
    const open = rowAfter(html, "Fixture College");
    expect(open).toMatch(/<form[\s\S]*<button[^>]*>Add Target<\/button>[\s\S]*<\/form>/);
    // No "Make a Target" second line and no Score mark: the row is compact.
    expect(html).not.toMatch(/Make a Target|Open on Board/);
    expect(html).not.toMatch(SCORE);
    expect(html).toMatch(/D2<\/span> · 93 · Safety/);
  });

  it("family Matches has the search and the sort, ranks the same way, and no target action", async () => {
    const html = await familyMatches(IDS.athleteNoGpa);
    before(html, "Fixture State University", "Fixture College");
    expect(html).toMatch(/Partial · 1 of 3 scored/);
    expect(html).toMatch(/name="q"/);
    expect(html).toMatch(/name="sort"/);
    expect(html).not.toMatch(/Add Target|Make a Target/);
    // The search box is the one form on the screen (the kit's SearchField).
    expect((html.match(/<form/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(html).not.toMatch(/<button[^>]*>Add Target/);
    expect(hrefs(html).filter((l) => l.startsWith("/org/") && !/\/family(\/|$)/.test(l))).toEqual([]);
    const az = await familyMatches(IDS.athlete, { sort: "az" });
    before(az, "Fixture College", "Fixture State University");
    const q = await familyMatches(IDS.athlete, { q: "college" });
    expect(q).toMatch(/1 matches the search/);
    expect(q).not.toMatch(/Fixture State University<\/div>/);
  });

  it("Today's Strong Matches never headlines a partial Safety over a full one", async () => {
    // The transfer's one stored fit is a full Safety (81) at Fixture
    // State University and they have no targets. A partial Safety at 99
    // for Fixture College lands in the same seven-day window.
    data.athlete_school_fits.push({
      ...data.athlete_school_fits.find((f) => f.id === "fit4")!,
      id: "fit-plant",
      athlete_id: IDS.athleteTransfer,
      school_id: IDS.schoolD3,
      score: 99,
      tag: "Safety",
    });
    // A second athlete whose only strong match is a partial Safety at
    // 99: their headline is that row, and it still sits under the
    // transfer's fully scored 81, because the rule between athletes is
    // the same rule as within one. Reviewed 2026-09-27: before this the
    // headlines were ordered by raw score.
    data.athlete_school_fits.push({
      ...data.athlete_school_fits.find((f) => f.id === "fit4")!,
      id: "fit-plant-2",
      athlete_id: IDS.athleteNoGpa,
      school_id: IDS.school,
      score: 99,
      tag: "Safety",
      computed_at: new Date().toISOString(),
    });
    const html = await render("@/app/org/[slug]/page", { params: p({ slug: ORG_WITH_MODULES }) });
    const row = rowAfter(html, "Fixture Transfer");
    expect(row).toMatch(/Fixture State University/);
    expect(row).not.toMatch(/Fixture College/);
    expect(row).toMatch(/1 more not yet a target/);
    const strong = html.slice(html.indexOf("Strong Matches"), html.indexOf("Needs Follow-Up"));
    expect(strong).toMatch(/Fixture Unknown/);
    expect(strong.indexOf("Fixture Transfer")).toBeLessThan(strong.indexOf("Fixture Unknown"));
  });

  it("changing a filter or clearing them keeps the search and the sort", async () => {
    searchParams = new URLSearchParams("q=fixture&sort=az&division=D3");
    const html = await matches(IDS.athlete, { q: "fixture", sort: "az", division: "D3" });
    expect(html).toMatch(/Clear Filters/);
    const clear = html.match(/href="([^"]*)"[^>]*>Clear Filters</)?.[1] ?? "";
    expect(clear).toContain("q=fixture");
    expect(clear).toContain("sort=az");
    expect(clear).not.toContain("division=");
    // The filters and the sort both read the live address rather than
    // rebuilding it from their own values (the 2026-09-27 fix).
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/components/MatchFilters.tsx", "src/components/MatchSort.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/useSearchParams\(\)/);
      expect(src, f).toMatch(/new URLSearchParams\(params\?\.toString\(\) \?\? ""\)/);
      expect(src, f).not.toMatch(/new URLSearchParams\(\)/);
    }
  });
});

// Stage 5 Phases 2 and 3, 2026-09-27 (docs/PLAN_STAGE5.md; Dave approved
// the plan whole). The full laws are advisorLaws.test.ts (the rule, the
// stamp, the sheet, Add Admin) and moreLaws.test.ts (each row in its
// section, every href a registered page, the counts). These are the four
// facts the page list itself leans on, checked from the render side.
//
// Each was planted and seen to fail, then restored byte for byte: the
// Advisor section moved back under the placement row (the first two
// cases failed on every athlete); an Add Admin button put on the family's
// Your Advisor section (the controls case failed); Foundation rendered
// for every org (the More case failed on the Elite fixture); the status
// check dropped from countByAdvisor (the Advisors case read 3 and 0).
describe("LAW: Advisor leads the profile, only an Admin sees its controls, More is grouped, Advisors counts", () => {
  // What the sheet and its ways in look like in markup: the two
  // triggers, Clear, Add Admin, the invite pinned to an athlete, and
  // the field the sheet posts.
  const ASSIGN_CONTROLS = /Assign Athlete|>Assign<|>Change<|Clear Advisor|Add Admin|assignAthleteId|name="advisorId"/;
  // The kit's Section label span, in page order.
  const sectionLabels = (html: string) => [...html.matchAll(/<span class="text-label font-bold uppercase tracking-wide text-muted">([^<]+)<\/span>/g)].map((m) => m[1]!);
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
  const profile = (id: string) => render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id }), searchParams: p({}) });

  it("Advisor is the first section on every staff profile, above the stage line or the placement row", async () => {
    // The thing directly under the header on each profile: the stage
    // card for an athlete still recruiting, the outcome buttons or the
    // draft line for a placed one.
    const below: Array<[string, string]> = [
      [IDS.athlete, `/board?athlete=${IDS.athlete}`],
      [IDS.athleteTransfer, `/board?athlete=${IDS.athleteTransfer}`],
      [IDS.athleteCommitted, "Mark Enrolled"],
      [IDS.athleteEnrolled, "Mark Graduated"],
      [IDS.athleteDrafted, "Round 5, 2026"],
    ];
    for (const [id, marker] of below) {
      const html = await profile(id);
      expect(sectionLabels(html)[0], id).toBe("Advisor");
      const advisor = html.indexOf(">Advisor<");
      expect(advisor, id).toBeGreaterThan(-1);
      expect(html.indexOf(marker), `${id} ${marker}`).toBeGreaterThan(advisor);
      expect(html.indexOf("NCAA Eligibility"), id).toBeGreaterThan(advisor);
    }
  });

  it("the profile offers Change with an advisor and Assign without one, never a picker on Edit", async () => {
    const assigned = await profile(IDS.athlete);
    expect(assigned).toMatch(/>Change</);
    expect(assigned).not.toMatch(/>Assign</);
    const empty = await profile(IDS.athleteTransfer);
    expect(empty).toMatch(/No Advisor Assigned[\s\S]*>Assign</);
    expect(empty).not.toMatch(/>Change</);
    const edit = await render("@/app/org/[slug]/roster/[id]/edit/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(edit).not.toMatch(/name="advisorId"/);
  });

  it("a family sees its advisor by name and no way to change them; a Viewer sees no advisor control anywhere", async () => {
    currentUser = FAMILY_ID;
    const family = await render("@/app/org/[slug]/family/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(family).toMatch(/Your Advisor[\s\S]*Example Owner/);
    expect(family).not.toMatch(ASSIGN_CONTROLS);
    // Every family and member screen in the list, not only the athlete's.
    for (const page of PAGES.filter((x) => x.as === FAMILY_ID || x.as === MEMBER_ID)) {
      currentUser = page.as!;
      const html = await render(page.path, page.props);
      expect(html, page.name).not.toMatch(ASSIGN_CONTROLS);
      expect(hrefs(html).filter((l) => /\/members\/new|\/advisors$/.test(l)), page.name).toEqual([]);
    }
    // And neither reaches the sheet's own screens.
    for (const who of [FAMILY_ID, MEMBER_ID]) {
      currentUser = who;
      await expect(profile(IDS.athlete)).rejects.toThrow(REDIRECT + "/unauthorized");
      await expect(render("@/app/org/[slug]/members/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ role: "owner", assignAthleteId: IDS.athlete }) })).rejects.toThrow(REDIRECT + "/unauthorized");
    }
  });

  it("More renders its groups for an Admin in the plan's order, each with something in it, and drops Foundation without the modules", async () => {
    const bridge = await render("@/app/org/[slug]/more/page", { params: p({ slug: ORG_WITH_MODULES }) });
    const labels = sectionLabels(bridge);
    expect(labels).toEqual(["People", "Program", "Reference", "Matching", "Foundation", "Organization"]);
    // No group is an empty heading: each holds a row or a form.
    for (let i = 0; i < labels.length; i++) {
      const start = bridge.indexOf(`>${labels[i]}<`);
      const end = i + 1 < labels.length ? bridge.indexOf(`>${labels[i + 1]}<`) : bridge.length;
      expect(bridge.slice(start, end), labels[i]).toMatch(/data-kit="row"|<form/);
    }
    expect(hrefs(bridge)).toContain(`/org/${ORG_WITH_MODULES}/advisors`);
    const elite = await render("@/app/org/[slug]/more/page", { params: p({ slug: ORG_WITHOUT_MODULES }) });
    expect(sectionLabels(elite)).toEqual(["People", "Program", "Reference", "Matching", "Organization"]);
    expect(elite).not.toMatch(/Fundraising|>Board</);
  });

  it("Advisors counts the Active and Transferring athletes each Admin advises, and says how many have nobody", async () => {
    const advisors = () => render("@/app/org/[slug]/advisors/page", { params: p({ slug: ORG_WITH_MODULES }) });
    const before = await advisors();
    expect(before).toMatch(/Example Owner[\s\S]*Head of Recruiting<\/span> · 2 athletes/);
    expect(before).toMatch(/2 athletes still being recruited have no advisor yet\./);
    expect(hrefs(before)).toContain(`/org/${ORG_WITH_MODULES}/members/${OWNER_ID}`);
    // Pausing one of the owner's athletes takes them off the count, the
    // same as the reminders; assigning the transfer takes one off the
    // count of athletes with nobody.
    data.athletes.find((a) => a.id === IDS.athleteNoGpa)!.status = "Inactive";
    data.athletes.find((a) => a.id === IDS.athleteTransfer)!.advisor_id = OWNER_ID;
    const after = await advisors();
    expect(after).toMatch(/Head of Recruiting<\/span> · 2 athletes/);
    expect(after).toMatch(/1 athlete still being recruited has no advisor yet\./);
    data.athletes.find((a) => a.id === IDS.athleteTransfer)!.advisor_id = null;
    expect(await advisors()).toMatch(/Head of Recruiting<\/span> · 1 athlete</);
  });
});

// Stage 5 Phase 6, 2026-09-27 (Dave approved the whole plan): the
// activity log. Who did what to whom, newest first, for Admins only.
// The profile shows the last five with See All; the org screen and the
// athlete's own screen list everything, search the summary and the
// person, and stop at 50 with Show More. A Viewer and an Athlete open
// none of it, and no summary carries the text of a note, a message, a
// check-in or a document reading. Each was planted and seen to fail,
// then restored: the staff guard dropped from the org screen (the
// Viewer and Athlete case failed); a check-in note put into a fixture
// summary (the content case failed); the profile's cap of five raised
// to six (the See All case failed); the org filter dropped from the
// loader (the Elite row appeared on the Bridge screen).
describe("LAW: the activity log is the Admin's, five on the profile, searchable, and never carries the text of anything", () => {
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
  const profile = (id: string) => render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id }), searchParams: p({}) });
  const orgLog = (sp: Record<string, string> = {}) => render("@/app/org/[slug]/activity/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p(sp) });
  const athleteLog = (id: string, sp: Record<string, string> = {}) => render("@/app/org/[slug]/roster/[id]/activity/page", { params: p({ slug: ORG_WITH_MODULES, id }), searchParams: p(sp) });
  // The profile's Activity section: from its label to the next one.
  const activitySection = (html: string) => {
    const at = html.indexOf(">Activity<");
    expect(at).toBeGreaterThan(-1);
    const end = html.indexOf(">Contacts<", at);
    expect(end).toBeGreaterThan(at);
    return html.slice(at, end);
  };
  const BRIDGE_ROWS = () => data.activity_log.filter((r) => r.org_id === data.orgs.find((o) => o.slug === ORG_WITH_MODULES)!.id);

  it("the profile shows the last five, newest first, with See All to the full log, and the oldest is left off", async () => {
    const section = activitySection(await profile(IDS.athlete));
    // Six entries on the fixture athlete: the five newest show, the
    // September 5 "Added" entry is the one past five.
    // Each entry's sentence is one semibold body line, a Row's or a Card's.
    expect((section.match(/text-body font-semibold text-ink/g) ?? []).length).toBe(5);
    expect(section).toMatch(/Sent a message[\s\S]*Logged a call check-in[\s\S]*Moved Fixture Athlete at Fixture State University[\s\S]*Added Fixture State University as a target[\s\S]*Set Example Owner as the advisor/);
    expect(section).not.toContain("Added Fixture Athlete");
    expect(section).toMatch(/>See All</);
    expect(hrefs(section)).toContain(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/activity`);
    // The full screen has all six, the oldest last.
    const full = await athleteLog(IDS.athlete);
    expect(full).toMatch(/Sent a message[\s\S]*Added Fixture Athlete/);
    expect(full).not.toMatch(/>Show More</);
  });

  it("five entries or fewer have no See All, and none at all reads as an empty state", async () => {
    data.activity_log = data.activity_log.filter((r) => r.id !== "al1");
    const five = activitySection(await profile(IDS.athlete));
    expect(five).not.toMatch(/>See All</);
    expect(five).toContain("Added Fixture State University as a target");
    const none = activitySection(await profile(IDS.athleteTransfer));
    expect(none).toMatch(/No Activity Yet/);
    expect(none).not.toMatch(/>See All</);
    expect(await athleteLog(IDS.athleteTransfer)).toMatch(/No Activity Yet/);
  });

  it("the org screen lists the org's own entries newest first and none of another org's", async () => {
    const html = await orgLog();
    expect(html).toMatch(/Invited Example Member as a Viewer/);
    expect(html).not.toMatch(/Squad Athlete/);
    // Newest first across the whole org.
    const order = ["Sent a message", "Logged a call check-in", "Moved Fixture Athlete", "Added Fixture State University as a target", "Set Example Owner as the advisor", "Added Fixture Athlete", "Invited Example Member"];
    let last = -1;
    for (const text of order) {
      const at = html.indexOf(text);
      expect(at, text).toBeGreaterThan(last);
      last = at;
    }
    // Each entry names who did it and when.
    expect(html).toMatch(/Fixture Parent<\/span> · /);
    expect(html).toMatch(/Example Owner(<\/span>)? · /);
  });

  it("only an Admin opens the org screen and an athlete's log; a Viewer and an Athlete are refused", async () => {
    for (const who of [MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      await expect(orgLog(), `org log as ${who}`).rejects.toThrow(REDIRECT + "/unauthorized");
      await expect(athleteLog(IDS.athlete), `athlete log as ${who}`).rejects.toThrow(REDIRECT + "/unauthorized");
    }
    currentUser = null;
    await expect(orgLog()).rejects.toThrow(REDIRECT + "/login");
    // An athlete of another org is not this org's to open.
    currentUser = OWNER_ID;
    await expect(athleteLog(IDS.athleteElite)).rejects.toThrow(NOT_FOUND);
  });

  it("no Viewer or Athlete screen carries an activity entry or a link to one", async () => {
    const entries = BRIDGE_ROWS().map((r) => String(r.summary));
    expect(entries.length).toBeGreaterThan(5);
    for (const page of PAGES.filter((x) => x.as === FAMILY_ID || x.as === MEMBER_ID)) {
      currentUser = page.as!;
      const html = await render(page.path, page.props);
      expect(hrefs(html).filter((l) => /\/activity(\/|\?|$)/.test(l)), page.name).toEqual([]);
      for (const summary of entries) expect(html, `${page.name}: ${summary}`).not.toContain(summary.replace(/'/g, "&#x27;"));
    }
  });

  it("search narrows by the words of a summary and by the person, and a term nothing matches reaches the empty state", async () => {
    const byWords = await orgLog({ q: "advisor" });
    expect(byWords).toMatch(/Set Example Owner as the advisor/);
    expect(byWords).not.toMatch(/Invited Example Member|Sent a message|Logged a call/);
    const byPerson = await orgLog({ q: "parent" });
    expect(byPerson).toMatch(/Sent a message/);
    expect(byPerson).not.toMatch(/Set Example Owner as the advisor|Invited Example Member/);
    const none = await orgLog({ q: "zzzz" });
    expect(none).toMatch(/Nothing Matches/);
    expect(none).not.toMatch(/Sent a message/);
    // The box keeps what was searched.
    expect(byWords).toMatch(/value="advisor"/);
  });

  it("the org screen and an athlete's log stop at 50 and Show More asks for 50 more", async () => {
    const org = data.orgs.find((o) => o.slug === ORG_WITH_MODULES)!.id;
    for (let i = 0; i < 60; i++) {
      data.activity_log.push({ id: `bulk${i}`, org_id: org, athlete_id: IDS.athlete, actor_id: OWNER_ID, action: "athlete_edited", subject_type: "athlete", subject_id: IDS.athlete, summary: `Edited Fixture Athlete ${i}`, created_at: new Date(Date.UTC(2026, 8, 25, 0, i)).toISOString() });
    }
    for (const html of [await orgLog(), await athleteLog(IDS.athlete)]) {
      expect((html.match(/Edited Fixture Athlete \d+/g) ?? []).length).toBe(50);
      expect(html).toMatch(/>Show More</);
    }
    expect(hrefs(await orgLog())).toContain(`/org/${ORG_WITH_MODULES}/activity?show=100`);
    expect(hrefs(await athleteLog(IDS.athlete))).toContain(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/activity?show=100`);
    const more = await orgLog({ show: "100" });
    expect((more.match(/Edited Fixture Athlete \d+/g) ?? []).length).toBe(60);
    expect(more).not.toMatch(/>Show More</);
  });

  it("no summary on screen carries a note, a message, a check-in or a document's text, and search cannot reach them", async () => {
    // Everything the fixture holds as free text or as a reading.
    const secrets = [
      ...data.athlete_notes.map((n) => n.body as string),
      ...data.athlete_messages.map((m) => m.body as string),
      ...data.athlete_checkins.map((c) => c.notes as string),
      ...data.documents.flatMap((d) => ((d.extracted as { warnings?: string[] } | null)?.warnings) ?? []),
      "Fixture check-in note",
      "Fixture message from staff",
      "Fixture reply from the family",
      "The GPA cell was smudged",
    ].filter((t): t is string => typeof t === "string" && t.length > 4);
    expect(secrets.length).toBeGreaterThan(5);
    // The rows themselves.
    for (const r of data.activity_log) for (const t of secrets) expect(r.summary, `${r.id}: ${t}`).not.toContain(t.replace(/\.$/, ""));
    // The screens that show them. The org screen and the athlete's log
    // carry nothing but entries; on the profile only its Activity
    // section is looked at, since Notes sits on the same page.
    const shown = [await orgLog(), await athleteLog(IDS.athlete), activitySection(await profile(IDS.athlete))];
    for (const html of shown) for (const t of secrets) expect(html).not.toContain(t.replace(/\.$/, ""));
    // A term from a note or a message finds nothing: search reads the
    // summary and the name, and the text was never in either.
    for (const q of ["Fixture note", "check-in note", "message from staff", "smudged"]) {
      expect(await orgLog({ q }), q).toMatch(/Nothing Matches/);
    }
  });

  it("an entry links only to a screen that exists for it, and a removed athlete's entries link nowhere", async () => {
    const html = await orgLog();
    const links = hrefs(html).filter((l) => l.startsWith(`/org/${ORG_WITH_MODULES}/roster/`));
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}(/checkins|/messages)?$`));
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-28T00:00:00.000Z";
    const gone = await orgLog();
    expect(hrefs(gone).filter((l) => l.includes(`/roster/${IDS.athlete}`))).toEqual([]);
    expect(gone).toMatch(/Sent a message/);
  });
});

// Stage 5 Phase 4, 2026-09-27 (Dave approved the whole plan): assignments.
// An Admin gives an athlete a piece of work; the Athlete login answers it
// through one button per row and one submit screen; a Viewer reads none of
// it. Overdue is computed from the due date and the status on every draw,
// so the laws move a date or a status on the fixture row and watch the
// screens follow. Each was planted and seen to fail, then restored: the
// Today empty guard removed (the empty case rendered the headings); the
// family row given a second link (the one-button case failed); a family
// note put on the family athlete page (the no-Admin-text case failed); a
// cancelled row let through on the submit screen (the 404 case failed);
// the Viewer's program screen given an assignment title (the Viewer case
// failed); the org filter dropped from the loader (the Elite row showed
// on the Bridge screens).
describe("LAW: assignments are the Admin's to give and review, the Athlete login's to answer, and the Viewer reads none", () => {
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
  const sectionLabels = (html: string) => [...html.matchAll(/<span class="text-label font-bold uppercase tracking-wide text-muted">([^<]+)<\/span>/g)].map((m) => m[1]!);
  const slug = ORG_WITH_MODULES;
  const staffBase = `/org/${slug}/roster/${IDS.athlete}/assignments`;
  const familyBase = `/org/${slug}/family/${IDS.athlete}`;
  const TITLES = ["Send Fall Transcript", "Confirm Showcase Dates", "Upload Test Scores", "Complete Family Budget Form", "Confirm Graduation Year", "Register For Fall Camp", "Squad Only Task"];
  const profile = (id: string = IDS.athlete) => render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug, id }), searchParams: p({}) });
  const athleteList = (id: string = IDS.athlete) => render("@/app/org/[slug]/roster/[id]/assignments/page", { params: p({ slug, id }) });
  const newForm = (id: string = IDS.athlete) => render("@/app/org/[slug]/roster/[id]/assignments/new/page", { params: p({ slug, id }) });
  const detail = (assignmentId: string, id: string = IDS.athlete) => render("@/app/org/[slug]/roster/[id]/assignments/[assignmentId]/page", { params: p({ slug, id, assignmentId }) });
  const orgList = (sp: Record<string, string> = {}) => render("@/app/org/[slug]/assignments/page", { params: p({ slug }), searchParams: p(sp) });
  const today = () => render("@/app/org/[slug]/page", { params: p({ slug }) });
  const mine = () => render("@/app/org/[slug]/mine/page", { params: p({ slug }) });
  const familyHome = (id: string = IDS.athlete) => render("@/app/org/[slug]/family/[id]/page", { params: p({ slug, id }) });
  const familySubmit = (assignmentId: string, id: string = IDS.athlete) => render("@/app/org/[slug]/family/[id]/assignments/[assignmentId]/page", { params: p({ slug, id, assignmentId }) });
  // The profile's Assignments section: from its label to the next one.
  const profileSection = (html: string) => {
    const at = html.indexOf(">Assignments<");
    expect(at).toBeGreaterThan(-1);
    const labels = sectionLabels(html);
    const next = labels[labels.indexOf("Assignments") + 1];
    const end = next ? html.indexOf(`>${next}<`, at) : html.length;
    return html.slice(at, end === -1 ? html.length : end);
  };
  // A section of Today or the org list, from its label to the next one.
  const sectionOf = (html: string, label: string) => {
    const labels = sectionLabels(html);
    const at = html.indexOf(`>${label}<`);
    expect(at, label).toBeGreaterThan(-1);
    const next = labels[labels.indexOf(label) + 1];
    const end = next ? html.indexOf(`>${next}<`, at) : html.length;
    return html.slice(at, end === -1 ? html.length : end);
  };

  // One Row's whole markup by its title. A Row with a link is
  // `<a ...><div data-kit="row">`, so the link sits before the marker and
  // rowAfter would hand it to the row above; this splits ahead of the
  // anchor instead.
  const rowChunk = (html: string, title: string) => {
    const chunks = html.split(/(?=<a [^>]*><div data-kit="row")|(?<!<a [^>]*>)(?=<div data-kit="row")/);
    const chunk = chunks.find((c) => c.includes(title) && c.includes('data-kit="row"'));
    expect(chunk, title).toBeDefined();
    return chunk!;
  };

  // ── The staff side ────────────────────────────────────────────────

  it("the profile has an Assignments section right after Advisor, three most urgent rows, See All, and New Assignment", async () => {
    const html = await profile();
    const labels = sectionLabels(html);
    expect(labels[0]).toBe("Advisor");
    expect(labels[1]).toBe("Assignments");
    const section = profileSection(html);
    // Four rows are open or waiting (overdue, due soon, sent back,
    // submitted, in that order of urgency); three show, the overdue one
    // first, and the rest is behind See All. Done and cancelled rows
    // never show here.
    const rowLinks = hrefs(section).filter((l) => l.startsWith(`${staffBase}/`) && !l.endsWith("/new"));
    expect(rowLinks).toEqual([IDS.assignmentOverdue, IDS.assignmentDueSoon, IDS.assignmentRevision].map((id) => `${staffBase}/${id}`));
    expect(section).toMatch(/Send Fall Transcript[\s\S]*Overdue[\s\S]*Assigned/);
    expect(section.indexOf("Send Fall Transcript")).toBeLessThan(section.indexOf("Confirm Showcase Dates"));
    expect(section).not.toMatch(/Confirm Graduation Year|Register For Fall Camp|Upload Test Scores/);
    expect(section).toMatch(/>See All</);
    expect(hrefs(section)).toContain(staffBase);
    expect(hrefs(section)).toContain(`${staffBase}/new`);
    expect(hrefs(section)).toContain(`${staffBase}/${IDS.assignmentOverdue}`);
    // The Advisor sheet's own trigger is still the one bare Assign.
    expect(section).not.toMatch(/>Assign</);
  });

  it("an athlete with nothing assigned gets an empty state that offers New Assignment, and no See All", async () => {
    const section = profileSection(await profile(IDS.athleteTransfer));
    expect(section).toMatch(/No Assignments Yet/);
    expect(hrefs(section)).toContain(`/org/${slug}/roster/${IDS.athleteTransfer}/assignments/new`);
    expect(section).not.toMatch(/>See All</);
  });

  it("the athlete's list groups Open, Submitted and Done, urgent first, and leaves out none of them", async () => {
    const html = await athleteList();
    expect(sectionLabels(html)).toEqual(["Open", "Submitted", "Done"]);
    expect(html).toMatch(/Send Fall Transcript[\s\S]*Confirm Showcase Dates[\s\S]*Complete Family Budget Form[\s\S]*>Submitted<[\s\S]*Upload Test Scores[\s\S]*>Done<[\s\S]*Confirm Graduation Year[\s\S]*Register For Fall Camp/);
    expect(html).not.toContain("Squad Only Task");
    expect(hrefs(html)).toContain(`${staffBase}/new`);
    // Every row opens its own detail screen.
    for (const id of [IDS.assignmentOverdue, IDS.assignmentDueSoon, IDS.assignmentSubmitted, IDS.assignmentRevision, IDS.assignmentComplete, IDS.assignmentCancelled]) {
      expect(hrefs(html), id).toContain(`${staffBase}/${id}`);
    }
  });

  it("the create screen is a form with every field, and the Create button", async () => {
    const html = await newForm();
    expect(html).toMatch(/name="title"/);
    expect(html).toMatch(/name="instructions"/);
    expect(html).toMatch(/name="category"/);
    expect(html).toMatch(/name="kind"/);
    expect(html).toMatch(/name="dueOn"/);
    expect(html).toMatch(/Create Assignment/);
  });

  it("a submitted row shows the file as a Family Upload row and offers Complete, Needs Revision and a confirmed Cancel", async () => {
    const html = await detail(IDS.assignmentSubmitted);
    expect(html).toMatch(/Upload Test Scores[\s\S]*Submission[\s\S]*Sent the June score report[\s\S]*june-score-report\.pdf[\s\S]*Family Upload[\s\S]*Review[\s\S]*Complete[\s\S]*Needs Revision[\s\S]*Cancel Assignment/);
    expect(hrefs(html)).toContain(`/org/${slug}/documents/${IDS.documentFiled}`);
    expect(html).toMatch(/<button[^>]*>Complete<\/button>/);
    expect(html).toMatch(/<button[^>]*>Needs Revision<\/button>/);
    expect(html).toMatch(/name="comment"/);
    expect(html).not.toMatch(/>Apply</);
  });

  it("review controls appear on a submitted row and on no other", async () => {
    for (const id of [IDS.assignmentOverdue, IDS.assignmentDueSoon, IDS.assignmentRevision, IDS.assignmentComplete, IDS.assignmentCancelled]) {
      const html = await detail(id);
      expect(html, id).not.toMatch(/<button[^>]*>(Complete|Needs Revision)<\/button>|name="comment"/);
    }
  });

  it("Cancel is offered on an assigned, submitted or sent-back row and never on a finished or cancelled one", async () => {
    for (const id of [IDS.assignmentOverdue, IDS.assignmentDueSoon, IDS.assignmentSubmitted, IDS.assignmentRevision]) {
      expect(await detail(id), id).toMatch(/Cancel Assignment/);
    }
    for (const id of [IDS.assignmentComplete, IDS.assignmentCancelled]) {
      expect(await detail(id), id).not.toMatch(/Cancel Assignment/);
    }
  });

  it("the reviewer's comment shows on the Admin's detail screen of a sent-back row", async () => {
    expect(await detail(IDS.assignmentRevision)).toMatch(/Reviewer Comment[\s\S]*second parent/);
  });

  it("another org's assignment, a cancelled row read through the wrong athlete, and a removed athlete are not found", async () => {
    await expect(detail(IDS.assignmentElite)).rejects.toThrow(NOT_FOUND);
    await expect(detail(IDS.assignmentOverdue, IDS.athleteTransfer)).rejects.toThrow(NOT_FOUND);
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-28T00:00:00.000Z";
    await expect(detail(IDS.assignmentOverdue)).rejects.toThrow(NOT_FOUND);
    await expect(athleteList()).rejects.toThrow(NOT_FOUND);
    await expect(newForm()).rejects.toThrow(NOT_FOUND);
  });

  it("Overdue is computed from the due date and the status on every draw, never read from the row", async () => {
    const row = data.assignments.find((a) => a.id === IDS.assignmentOverdue)!;
    expect(await athleteList()).toMatch(/>Overdue</);
    // Pushed out to next year, it is not overdue.
    row.due_on = "2099-01-01";
    expect(sectionOf(await athleteList(), "Open")).not.toMatch(/>Overdue</);
    expect(await today()).not.toMatch(/>Overdue<\/span>[\s\S]*Send Fall Transcript/);
    // Due yesterday and submitted, it is waiting on a review, not late.
    row.due_on = "2026-09-01";
    row.status = "submitted";
    expect(await athleteList()).not.toMatch(/Overdue<\/span>[\s\S]{0,400}Send Fall Transcript/);
    // Complete or cancelled with a past date is never overdue.
    for (const status of ["complete", "cancelled"]) {
      row.status = status;
      expect(sectionOf(await athleteList(), "Done"), status).not.toMatch(/>Overdue</);
    }
    // A sent-back row that is late is both.
    const back = data.assignments.find((a) => a.id === IDS.assignmentRevision)!;
    back.due_on = "2026-09-02";
    expect(rowAfter(await athleteList(), "Complete Family Budget Form")).toMatch(/>Overdue<[\s\S]*Needs Revision/);
  });

  // ── The org list, Today, My Athletes ──────────────────────────────

  it("the org list opens with Submitted for Review, then Overdue, Due Soon and Open, each row naming its athlete", async () => {
    const html = await orgList();
    expect(sectionLabels(html)).toEqual(["Submitted for Review", "Overdue", "Due Soon", "Open"]);
    expect(sectionOf(html, "Submitted for Review")).toMatch(/Upload Test Scores[\s\S]*Fixture Athlete/);
    expect(sectionOf(html, "Overdue")).toMatch(/Send Fall Transcript[\s\S]*Fixture Athlete/);
    expect(sectionOf(html, "Due Soon")).toMatch(/Confirm Showcase Dates/);
    expect(sectionOf(html, "Open")).toMatch(/Complete Family Budget Form/);
    // Done, cancelled and another org's rows are not open work.
    expect(html).not.toMatch(/Confirm Graduation Year|Register For Fall Camp|Squad Only Task/);
    expect(hrefs(html)).toContain(`${staffBase}/${IDS.assignmentSubmitted}`);
  });

  it("the org list searches the title and the athlete's name once there are more than five rows, and says when nothing matches", async () => {
    // Four open rows: no search box yet.
    expect(await orgList()).not.toMatch(/type="search"|name="q"/);
    const extra = data.assignments.find((a) => a.id === IDS.assignmentOverdue)!;
    for (let i = 0; i < 3; i++) data.assignments.push({ ...extra, id: `extra${i}`, title: `Extra Task ${i}`, due_on: null });
    const boxed = await orgList();
    expect(boxed).toMatch(/name="q"/);
    const byTitle = await orgList({ q: "showcase" });
    expect(byTitle).toMatch(/Confirm Showcase Dates/);
    expect(byTitle).not.toMatch(/Send Fall Transcript|Extra Task/);
    expect(await orgList({ q: "fixture athlete" })).toMatch(/Send Fall Transcript/);
    expect(await orgList({ q: "zzzz" })).toMatch(/Nothing Matches/);
    // The box keeps what was searched.
    expect(byTitle).toMatch(/value="showcase"/);
  });

  it("the org list with no open work says so, and never lists a removed athlete's rows", async () => {
    data.assignments = [];
    const empty = await orgList();
    expect(empty).toMatch(/Nothing Open/);
    expect(sectionLabels(empty)).toEqual([]);
  });

  it("a removed athlete's assignments leave the org list, Today and My Athletes", async () => {
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-28T00:00:00.000Z";
    expect(await orgList()).not.toMatch(/Send Fall Transcript|Upload Test Scores/);
    const t = await today();
    expect(t).not.toMatch(/>Submitted for Review<|>Overdue</);
  });

  it("Today shows Submitted for Review and Overdue after Needs Follow-Up and before Upcoming, and each only when it has a row", async () => {
    const html = await today();
    const labels = sectionLabels(html);
    const review = labels.indexOf("Submitted for Review");
    const late = labels.indexOf("Overdue");
    expect(review).toBeGreaterThan(-1);
    expect(late).toBe(review + 1);
    expect(labels.indexOf("Needs Follow-Up")).toBeLessThan(review);
    expect(labels.indexOf("Upcoming")).toBe(late + 1);
    expect(sectionOf(html, "Submitted for Review")).toMatch(/Upload Test Scores[\s\S]*Fixture Athlete[\s\S]*Submitted/);
    expect(sectionOf(html, "Overdue")).toMatch(/Send Fall Transcript[\s\S]*Fixture Athlete/);
    expect(hrefs(html)).toContain(`/org/${slug}/assignments`);
    expect(hrefs(html)).toContain(`${staffBase}/${IDS.assignmentSubmitted}`);
    // Nothing waiting and nothing late: neither heading, no See All.
    data.assignments = [];
    const none = await today();
    expect(sectionLabels(none)).not.toContain("Submitted for Review");
    expect(sectionLabels(none)).not.toContain("Overdue");
    expect(hrefs(none)).not.toContain(`/org/${slug}/assignments`);
    // Only a submitted row: the review section and no Overdue.
    data = buildFixture();
    data.assignments = data.assignments.filter((a) => a.id === IDS.assignmentSubmitted);
    const onlyReview = sectionLabels(await today());
    expect(onlyReview).toContain("Submitted for Review");
    expect(onlyReview).not.toContain("Overdue");
    // Only a late row: Overdue and no review section.
    data = buildFixture();
    data.assignments = data.assignments.filter((a) => a.id === IDS.assignmentOverdue);
    const onlyLate = sectionLabels(await today());
    expect(onlyLate).toContain("Overdue");
    expect(onlyLate).not.toContain("Submitted for Review");
  });

  it("Today lists five rows at most in a section and puts the whole count in its header", async () => {
    const late = data.assignments.find((a) => a.id === IDS.assignmentOverdue)!;
    for (let i = 0; i < 7; i++) data.assignments.push({ ...late, id: `late${i}`, title: `Late Task ${i}` });
    const section = sectionOf(await today(), "Overdue");
    expect((section.match(/data-kit="row"/g) ?? []).length).toBe(5);
    expect(section).toMatch(/>8</);
  });

  it("My Athletes says how many open, overdue and to review, only the counts above zero", async () => {
    const html = await mine();
    expect(rowAfter(html, "Fixture Athlete")).toMatch(/3 open assignments · 1 overdue · 1 to review/);
    // The other athlete has none, so nothing is said.
    expect(rowAfter(html, "Fixture Unknown")).not.toMatch(/assignment|overdue|to review/);
    // One open row, nothing late: "1 open assignment", singular, no other part.
    data.assignments = data.assignments.filter((a) => a.id === IDS.assignmentDueSoon);
    const one = rowAfter(await mine(), "Fixture Athlete");
    expect(one).toMatch(/1 open assignment(?!s)/);
    expect(one).not.toMatch(/overdue|to review/);
  });

  it("More offers Assignments under Program to an Admin, and to no one else", async () => {
    const html = await render("@/app/org/[slug]/more/page", { params: p({ slug }) });
    expect(hrefs(html)).toContain(`/org/${slug}/assignments`);
    for (const who of [FAMILY_ID, MEMBER_ID]) {
      currentUser = who;
      const outcome = await render("@/app/org/[slug]/more/page", { params: p({ slug }) }).then(() => "rendered", (e: Error) => e.message);
      expect(outcome, who).not.toBe("rendered");
    }
  });

  // ── The Athlete login ─────────────────────────────────────────────

  it("the athlete's page has Your Assignments above Your Advisor, urgent first, with exactly one button on each open row", async () => {
    currentUser = FAMILY_ID;
    const html = await familyHome();
    const labels = sectionLabels(html);
    expect(labels.indexOf("Your Assignments")).toBeGreaterThan(-1);
    expect(labels.indexOf("Your Assignments")).toBeLessThan(labels.indexOf("Your Advisor"));
    const section = sectionOf(html, "Your Assignments");
    // Overdue, then due soon, then the sent-back row: each with one link
    // to its own submit screen, and no form or button of any other kind.
    const open: Array<[string, string, string]> = [
      ["Send Fall Transcript", IDS.assignmentOverdue, "Submit"],
      ["Confirm Showcase Dates", IDS.assignmentDueSoon, "Submit"],
      ["Complete Family Budget Form", IDS.assignmentRevision, "Resubmit"],
    ];
    let last = -1;
    for (const [title, id, word] of open) {
      const at = section.indexOf(title);
      expect(at, title).toBeGreaterThan(last);
      last = at;
      const row = rowChunk(section, title);
      const links = hrefs(row);
      expect(links, title).toEqual([`${familyBase}/assignments/${id}`]);
      expect(row, title).toContain(`>${word}<`);
      // The row's button is short (320 wide); the long form is on the screen it opens.
      expect(row, title).not.toContain("Fix and Resubmit");
      expect(row, title).not.toMatch(/<button|<form|<input/);
    }
    // No form anywhere on the page: the one write is on the submit screen.
    expect(html).not.toMatch(/<form/);
    expect(section).toMatch(/Overdue/);
    expect(section).toMatch(/Needs a change/);
  });

  it("a submitted row opens its screen and has no button, complete rows are counted in one line of text, and cancelled rows are hidden", async () => {
    currentUser = FAMILY_ID;
    const section = sectionOf(await familyHome(), "Your Assignments");
    const sent = rowChunk(section, "Upload Test Scores");
    expect(sent).toMatch(/Sent\. With an Admin for review\./);
    // A link to the screen that says it was sent, never a button or a form.
    expect(hrefs(sent)).toEqual([`${familyBase}/assignments/${IDS.assignmentSubmitted}`]);
    expect(sent).not.toMatch(/<button|<form|<input/);
    expect(section).toMatch(/1 complete\. Reviewed and done\./);
    // The finished ones are text, not a row that looks tappable and is not.
    expect((section.match(/data-kit="row"/g) ?? []).length).toBe(4);
    expect(section).not.toContain("Confirm Graduation Year");
    expect(section).not.toContain("Register For Fall Camp");
    // The count in the header is the open and submitted rows: four.
    expect(section).toMatch(/>4</);
  });

  it("the athlete's page carries no Admin field: no reviewer comment, no family note, no other athlete's or org's work", async () => {
    currentUser = FAMILY_ID;
    const html = await familyHome();
    expect(html).not.toContain("second parent");
    expect(html).not.toContain("Sent the June score report");
    expect(html).not.toContain("Filled in the budget");
    expect(html).not.toContain("Squad Only Task");
    expect(html).not.toMatch(/Reviewer|reviewed_by|created_by/);
    // The other linked athlete has no work, so no section at all.
    expect(sectionLabels(await familyHome(IDS.athleteNoGpa))).not.toContain("Your Assignments");
  });

  it("the section is not drawn for an athlete with nothing open, submitted or complete", async () => {
    currentUser = FAMILY_ID;
    data.assignments = data.assignments.filter((a) => a.status === "cancelled");
    expect(sectionLabels(await familyHome())).not.toContain("Your Assignments");
    data = buildFixture();
    data.assignments = data.assignments.filter((a) => a.id === IDS.assignmentComplete);
    const only = sectionOf(await familyHome(), "Your Assignments");
    expect(only).toMatch(/1 complete\./);
    expect(only).not.toMatch(/>Submit<|Resubmit/);
  });

  it("the submit screen: an open row asks for the answer, a sent-back row says what to change, a sent row and a done row have no form", async () => {
    currentUser = FAMILY_ID;
    const open = await familySubmit(IDS.assignmentOverdue);
    expect(open).toMatch(/Send Fall Transcript[\s\S]*Overdue[\s\S]*Instructions[\s\S]*Upload your most recent transcript[\s\S]*type="file"[\s\S]*>Submit</);
    expect((open.match(/<form/g) ?? []).length).toBe(1);
    expect((open.match(/<button/g) ?? []).length).toBeLessThanOrEqual(1);
    const back = await familySubmit(IDS.assignmentRevision);
    expect(back).toMatch(/What to Change[\s\S]*second parent[\s\S]*Fix and Resubmit/);
    expect(back).not.toMatch(/type="file"/);
    const sent = await familySubmit(IDS.assignmentSubmitted);
    expect(sent).toMatch(/Sent for Review/);
    expect(sent).not.toMatch(/<form|<button/);
    expect(sent).not.toContain("Sent the June score report");
    const done = await familySubmit(IDS.assignmentComplete);
    expect(done).toMatch(/Complete/);
    expect(done).not.toMatch(/<form|<button/);
  });

  it("the submit screen shows the reviewer's comment only on a row sent back", async () => {
    currentUser = FAMILY_ID;
    for (const id of [IDS.assignmentOverdue, IDS.assignmentDueSoon, IDS.assignmentSubmitted, IDS.assignmentComplete]) {
      expect(await familySubmit(id), id).not.toMatch(/What to Change|second parent/);
    }
    // A stray comment on a row that is not sent back is not shown.
    data.assignments.find((a) => a.id === IDS.assignmentOverdue)!.reviewer_comment = "Old comment that must stay hidden.";
    expect(await familySubmit(IDS.assignmentOverdue)).not.toContain("Old comment that must stay hidden");
  });

  it("a cancelled row, another org's row and another athlete's row are not found, and an unlinked athlete is not found either", async () => {
    currentUser = FAMILY_ID;
    await expect(familySubmit(IDS.assignmentCancelled)).rejects.toThrow(NOT_FOUND);
    await expect(familySubmit(IDS.assignmentElite)).rejects.toThrow(NOT_FOUND);
    await expect(familySubmit(IDS.assignmentOverdue, IDS.athleteTransfer)).rejects.toThrow(NOT_FOUND);
    // A row of the linked athlete read through the other linked athlete.
    await expect(familySubmit(IDS.assignmentOverdue, IDS.athleteNoGpa)).rejects.toThrow(NOT_FOUND);
  });

  it("every link on the Athlete login's assignment screens stays under /family", async () => {
    currentUser = FAMILY_ID;
    const pages = [await familyHome(), await familySubmit(IDS.assignmentOverdue), await familySubmit(IDS.assignmentRevision), await familySubmit(IDS.assignmentSubmitted), await familySubmit(IDS.assignmentComplete)];
    for (const html of pages) {
      const links = hrefs(html);
      expect(links.length).toBeGreaterThan(0);
      const inFamily = (l: string) => /^\/org\/[^/]+\/family(\/|$)/.test(l);
      expect(links.filter((l) => l.startsWith("/org/") && !inFamily(l))).toEqual([]);
    }
    // And the submit screen's only way out is back to the athlete.
    const submit = hrefs(await familySubmit(IDS.assignmentOverdue)).filter((l) => l.startsWith("/org/"));
    expect(submit).toContain(familyBase);
    // Every family screen in the list, however it is reached, has no link to an Admin assignment screen.
    for (const page of PAGES.filter((x) => x.as === FAMILY_ID)) {
      currentUser = FAMILY_ID;
      const html = await render(page.path, page.props);
      expect(hrefs(html).filter((l) => /\/roster\/[^/]+\/assignments|\/org\/[^/]+\/assignments/.test(l)), page.name).toEqual([]);
    }
  });

  it("an Admin cannot open the Athlete login's assignment screen, and the family athlete page is theirs alone", async () => {
    currentUser = OWNER_ID;
    await expect(familySubmit(IDS.assignmentOverdue)).rejects.toThrow(REDIRECT + "/unauthorized");
    currentUser = MEMBER_ID;
    await expect(familySubmit(IDS.assignmentOverdue)).rejects.toThrow(REDIRECT + "/unauthorized");
  });

  // ── The Viewer ────────────────────────────────────────────────────

  it("a Viewer is refused every assignment screen, the org list and the athlete's, and sees no button for them", async () => {
    currentUser = MEMBER_ID;
    const refused = [
      () => athleteList(),
      () => newForm(),
      () => detail(IDS.assignmentSubmitted),
      () => orgList(),
      () => familySubmit(IDS.assignmentOverdue),
      () => profile(),
      () => today(),
      () => mine(),
    ];
    for (const open of refused) {
      const outcome = await open().then(() => "rendered", (e: Error) => e.message);
      expect(outcome).toMatch(/^NEXT_REDIRECT:/);
    }
  });

  it("no Viewer screen names an assignment, links to one or has a Submit button", async () => {
    for (const page of PAGES.filter((x) => x.as === MEMBER_ID)) {
      currentUser = MEMBER_ID;
      const html = await render(page.path, page.props);
      for (const title of TITLES) expect(html, `${page.name}: ${title}`).not.toContain(title);
      expect(hrefs(html).filter((l) => /\/assignments/.test(l)), page.name).toEqual([]);
      expect(html, page.name).not.toMatch(/Your Assignments|Submitted for Review|Fix and Resubmit/);
    }
  });

  it("a login with no session opens none of it", async () => {
    currentUser = null;
    for (const open of [() => athleteList(), () => orgList(), () => detail(IDS.assignmentOverdue), () => familySubmit(IDS.assignmentOverdue)]) {
      await expect(open()).rejects.toThrow(REDIRECT + "/login");
    }
  });

  it("each org's Admin sees only that org's assignments, on the org list and on Today", async () => {
    const eliteList = await render("@/app/org/[slug]/assignments/page", { params: p({ slug: ORG_WITHOUT_MODULES }), searchParams: p({}) });
    expect(eliteList).toContain("Squad Only Task");
    for (const title of TITLES.slice(0, 6)) expect(eliteList).not.toContain(title);
    const eliteToday = await render("@/app/org/[slug]/page", { params: p({ slug: ORG_WITHOUT_MODULES }) });
    expect(sectionOf(eliteToday, "Overdue")).toContain("Squad Only Task");
    expect(eliteToday).not.toContain("Send Fall Transcript");
    expect(await orgList()).not.toContain("Squad Only Task");
    expect(await today()).not.toContain("Squad Only Task");
  });
});
