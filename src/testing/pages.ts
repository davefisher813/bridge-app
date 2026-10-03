// Every page in the app, with the params that render it against the
// fixture rather than 404 it.
//
// One list, two readers. src/laws/pageRender.test.ts renders each entry
// and asserts on the text; scripts/preview/build_app_preview.ts renders
// the same entries into the click-through preview. Written out rather
// than globbed on purpose: a glob would let a new page join the app
// without anybody deciding what its arguments are, which is the same as
// not testing it. The render law checks the list against the filesystem.

import { FAMILY_ID, IDS, LONG_INVITE_ID, MEMBER_ID, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID } from "@/testing/fixture";

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
  // Stage 3, 2026-09-26: the staff member's own athletes, the one never
  // checked in with first.
  { name: "mine", path: "@/app/org/[slug]/mine/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /My Athletes[\s\S]*never checked in[\s\S]*Fixture Athlete/ },
  { name: "members", path: "@/app/org/[slug]/members/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Example Owner[\s\S]*Invited[\s\S]*Example Member/ },
  { name: "invite", path: "@/app/org/[slug]/members/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Send Invite/ },
  // Stage 5 Phase 2, 2026-09-27: the same invite reached from an
  // athlete's Advisor sheet is Add Admin, pinned to that athlete, and
  // the invite comes back to them with the new person assigned.
  { name: "add-admin", path: "@/app/org/[slug]/members/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ role: "owner", assignAthleteId: IDS.athlete }) }, expect: /Add Admin[\s\S]*Fixture Athlete[\s\S]*Send Invite/ },
  { name: "member", path: "@/app/org/[slug]/members/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, userId: MEMBER_ID }), searchParams: p({}) }, expect: /Example Member[\s\S]*Viewer[\s\S]*Title[\s\S]*Admin[\s\S]*Remove From/ },
  // An invited person with no name: the address is the title, and it is
  // wider than the screen. The edge-spill audit watches this one.
  // A family login: the page names the one athlete they see instead of
  // offering a role switch.
  { name: "member-family", path: "@/app/org/[slug]/members/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, userId: FAMILY_ID }), searchParams: p({}) }, expect: /Fixture Parent[\s\S]*Sees[\s\S]*Fixture Athlete[\s\S]*Unlink[\s\S]*Change Role/ },
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
  // Stage 2, 2026-09-26: the school directory, as a member sees it. The
  // shared facts only; no coach, note, athlete or score reaches it.
  { name: "member-schools", path: "@/app/org/[slug]/member/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture College[\s\S]*Fixture State University/, as: MEMBER_ID },
  { name: "member-schools-state", path: "@/app/org/[slug]/member/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ state: "NY" }) }, expect: /Fixture College/, as: MEMBER_ID },
  { name: "member-school", path: "@/app/org/[slug]/member/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) }, expect: /Fixture State University[\s\S]*Money/, as: MEMBER_ID },
  { name: "member-schoolD3", path: "@/app/org/[slug]/member/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.schoolD3 }) }, expect: /No athletic scholarships at D3/, as: MEMBER_ID },
  // The same screens for an org with no modules: no Giving tab, no
  // seat, nothing about money. Elite Squad is every org that is not
  // Bridge, so this is the common case, not the edge one.
  { name: "member-home-lite", path: "@/app/org/[slug]/member/page", props: { params: p({ slug: ORG_WITHOUT_MODULES }) }, expect: /Athletes[\s\S]*The Program/, as: MEMBER_ID },
  { name: "member-more-lite", path: "@/app/org/[slug]/member/more/page", props: { params: p({ slug: ORG_WITHOUT_MODULES }), searchParams: p({}) }, expect: /Who to Ask[\s\S]*Sign Out/, as: MEMBER_ID },
  { name: "family-athlete", path: "@/app/org/[slug]/family/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture Athlete[\s\S]*Your Assignments[\s\S]*Your Advisor[\s\S]*Matches[\s\S]*Documents/, as: FAMILY_ID },
  // Stage 3: the athlete's thread, the one thing a family login writes.
  // There is no family check-ins screen; the log is staff only.
  { name: "family-messages", path: "@/app/org/[slug]/family/[id]/messages/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture message from staff[\s\S]*Send/, as: FAMILY_ID },
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
  // Stage 2, 2026-09-26: the school directory, as a family sees it.
  // A to Z inside "F", then one filter, then the two schools.
  { name: "family-schools", path: "@/app/org/[slug]/family/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture College[\s\S]*Fixture State University/, as: FAMILY_ID },
  { name: "family-schools-major", path: "@/app/org/[slug]/family/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ major: "Biology" }) }, expect: /Fixture State University/, as: FAMILY_ID },
  { name: "family-school", path: "@/app/org/[slug]/family/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) }, expect: /Fixture State University[\s\S]*Money/, as: FAMILY_ID },
  { name: "family-schoolD3", path: "@/app/org/[slug]/family/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.schoolD3 }) }, expect: /No athletic scholarships at D3/, as: FAMILY_ID },
  { name: "member-long-address", path: "@/app/org/[slug]/members/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, userId: LONG_INVITE_ID }), searchParams: p({}) }, expect: /example-organization\.test/ },
  { name: "roster", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Athlete/ },
  // The search path on each list that has one: the term narrows the
  // rows, and a term nothing matches reaches the empty state rather
  // than an empty screen.
  { name: "roster-search", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "transfer" }) }, expect: /Fixture Transfer/ },
  { name: "roster-search-empty", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "zzzz" }) }, expect: /Nobody Matches/ },
  { name: "roster-mine", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ advisor: "me" }) }, expect: /2 of \d+, yours/ },
  // Stage 5 Phase 2, 2026-09-27: the Advisor section is first, with
  // Change when somebody is assigned and Assign when nobody is.
  { name: "athlete", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture Athlete[\s\S]*Advisor[\s\S]*Change[\s\S]*Notes[\s\S]*Fixture note[\s\S]*Add Note[\s\S]*contacts\/ct1\/edit[\s\S]*Remove Athlete/ },
  { name: "athlete-transfer", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /Fixture Transfer[\s\S]*No Advisor Assigned[\s\S]*Assign/ },
  { name: "athlete-committed", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) }, expect: /Fixture Committed[\s\S]*Mark Enrolled/ },
  { name: "athlete-enrolled", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Enrolled[\s\S]*Fixture State University/ },
  { name: "enroll-athlete", path: "@/app/org/[slug]/roster/[id]/enroll/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) }, expect: /Fixture State University[\s\S]*Will Close[\s\S]*Enrolled On/ },
  { name: "athlete-graduated", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteGraduated }) }, expect: /Fixture Tech[\s\S]*Graduated May 15, 2026/ },
  { name: "athlete-drafted", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteDrafted }) }, expect: /Fixture Pros[\s\S]*Round 5, 2026/ },
  { name: "graduate-athlete", path: "@/app/org/[slug]/roster/[id]/graduate/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Fixture State University[\s\S]*Graduated On/ },
  { name: "draft-athlete", path: "@/app/org/[slug]/roster/[id]/draft/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) }, expect: /Will Close[\s\S]*Team[\s\S]*Round/ },
  { name: "draft-details", path: "@/app/org/[slug]/roster/[id]/draft/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteDrafted }) }, expect: /Draft Details[\s\S]*Fixture Pros/ },
  { name: "matches-enrolled", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }), searchParams: p({}) }, expect: /Enrolled/ },
  // Stage 1, 2026-09-26: every school ever in touch, open or closed, is
  // history; the closed one carries its closing note and its pill. The
  // meta (the note) renders before the trailing pill on a Row.
  { name: "history", path: "@/app/org/[slug]/roster/[id]/history/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Closed automatically[\s\S]*Not Interested/ },
  { name: "history-empty", path: "@/app/org/[slug]/roster/[id]/history/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteGraduated }) }, expect: /No Recruiting History Yet/ },
  { name: "reopen-enrolled", path: "@/app/org/[slug]/roster/[id]/reopen/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Will Reopen[\s\S]*Fixture College[\s\S]*Eligibility Years[\s\S]*Note/ },
  { name: "athlete-transferring", path: "@/app/org/[slug]/roster/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransferring }) }, expect: /Fixture Transferring[\s\S]*Matches[\s\S]*Targets/ },
  { name: "roster-status", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ status: "Enrolled" }) }, expect: /Fixture Enrolled/ },
  { name: "target-enrolled", path: "@/app/org/[slug]/board/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.targetEnrolledCommitted }) }, expect: /Fixture State University[\s\S]*Recruiting ended/ },
  { name: "family-athlete-enrolled", path: "@/app/org/[slug]/family/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Enrolled[\s\S]*Fixture State University/, as: FAMILY_ID },
  { name: "family-matches-enrolled", path: "@/app/org/[slug]/family/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) }, expect: /Enrolled/, as: FAMILY_ID },
  { name: "eligibility-transfer", path: "@/app/org/[slug]/roster/[id]/eligibility/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /Fixture Transfer|transfer/i },
  { name: "transcript-transfer", path: "@/app/org/[slug]/roster/[id]/transcript/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /Fixture Transfer|transcript/i },
  { name: "edit-athlete-transfer", path: "@/app/org/[slug]/roster/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /Fixture Transfer[\s\S]*Enrollment Date/ },
  { name: "eligibility", path: "@/app/org/[slug]/roster/[id]/eligibility/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /core/i },
  { name: "caveats", path: "@/app/org/[slug]/roster/[id]/eligibility/caveats/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Things to Know/i },
  { name: "approvals", path: "@/app/org/[slug]/roster/[id]/eligibility/approvals/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /approv/i },
  { name: "transcript", path: "@/app/org/[slug]/roster/[id]/transcript/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /English 11[\s\S]*Course Approvals/ },
  { name: "board", path: "@/app/org/[slug]/board/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture State University/ },
  { name: "targets-search", path: "@/app/org/[slug]/board/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "state" }) }, expect: /Fixture State University/ },
  { name: "target", path: "@/app/org/[slug]/board/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) }, expect: /Fixture State University/ },
  { name: "dimension", path: "@/app/org/[slug]/board/[id]/dimensions/[dim]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target, dim: "academic" }) }, expect: /Academic/ },
  { name: "communications", path: "@/app/org/[slug]/board/[id]/communications/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) }, expect: /Fixture note/ },
  // Stage 3: the athlete's thread and check-in log on the staff side,
  // each with an athlete that has nothing on it yet.
  { name: "messages", path: "@/app/org/[slug]/roster/[id]/messages/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture message from staff[\s\S]*Remove[\s\S]*Fixture reply from the family[\s\S]*Send/ },
  { name: "messages-empty", path: "@/app/org/[slug]/roster/[id]/messages/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /Nothing Sent Yet/ },
  { name: "checkins", path: "@/app/org/[slug]/roster/[id]/checkins/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /^(?=[\s\S]*checkins\/ck1\/edit)[\s\S]*Fixture check-in note[\s\S]*Log Check-In/ },
  { name: "checkins-empty", path: "@/app/org/[slug]/roster/[id]/checkins/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteNoGpa }) }, expect: /No Check-Ins Yet/ },
  { name: "schools", path: "@/app/org/[slug]/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture State University/ },
  { name: "schools-search", path: "@/app/org/[slug]/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "state" }) }, expect: /Fixture State University/ },
  { name: "schools-imported", path: "@/app/org/[slug]/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ imported: "3" }) }, expect: /3 Schools Imported/ },
  { name: "schools-filtered", path: "@/app/org/[slug]/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ division: "D3" }) }, expect: /Fixture College/ },
  { name: "metrics", path: "@/app/org/[slug]/roster/[id]/metrics/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /^(?=[\s\S]*metrics\/mx1\/edit)[\s\S]*FB Velo[\s\S]*86 mph[\s\S]*Premier/ },
  { name: "metrics-empty", path: "@/app/org/[slug]/roster/[id]/metrics/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteNoGpa }) }, expect: /Nothing Logged Yet/ },
  { name: "matches", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({}) }, expect: /Fixture State University[\s\S]*Fixture College/ },
  { name: "matches-filtered", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({ division: "D3" }) }, expect: /Fixture College/ },
  // Amended 2026-09-27: a partial row says "Partial · 1 of 3 scored" in
  // plain view, after the division, the same shape on every screen. The
  // engine's own sentence stays in warnings.
  { name: "matches-partial", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteNoGpa }), searchParams: p({}) }, expect: /D3<\/span> · Partial · 1 of 3 scored/ },
  // Search by name, a sort other than Best Fit, and the Show More address.
  { name: "matches-search", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({ q: "state" }) }, expect: /1 matches the search[\s\S]*Fixture State University/ },
  { name: "matches-sort-academic", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({ sort: "academic" }) }, expect: /Academic 90[\s\S]*Academic 78/ },
  { name: "matches-show-more", path: "@/app/org/[slug]/roster/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({ show: "50" }) }, expect: /Fixture State University[\s\S]*Fixture College/ },
  { name: "family-matches-sorted", path: "@/app/org/[slug]/family/[id]/matches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({ sort: "az" }) }, expect: /Ranked[\s\S]*Fixture College[\s\S]*Fixture State University/, as: FAMILY_ID },
  { name: "edit-school", path: "@/app/org/[slug]/schools/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) }, expect: /Fixture State University[\s\S]*Merge Into[\s\S]*Remove School/ },
  { name: "import-schools", path: "@/app/org/[slug]/schools/import/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Download the Template/ },
  { name: "school", path: "@/app/org/[slug]/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) }, expect: /Fixture Athlete/ },
  { name: "schoolD3", path: "@/app/org/[slug]/schools/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.schoolD3 }) }, expect: /Fixture College/ },
  { name: "grading-scales", path: "@/app/org/[slug]/grading-scales/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture High School/ },
  { name: "approved-courses", path: "@/app/org/[slug]/approved-courses/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Unscaled High School/ },
  { name: "documents", path: "@/app/org/[slug]/documents/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /fixture.pdf/ },
  { name: "documents-search", path: "@/app/org/[slug]/documents/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "fixture" }) }, expect: /fixture.pdf/ },
  { name: "campaigns", path: "@/app/org/[slug]/fundraising/campaigns/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Campaigns[\s\S]*Fixture Campaign[\s\S]*\$5,000 raised of a \$25,000 goal/ },
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
  // Stage 5 Phase 3, 2026-09-27: More for the org with no modules has
  // no Foundation section, and Advisors lists every Admin with a count.
  { name: "more-lite", path: "@/app/org/[slug]/more/page", props: { params: p({ slug: ORG_WITHOUT_MODULES }) }, expect: /^(?![\s\S]*Foundation)[\s\S]*Organization[\s\S]*Sign Out/ },
  { name: "doc-ai-spending", path: "@/app/org/[slug]/doc-ai-spending/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Doc AI Spending[\s\S]*\$0\.01 of \$20\.00 this month, 1 call[\s\S]*This Month[\s\S]*\$0\.01/ },
  { name: "advisors", path: "@/app/org/[slug]/advisors/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Advisors[\s\S]*Example Owner[\s\S]*Head of Recruiting<\/span> · 2 athletes/ },
  // Stage 5 Phase 6, 2026-09-27: the activity log, Admins only. The org
  // screen lists every entry newest first and searches the summary and
  // the actor; an athlete's own log renders its empty state for the one
  // athlete with nothing recorded.
  { name: "activity", path: "@/app/org/[slug]/activity/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Activity[\s\S]*Sent a message[\s\S]*Invited Example Member as a Viewer/ },
  { name: "activity-search", path: "@/app/org/[slug]/activity/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "advisor" }) }, expect: /Set Example Owner as the advisor for Fixture Athlete/ },
  { name: "activity-search-empty", path: "@/app/org/[slug]/activity/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "zzzz" }) }, expect: /Nothing Matches/ },
  { name: "athlete-activity", path: "@/app/org/[slug]/roster/[id]/activity/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: p({}) }, expect: /Every change recorded for Fixture Athlete[\s\S]*Added Fixture Athlete/ },
  { name: "athlete-activity-empty", path: "@/app/org/[slug]/roster/[id]/activity/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }), searchParams: p({}) }, expect: /No Activity Yet/ },
  // Stage 5 Phase 4, 2026-09-27 (Dave approved the whole plan): assignments.
  // The athlete's list groups Open, Submitted and Done; the org list opens
  // with what is waiting on a review; the detail screen of a submitted row
  // carries the Family Upload document and the review controls, and a
  // finished one carries no Cancel.
  { name: "assignments", path: "@/app/org/[slug]/roster/[id]/assignments/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Send Fall Transcript[\s\S]*Upload Test Scores[\s\S]*Confirm Graduation Year/ },
  { name: "assignments-empty", path: "@/app/org/[slug]/roster/[id]/assignments/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }, expect: /No Assignments Yet[\s\S]*New Assignment/ },
  { name: "assignment-new", path: "@/app/org/[slug]/roster/[id]/assignments/new/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /New Assignment[\s\S]*Create Assignment/ },
  { name: "assignment", path: "@/app/org/[slug]/roster/[id]/assignments/[assignmentId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, assignmentId: IDS.assignmentSubmitted }) }, expect: /Upload Test Scores[\s\S]*Family Upload[\s\S]*Complete[\s\S]*Needs Revision[\s\S]*Cancel Assignment/ },
  { name: "assignment-revision", path: "@/app/org/[slug]/roster/[id]/assignments/[assignmentId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, assignmentId: IDS.assignmentRevision }) }, expect: /Complete Family Budget Form[\s\S]*Reviewer Comment[\s\S]*second parent[\s\S]*Cancel Assignment/ },
  { name: "assignment-complete", path: "@/app/org/[slug]/roster/[id]/assignments/[assignmentId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, assignmentId: IDS.assignmentComplete }) }, expect: /Confirm Graduation Year[\s\S]*Complete/ },
  { name: "org-assignments", path: "@/app/org/[slug]/assignments/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Submitted for Review[\s\S]*Overdue[\s\S]*Due Soon/ },
  { name: "org-assignments-search", path: "@/app/org/[slug]/assignments/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ q: "zzzz" }) }, expect: /Nothing Matches/ },
  // The Athlete login's side: the submit screen for an open and overdue
  // row, a row sent back (with what to change), and a row already sent.
  { name: "family-assignment", path: "@/app/org/[slug]/family/[id]/assignments/[assignmentId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, assignmentId: IDS.assignmentOverdue }) }, expect: /Send Fall Transcript[\s\S]*Overdue[\s\S]*Submit/, as: FAMILY_ID },
  { name: "family-assignment-revision", path: "@/app/org/[slug]/family/[id]/assignments/[assignmentId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, assignmentId: IDS.assignmentRevision }) }, expect: /What to Change[\s\S]*second parent[\s\S]*Fix and Resubmit/, as: FAMILY_ID },
  { name: "family-assignment-submitted", path: "@/app/org/[slug]/family/[id]/assignments/[assignmentId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, assignmentId: IDS.assignmentSubmitted }) }, expect: /Sent for Review/, as: FAMILY_ID },
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
  { name: "new-athlete", path: "@/app/org/[slug]/roster/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /High School[\s\S]*Notes/ },
  { name: "edit-athlete", path: "@/app/org/[slug]/roster/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Fixture Athlete[\s\S]*Fixture High School[\s\S]*Add a Note/ },
  { name: "new-target", path: "@/app/org/[slug]/board/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture Athlete/ },
  { name: "edit-target", path: "@/app/org/[slug]/board/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) }, expect: /Fixture[\s\S]*Award[\s\S]*Remove Target/ },
  { name: "transfer-windows", path: "@/app/org/[slug]/transfer-windows/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Fixture window[\s\S]*Fixture window note[\s\S]*Remove/ },
  { name: "new-transfer-window", path: "@/app/org/[slug]/transfer-windows/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Source/ },
  { name: "invite-family", path: "@/app/org/[slug]/roster/[id]/family/new/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Who They Are[\s\S]*value="Fixture Parent"/ },
  { name: "new-school", path: "@/app/org/[slug]/schools/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-gift", path: "@/app/org/[slug]/fundraising/gifts/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Donor/ },
  { name: "new-pledge", path: "@/app/org/[slug]/fundraising/pledges/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /Fixture Donor/ },
  { name: "new-donor", path: "@/app/org/[slug]/fundraising/donors/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-campaign", path: "@/app/org/[slug]/fundraising/campaigns/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-grant", path: "@/app/org/[slug]/fundraising/grants/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-board", path: "@/app/org/[slug]/board-governance/new/page", props: { params: p({ slug: ORG_WITH_MODULES }) }, expect: /form|input/i },
  { name: "new-seat", path: "@/app/org/[slug]/board-governance/[id]/seats/new/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.board }) }, expect: /form|input/i },
  { name: "new-scale", path: "@/app/org/[slug]/grading-scales/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /form|input/i },
  { name: "new-approved-list", path: "@/app/org/[slug]/approved-courses/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ school: "Unscaled High School" }) }, expect: /Unscaled High School[\s\S]*123456/ },
  { name: "new-document", path: "@/app/org/[slug]/documents/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /form|input|upload/i },
  // Stage 4 and the audit fixes, 2026-09-27: every record can be
  // corrected and removed where it was made, and a school, a coach and
  // an org can be set up without a developer. One entry per new screen.
  { name: "roster-removed", path: "@/app/org/[slug]/roster/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ notice: "Fixture Gone was removed from the roster." }) }, expect: /Done[\s\S]*Fixture Gone was removed from the roster\./ },
  { name: "schools-removed", path: "@/app/org/[slug]/schools/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ notice: "Fixture Gone removed." }) }, expect: /Done[\s\S]*Fixture Gone removed\./ },
  { name: "edit-athlete-graduated", path: "@/app/org/[slug]/roster/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteGraduated }) }, expect: /Enrollment Date[\s\S]*Graduated On[\s\S]*2026-05-15/ },
  { name: "edit-contact", path: "@/app/org/[slug]/roster/[id]/contacts/[contactId]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, contactId: "ct1" }) }, expect: /Edit Contact[\s\S]*Fixture Parent[\s\S]*Save Changes/ },
  { name: "edit-metric", path: "@/app/org/[slug]/roster/[id]/metrics/[metricId]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, metricId: "mx1" }) }, expect: /Edit FB Velo[\s\S]*2026-08-15[\s\S]*Save Changes/ },
  { name: "edit-checkin", path: "@/app/org/[slug]/roster/[id]/checkins/[checkinId]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, checkinId: "ck1" }) }, expect: /Edit Check-In[\s\S]*Fixture check-in note[\s\S]*Save Changes/ },
  { name: "family-link", path: "@/app/org/[slug]/roster/[id]/family/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, userId: FAMILY_ID }), searchParams: p({}) }, expect: /Fixture Parent[\s\S]*Who They Are[\s\S]*Also Sees[\s\S]*Fixture Unknown[\s\S]*Link Another Athlete[\s\S]*Unlink from Fixture Athlete/ },
  { name: "new-course", path: "@/app/org/[slug]/roster/[id]/transcript/new/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }, expect: /Add a Course[\s\S]*Fixture High School/ },
  { name: "course", path: "@/app/org/[slug]/roster/[id]/transcript/[courseId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete, courseId: "ac1" }) }, expect: /Edit Course[\s\S]*English 11[\s\S]*Remove Course/ },
  { name: "communication", path: "@/app/org/[slug]/board/[id]/communications/[entryId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target, entryId: "tc1" }) }, expect: /Edit Communication[\s\S]*Fixture note\.[\s\S]*Remove Entry/ },
  { name: "visit", path: "@/app/org/[slug]/board/[id]/visits/[visitId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.target, visitId: "tv1" }) }, expect: /Edit Visit[\s\S]*Fixture impression\.[\s\S]*Remove Visit/ },
  { name: "school-coaches", path: "@/app/org/[slug]/schools/[id]/coaches/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) }, expect: /Coaches[\s\S]*Fixture Head[\s\S]*Fixture Assistant/ },
  { name: "new-coach", path: "@/app/org/[slug]/schools/[id]/coaches/new/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) }, expect: /Add a Coach[\s\S]*Add Coach/ },
  { name: "coach", path: "@/app/org/[slug]/schools/[id]/coaches/[coachId]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.school, coachId: "cc1" }) }, expect: /Fixture Assistant[\s\S]*Remove Coach/ },
  { name: "edit-approved-list", path: "@/app/org/[slug]/approved-courses/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.orgList }) }, expect: /Edit Unscaled High School[\s\S]*Algebra II/ },
  { name: "new-approved-list-pick", path: "@/app/org/[slug]/approved-courses/new/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Which School/ },
  { name: "edit-transfer-window", path: "@/app/org/[slug]/transfer-windows/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: "tw1" }) }, expect: /Edit Transfer Window[\s\S]*Fixture window note/ },
  { name: "document-stub", path: "@/app/org/[slug]/documents/[id]/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.documentStub }) }, expect: /stub-read\.pdf[\s\S]*This Reading Can(&#x27;|')t Be Applied/ },
  { name: "document-correct", path: "@/app/org/[slug]/documents/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.document }) }, expect: /Correct the Reading/ },
  { name: "new-org", path: "@/app/orgs/new/page", props: { params: p({}), searchParams: p({}) }, expect: /Create an Organization[\s\S]*Web Address/ },
  { name: "org-settings", path: "@/app/org/[slug]/settings/page", props: { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }, expect: /Organization Settings[\s\S]*Modules[\s\S]*Fundraising/ },
  { name: "member-owner", path: "@/app/org/[slug]/members/[userId]/page", props: { params: p({ slug: ORG_WITH_MODULES, userId: OWNER_ID }), searchParams: p({}) }, expect: /Athletes They Advise[\s\S]*Fixture Athlete/ },
  { name: "edit-board", path: "@/app/org/[slug]/board-governance/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.board }) }, expect: /Edit Board[\s\S]*Fixture Executive Board/ },
  { name: "edit-seat", path: "@/app/org/[slug]/board-governance/[id]/seats/[memberId]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.board, memberId: IDS.boardMember }) }, expect: /Edit Seat[\s\S]*Fixture Chair[\s\S]*Remove Seat/ },
  { name: "edit-donor", path: "@/app/org/[slug]/fundraising/donors/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.donor }), searchParams: p({}) }, expect: /Edit Donor[\s\S]*Fixture Donor[\s\S]*Remove Donor/ },
  { name: "edit-campaign", path: "@/app/org/[slug]/fundraising/campaigns/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: IDS.campaign }), searchParams: p({}) }, expect: /Edit Campaign[\s\S]*Remove Campaign/ },
  { name: "edit-gift", path: "@/app/org/[slug]/fundraising/gifts/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: "gf1" }), searchParams: p({}) }, expect: /Edit Gift[\s\S]*Remove Gift/ },
  { name: "edit-pledge", path: "@/app/org/[slug]/fundraising/pledges/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: "pl1" }), searchParams: p({}) }, expect: /Edit Pledge[\s\S]*Fixture Donor[\s\S]*Remove Pledge/ },
  { name: "edit-grant", path: "@/app/org/[slug]/fundraising/grants/[id]/edit/page", props: { params: p({ slug: ORG_WITH_MODULES, id: "gr1" }), searchParams: p({}) }, expect: /Edit Grant[\s\S]*Fixture Trust[\s\S]*Remove Grant/ },
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
