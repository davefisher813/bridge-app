// Every page in the app, with the params that render it against the
// fixture rather than 404 it.
//
// One list, two readers. src/laws/pageRender.test.ts renders each entry
// and asserts on the text; scripts/preview/build_app_preview.ts renders
// the same entries into the click-through preview. Written out rather
// than globbed on purpose: a glob would let a new page join the app
// without anybody deciding what its arguments are, which is the same as
// not testing it. The render law checks the list against the filesystem.

import { FAMILY_ID, IDS, LONG_INVITE_ID, MEMBER_ID, ORG_WITH_MODULES, ORG_WITHOUT_MODULES } from "@/testing/fixture";

export const p = (o: Record<string, string>) => Promise.resolve(o);

// Every page, with params that should render it rather than 404 it. The
// list is written out rather than globbed on purpose: a glob would let a
// new page join the app without anybody deciding what its arguments are,
// which is the same as not testing it.
// `as` is the fixture user the page renders for. Omitted means the
// fixture owner. The family screens render as the family login, and
// the render law also proves the two roles cannot open each other's.
export const PAGES: Array<{ name: string; path: string; props: Record<string, unknown>; expect: RegExp; as?: string }> = [
  { name: "today", path: "@/app/org/[slug]/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture/ },
  { name: "members", path: "@/app/org/[slug]/members/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Example Owner[\s\S]*Invited[\s\S]*Example Member/ },
  { name: "invite", path: "@/app/org/[slug]/members/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Send Invite/ },
  { name: "member", path: "@/app/org/[slug]/members/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, userId: MEMBER_ID }), searchParams: p({}) }, expect: /Example Member[\s\S]*Coordinator[\s\S]*Remove From/ },
  // An invited person with no name: the address is the title, and it is
  // wider than the screen. The edge-spill audit watches this one.
  // A family login: the page names the one athlete they see instead of
  // offering a role switch.
  { name: "member-family", path: "@/app/org/[slug]/members/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, userId: FAMILY_ID }), searchParams: p({}) }, expect: /Fixture Parent[\s\S]*Sees[\s\S]*Fixture Athlete/ },
  // The family screens, as the family login. Two athletes are linked, so
  // home is the picker and Colleges groups by athlete.
  { name: "family", path: "@/app/org/[slug]/family/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Your Athletes[\s\S]*Fixture Athlete[\s\S]*Fixture Unknown/, as: FAMILY_ID },
  // The member screens (Bridge: Board), as the member login. The
  // fixture chair's seat is this login's, so Your Seat renders.
  { name: "member-home", path: "@/app/org/[slug]/member/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Athletes[\s\S]*Your Seat[\s\S]*Commitment/, as: MEMBER_ID },
  { name: "member-program", path: "@/app/org/[slug]/member/program/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Athlete[\s\S]*Offer/, as: MEMBER_ID },
  { name: "member-athlete", path: "@/app/org/[slug]/member/program/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture Athlete[\s\S]*Fixture State University/, as: MEMBER_ID },
  { name: "member-giving", path: "@/app/org/[slug]/member/giving/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Campaign[\s\S]*Your Seat[\s\S]*Credited to You[\s\S]*The Board/, as: MEMBER_ID },
  { name: "member-more", path: "@/app/org/[slug]/member/more/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Who to Ask[\s\S]*Example Owner[\s\S]*Sign Out/, as: MEMBER_ID },
  // The same screens for an org with no modules: no Giving tab, no
  // seat, nothing about money. Elite Squad is every org that is not
  // Bridge, so this is the common case, not the edge one.
  { name: "member-home-lite", path: "@/app/org/[slug]/member/page", props: { params: p({ slug: ORG_WITHOUT_MODULES }) }, expect: /Athletes[\s\S]*The Program/, as: MEMBER_ID },
  { name: "member-more-lite", path: "@/app/org/[slug]/member/more/page", props: { params: p({ slug: ORG_WITHOUT_MODULES }), searchParams: p({}) }, expect: /Who to Ask[\s\S]*Sign Out/, as: MEMBER_ID },
  { name: "family-athlete", path: "@/app/org/[slug]/family/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture Athlete[\s\S]*Matches[\s\S]*Documents/, as: FAMILY_ID },
  { name: "family-eligibility", path: "@/app/org/[slug]/family/[id]/eligibility/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /core/i, as: FAMILY_ID },
  { name: "family-approvals", path: "@/app/org/[slug]/family/[id]/eligibility/approvals/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /approv/i, as: FAMILY_ID },
  { name: "family-caveats", path: "@/app/org/[slug]/family/[id]/eligibility/caveats/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Things to Know/i, as: FAMILY_ID },
  { name: "family-transcript", path: "@/app/org/[slug]/family/[id]/transcript/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /English 11/, as: FAMILY_ID },
  { name: "family-metrics", path: "@/app/org/[slug]/family/[id]/metrics/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Metrics/, as: FAMILY_ID },
  { name: "family-matches", path: "@/app/org/[slug]/family/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Ranked[\s\S]*Fixture State University/, as: FAMILY_ID },
  { name: "family-match", path: "@/app/org/[slug]/family/[id]/matches/[schoolId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, schoolId: IDS.school }) }, expect: /How the Score Is Built/, as: FAMILY_ID },
  { name: "family-colleges", path: "@/app/org/[slug]/family/colleges/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture State University[\s\S]*Visits/, as: FAMILY_ID },
  { name: "family-college", path: "@/app/org/[slug]/family/colleges/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) }, expect: /Fixture State University[\s\S]*Where Things Stand/, as: FAMILY_ID },
  { name: "family-more", path: "@/app/org/[slug]/family/more/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Who to Ask[\s\S]*Example Owner[\s\S]*Sign Out/, as: FAMILY_ID },
  { name: "member-long-address", path: "@/app/org/[slug]/members/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, userId: LONG_INVITE_ID }), searchParams: p({}) }, expect: /example-organization\.test/ },
  { name: "roster", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Athlete/ },
  // The search path on each list that has one: the term narrows the
  // rows, and a term nothing matches reaches the empty state rather
  // than an empty screen.
  { name: "roster-search", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "transfer" }) }, expect: /Fixture Transfer/ },
  { name: "roster-search-empty", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "zzzz" }) }, expect: /Nobody Matches/ },
  { name: "athlete", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture Athlete/ },
  { name: "athlete-transfer", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /Fixture Transfer/ },
  { name: "athlete-committed", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) }, expect: /Fixture Committed[\s\S]*Mark Enrolled/ },
  { name: "athlete-enrolled", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Enrolled[\s\S]*Fixture State University/ },
  { name: "enroll-athlete", path: "@/app/org/[slug]/roster/[id]/enroll/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) }, expect: /Fixture State University[\s\S]*Will Close[\s\S]*Enrolled On/ },
  { name: "athlete-graduated", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteGraduated }) }, expect: /Fixture Tech[\s\S]*Graduated May 15, 2026/ },
  { name: "athlete-drafted", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteDrafted }) }, expect: /Fixture Pros[\s\S]*Round 5, 2026/ },
  { name: "graduate-athlete", path: "@/app/org/[slug]/roster/[id]/graduate/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Fixture State University[\s\S]*Graduated On/ },
  { name: "draft-athlete", path: "@/app/org/[slug]/roster/[id]/draft/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) }, expect: /Will Close[\s\S]*Team[\s\S]*Round/ },
  { name: "draft-details", path: "@/app/org/[slug]/roster/[id]/draft/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteDrafted }) }, expect: /Draft Details[\s\S]*Fixture Pros/ },
  { name: "matches-enrolled", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }), searchParams: p({}) }, expect: /Enrolled/ },
  { name: "family-athlete-enrolled", path: "@/app/org/[slug]/family/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Enrolled[\s\S]*Fixture State University/, as: FAMILY_ID },
  { name: "family-matches-enrolled", path: "@/app/org/[slug]/family/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Enrolled/, as: FAMILY_ID },
  { name: "eligibility-transfer", path: "@/app/org/[slug]/roster/[id]/eligibility/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /Fixture Transfer|transfer/i },
  { name: "transcript-transfer", path: "@/app/org/[slug]/roster/[id]/transcript/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /Fixture Transfer|transcript/i },
  { name: "edit-athlete-transfer", path: "@/app/org/[slug]/roster/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /Fixture Transfer/ },
  { name: "eligibility", path: "@/app/org/[slug]/roster/[id]/eligibility/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /core/i },
  { name: "caveats", path: "@/app/org/[slug]/roster/[id]/eligibility/caveats/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Things to Know/i },
  { name: "approvals", path: "@/app/org/[slug]/roster/[id]/eligibility/approvals/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /approv/i },
  { name: "transcript", path: "@/app/org/[slug]/roster/[id]/transcript/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /English 11/ },
  { name: "board", path: "@/app/org/[slug]/board/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture State University/ },
  { name: "targets-search", path: "@/app/org/[slug]/board/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "state" }) }, expect: /Fixture State University/ },
  { name: "target", path: "@/app/org/[slug]/board/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) }, expect: /Fixture State University/ },
  { name: "dimension", path: "@/app/org/[slug]/board/[id]/dimensions/[dim]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target, dim: "academic" }) }, expect: /Academic/ },
  { name: "communications", path: "@/app/org/[slug]/board/[id]/communications/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) }, expect: /Fixture note/ },
  { name: "schools", path: "@/app/org/[slug]/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture State University/ },
  { name: "schools-search", path: "@/app/org/[slug]/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "state" }) }, expect: /Fixture State University/ },
  { name: "schools-imported", path: "@/app/org/[slug]/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ imported: "3" }) }, expect: /3 Schools Imported/ },
  { name: "metrics", path: "@/app/org/[slug]/roster/[id]/metrics/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /FB Velo[\s\S]*86 mph[\s\S]*Premier/ },
  { name: "metrics-empty", path: "@/app/org/[slug]/roster/[id]/metrics/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteNoGpa }) }, expect: /Nothing Logged Yet/ },
  { name: "matches", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({}) }, expect: /Fixture State University[\s\S]*Fixture College/ },
  { name: "matches-filtered", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({ division: "D3" }) }, expect: /Fixture College/ },
  { name: "matches-partial", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteNoGpa }), searchParams: p({}) }, expect: /Scored on financial only/ },
  { name: "edit-school", path: "@/app/org/[slug]/schools/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) }, expect: /Fixture State University/ },
  { name: "import-schools", path: "@/app/org/[slug]/schools/import/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Download the Template/ },
  { name: "school", path: "@/app/org/[slug]/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) }, expect: /Fixture Athlete/ },
  { name: "schoolD3", path: "@/app/org/[slug]/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.schoolD3 }) }, expect: /Fixture College/ },
  { name: "grading-scales", path: "@/app/org/[slug]/grading-scales/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture High School/ },
  { name: "approved-courses", path: "@/app/org/[slug]/approved-courses/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Unscaled High School/ },
  { name: "documents", path: "@/app/org/[slug]/documents/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /fixture.pdf/ },
  { name: "documents-search", path: "@/app/org/[slug]/documents/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "fixture" }) }, expect: /fixture.pdf/ },
  { name: "fundraising", path: "@/app/org/[slug]/fundraising/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fundraising/ },
  { name: "gifts", path: "@/app/org/[slug]/fundraising/gifts/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture Donor/ },
  { name: "gifts-search", path: "@/app/org/[slug]/fundraising/gifts/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "fixture" }) }, expect: /Fixture Donor/ },
  { name: "pledges", path: "@/app/org/[slug]/fundraising/pledges/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Donor/ },
  { name: "donors", path: "@/app/org/[slug]/fundraising/donors/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Donor/ },
  { name: "donors-search", path: "@/app/org/[slug]/fundraising/donors/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "fixture" }) }, expect: /Fixture Donor/ },
  { name: "donor", path: "@/app/org/[slug]/fundraising/donors/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.donor }) }, expect: /Fixture Donor/ },
  { name: "campaign", path: "@/app/org/[slug]/fundraising/campaigns/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.campaign }) }, expect: /Fixture Campaign/ },
  { name: "grants", path: "@/app/org/[slug]/fundraising/grants/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Trust/ },
  { name: "governance", path: "@/app/org/[slug]/board-governance/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture Executive Board/ },
  { name: "governance-board", path: "@/app/org/[slug]/board-governance/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.board }), searchParams: p({}) }, expect: /Fixture Chair/ },
  { name: "seat", path: "@/app/org/[slug]/board-governance/[id]/seats/[memberId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.board, memberId: IDS.boardMember }), searchParams: p({}) }, expect: /Fixture Chair/ },
  { name: "all-seats", path: "@/app/org/[slug]/board-governance/members/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture Chair/ },
  { name: "more", path: "@/app/org/[slug]/more/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Foundation/ },
  { name: "approved-list", path: "@/app/org/[slug]/approved-courses/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.orgList }), searchParams: p({}) }, expect: /Unscaled High School/ },
  { name: "grading-scale", path: "@/app/org/[slug]/grading-scales/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.orgScale }) }, expect: /Fixture High School/ },
  { name: "document", path: "@/app/org/[slug]/documents/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.document }) }, expect: /fixture.pdf/ },
  { name: "documentFailed", path: "@/app/org/[slug]/documents/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: "doc-failed" }) }, expect: /legible/ },
  { name: "documentStuck", path: "@/app/org/[slug]/documents/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: "doc-stuck" }) }, expect: /Did Not Finish/ },
  { name: "budget", path: "@/app/org/[slug]/fundraising/budget/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /udget/ },

  // The form screens. Added 2026-09-18 with the action harness: they had
  // been excluded on the grounds that "a render proves nothing about a
  // form that has to be posted", which is true of the posting and false
  // of everything else. A form that throws while listing the athletes to
  // choose from never gets as far as being posted.
  { name: "new-athlete", path: "@/app/org/[slug]/roster/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "edit-athlete", path: "@/app/org/[slug]/roster/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture Athlete/ },
  { name: "new-target", path: "@/app/org/[slug]/board/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture Athlete/ },
  { name: "edit-target", path: "@/app/org/[slug]/board/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) }, expect: /Fixture/ },
  { name: "transfer-windows", path: "@/app/org/[slug]/transfer-windows/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture window[\s\S]*Remove/ },
  { name: "new-transfer-window", path: "@/app/org/[slug]/transfer-windows/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Source/ },
  { name: "invite-family", path: "@/app/org/[slug]/roster/[id]/family/new/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Who They Are/ },
  { name: "new-school", path: "@/app/org/[slug]/schools/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-gift", path: "@/app/org/[slug]/fundraising/gifts/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Donor/ },
  { name: "new-pledge", path: "@/app/org/[slug]/fundraising/pledges/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Donor/ },
  { name: "new-donor", path: "@/app/org/[slug]/fundraising/donors/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-campaign", path: "@/app/org/[slug]/fundraising/campaigns/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-grant", path: "@/app/org/[slug]/fundraising/grants/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-board", path: "@/app/org/[slug]/board-governance/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-seat", path: "@/app/org/[slug]/board-governance/[id]/seats/new/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.board }) }, expect: /form|input/i },
  { name: "new-scale", path: "@/app/org/[slug]/grading-scales/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /form|input/i },
  { name: "new-approved-list", path: "@/app/org/[slug]/approved-courses/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ school: "Unscaled High School" }) }, expect: /Unscaled High School/ },
  { name: "new-document", path: "@/app/org/[slug]/documents/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /form|input|upload/i },
];

// The URL a page entry answers to, for the preview's link routing.
export async function routeFor(page: (typeof PAGES)[number]): Promise<string> {
  const params = ((await page.props.params) ?? {}) as Record<string, string>;
  const search = ((await page.props.searchParams) ?? {}) as Record<string, string>;
  let route = page.path.replace(/^@\/app/, "").replace(/\/page$/, "");
  for (const [k, v] of Object.entries(params)) route = route.replace(`[${k}]`, v);
  const qs = new URLSearchParams(search).toString();
  return qs ? `${route}?${qs}` : route;
}
