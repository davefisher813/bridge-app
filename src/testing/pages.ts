// Every page in the app, with the params that render it against the
// fixture rather than 404 it.
//
// One list, two readers. src/laws/pageRender.test.ts renders each entry
// and asserts on the text; scripts/preview/build_app_preview.ts renders
// the same entries into the click-through preview. Written out rather
// than globbed on purpose: a glob would let a new page join the app
// without anybody deciding what its arguments are, which is the same as
// not testing it. The render law checks the list against the filesystem.

import { IDS, LONG_INVITE_ID, MEMBER_ID, ORG_WITH_MODULES } from "@/testing/fixture";

export const p = (o: Record<string, string>) => Promise.resolve(o);

// Every page, with params that should render it rather than 404 it. The
// list is written out rather than globbed on purpose: a glob would let a
// new page join the app without anybody deciding what its arguments are,
// which is the same as not testing it.
export const PAGES: Array<{ name: string; path: string; props: Record<string, unknown>; expect: RegExp }> = [
  { name: "today", path: "@/app/org/[slug]/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture/ },
  { name: "members", path: "@/app/org/[slug]/members/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Example Owner[\s\S]*Invited[\s\S]*Example Member/ },
  { name: "invite", path: "@/app/org/[slug]/members/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Send Invite/ },
  { name: "member", path: "@/app/org/[slug]/members/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, userId: MEMBER_ID }), searchParams: p({}) }, expect: /Example Member[\s\S]*Coordinator[\s\S]*Remove From/ },
  // An invited person with no name: the address is the title, and it is
  // wider than the screen. The edge-spill audit watches this one.
  { name: "member-long-address", path: "@/app/org/[slug]/members/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, userId: LONG_INVITE_ID }), searchParams: p({}) }, expect: /example-organization\.test/ },
  { name: "roster", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Athlete/ },
  { name: "athlete", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture Athlete/ },
  { name: "eligibility", path: "@/app/org/[slug]/roster/[id]/eligibility/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /core/i },
  { name: "caveats", path: "@/app/org/[slug]/roster/[id]/eligibility/caveats/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Things to Know/i },
  { name: "approvals", path: "@/app/org/[slug]/roster/[id]/eligibility/approvals/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /approv/i },
  { name: "transcript", path: "@/app/org/[slug]/roster/[id]/transcript/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /English 11/ },
  { name: "board", path: "@/app/org/[slug]/board/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture State University/ },
  { name: "target", path: "@/app/org/[slug]/board/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) }, expect: /Fixture State University/ },
  { name: "dimension", path: "@/app/org/[slug]/board/[id]/dimensions/[dim]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target, dim: "academic" }) }, expect: /Academic/ },
  { name: "communications", path: "@/app/org/[slug]/board/[id]/communications/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) }, expect: /Fixture note/ },
  { name: "schools", path: "@/app/org/[slug]/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture State University/ },
  { name: "school", path: "@/app/org/[slug]/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) }, expect: /Fixture Athlete/ },
  { name: "schoolD3", path: "@/app/org/[slug]/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.schoolD3 }) }, expect: /Fixture College/ },
  { name: "grading-scales", path: "@/app/org/[slug]/grading-scales/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture High School/ },
  { name: "approved-courses", path: "@/app/org/[slug]/approved-courses/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Unscaled High School/ },
  { name: "documents", path: "@/app/org/[slug]/documents/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /fixture.pdf/ },
  { name: "fundraising", path: "@/app/org/[slug]/fundraising/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fundraising/ },
  { name: "gifts", path: "@/app/org/[slug]/fundraising/gifts/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture Donor/ },
  { name: "pledges", path: "@/app/org/[slug]/fundraising/pledges/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Donor/ },
  { name: "donors", path: "@/app/org/[slug]/fundraising/donors/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Donor/ },
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
