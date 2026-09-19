// The dataset every page render runs against.
//
// Invented, always. No real athlete, donor, school or board member goes
// in a fixture any more than in a prototype: this file is committed and
// a real name in it is a real name in the repo forever.
//
// Shaped to the migrations, snake_case, one org with every module on and
// one with them off, because the module gate is the difference between a
// page and a 404 and both branches need rendering.
//
// Deliberately awkward in places. A fixture where every row is complete
// proves only that the happy path renders, and the happy path is not
// where a page throws. So: a target with no coach, an athlete with no
// GPA, a gift with no donor, a board seat with no donor record, a course
// at a school with no grading scale, and a document that failed.

import type { Dataset } from "@/testing/fakeSupabase";

const BRIDGE = "00000000-0000-0000-0000-0000000000a1";
const ELITE = "00000000-0000-0000-0000-0000000000a2";
const OWNER = "00000000-0000-0000-0000-0000000000b1";
const MEMBER = "00000000-0000-0000-0000-0000000000b2";
const OUTSIDER = "00000000-0000-0000-0000-0000000000b3";

export const ORG_WITH_MODULES = "bridge-fixture";
export const ORG_WITHOUT_MODULES = "elite-fixture";
export const OWNER_ID = OWNER;
export const MEMBER_ID = MEMBER;
export const OUTSIDER_ID = OUTSIDER;

export const IDS = {
  athlete: "00000000-0000-0000-0000-0000000000c1",
  athleteNoGpa: "00000000-0000-0000-0000-0000000000c2",
  school: "00000000-0000-0000-0000-0000000000d1",
  schoolD3: "00000000-0000-0000-0000-0000000000d2",
  target: "00000000-0000-0000-0000-0000000000e1",
  targetNoCoach: "00000000-0000-0000-0000-0000000000e2",
  donor: "00000000-0000-0000-0000-0000000000f1",
  donorNoSeat: "00000000-0000-0000-0000-0000000000f3",
  campaign: "00000000-0000-0000-0000-0000000000f2",
  board: "00000000-0000-0000-0000-000000000101",
  boardMember: "00000000-0000-0000-0000-000000000102",
  document: "00000000-0000-0000-0000-000000000111",
  orgScale: "00000000-0000-0000-0000-000000000121",
  orgList: "00000000-0000-0000-0000-000000000131",
} as const;

export function buildFixture(): Dataset {
  return {
    // What the documents bucket holds. Path shape is <org>/<request>/<file>,
    // the same one DocumentUploader writes. The bytes are the smallest
    // thing that sniffs as a PDF; the stub model never reads them.
    storage_objects: [
      {
        bucket: "documents",
        name: `${BRIDGE}/req_fixture/1-transcript.pdf`,
        base64: Buffer.from("%PDF-1.4\n%fixture\n1 0 obj << >> endobj\n%%EOF\n").toString("base64"),
      },
    ],
    users: [
      { id: OWNER, email: "owner@example.test", full_name: "Example Owner" },
      { id: MEMBER, email: "member@example.test", full_name: "Example Member" },
      // Belongs to the other org only: the person an owner adds to
      // Bridge without an invitation email, because the account exists.
      { id: OUTSIDER, email: "outsider@example.test", full_name: "Example Outsider" },
    ],
    orgs: [
      {
        id: BRIDGE,
        name: "Fixture Foundation",
        slug: ORG_WITH_MODULES,
        modules: { board_governance: true, donor_fundraising: true },
        role_labels: { owner: "Executive Director", staff: "Coordinator", member: "Board" },
      },
      {
        id: ELITE,
        name: "Fixture Squad",
        slug: ORG_WITHOUT_MODULES,
        modules: { board_governance: false, donor_fundraising: false },
        role_labels: null,
      },
    ],
    org_members: [
      { id: "m1", user_id: OWNER, org_id: BRIDGE, role: "owner" },
      { id: "m2", user_id: MEMBER, org_id: BRIDGE, role: "member" },
      { id: "m3", user_id: OWNER, org_id: ELITE, role: "owner" },
      { id: "m4", user_id: OUTSIDER, org_id: ELITE, role: "staff" },
    ],
    athletes: [
      {
        id: IDS.athlete,
        org_id: BRIDGE,
        recruit_type: "hs",
        name: "Fixture Athlete",
        sport: "baseball",
        position: "RHP",
        status: "Active",
        gpa: 3.4,
        gpa_verified: true,
        grad_year: 2027,
        date_of_birth: "2009-04-02",
        first_full_time_enrollment: null,
        intended_enrollment: "2027-08-20",
        detail: { kind: "hs", apCount: 2 },
        measurables: { fbVelo: 86 },
        is_international: false,
        toefl_score: null,
        ielts_score: null,
        f1_visa_status: null,
        ncaa_eligibility_status: "In Progress",
        deleted_at: null,
      },
      {
        // No GPA, no measurables, no detail. Every dimension has to cope
        // with absence, and absence is where a page reads off null.
        id: IDS.athleteNoGpa,
        org_id: BRIDGE,
        recruit_type: "hs",
        name: "Fixture Unknown",
        sport: "baseball",
        position: null,
        status: "Active",
        gpa: null,
        gpa_verified: false,
        grad_year: null,
        date_of_birth: null,
        first_full_time_enrollment: null,
        intended_enrollment: null,
        detail: null,
        measurables: null,
        is_international: false,
        toefl_score: null,
        ielts_score: null,
        f1_visa_status: null,
        ncaa_eligibility_status: null,
        deleted_at: null,
      },
    ],
    schools: [
      {
        id: IDS.school,
        name: "Fixture State University",
        division: "D2",
        conference: "Fixture Conference",
        sports_sponsored: ["baseball"],
        academics: { gpaMin: 2.5, gpaAvg: 3.2, satRange: "1050-1250" },
        financials: { athleticScholarship: "partial", avgAthleticAid: 9000, outstateTotal: 38000, rosterSpotsOpen: 2 },
        athletics: { playingTimeOutlook: "competitive", positionDepth: "Three arms ahead on the depth chart." },
        conflicts: [],
        profile_date: "2024-01-01",
      },
      {
        // D3 with a scholarship on the record, which is the case the D3
        // law exists for: the field is populated and must never render.
        id: IDS.schoolD3,
        name: "Fixture College",
        division: "D3",
        conference: "Fixture League",
        sports_sponsored: ["baseball"],
        academics: { gpaMin: 3.0, gpaAvg: 3.6 },
        financials: { athleticScholarship: "full", avgMeritAid: 14000, outstateTotal: 55000 },
        athletics: null,
        conflicts: [{ type: "roster", severity: "warning", message: "Fixture flag on this school." }],
        profile_date: null,
      },
    ],
    recruiting_targets: [
      {
        id: IDS.target,
        org_id: BRIDGE,
        athlete_id: IDS.athlete,
        school_id: IDS.school,
        status: "Offer",
        coach_name: "Fixture Coach",
        offer_type: "scholarship",
        offer_scholarship_percent: 35,
        updated_at: "2026-09-01",
      },
      {
        // No coach, no offer, and a D3 school. Two null branches and the
        // D3 rule in one row.
        id: IDS.targetNoCoach,
        org_id: BRIDGE,
        athlete_id: IDS.athleteNoGpa,
        school_id: IDS.schoolD3,
        status: "Target",
        coach_name: null,
        offer_type: null,
        offer_scholarship_percent: null,
        updated_at: "2026-05-01",
      },
    ],
    target_communications: [
      { id: "tc1", org_id: BRIDGE, target_id: IDS.target, kind: "email", notes: "Fixture note.", occurred_on: "2026-08-20" },
      { id: "tc2", org_id: BRIDGE, target_id: IDS.target, kind: "call", notes: null, occurred_on: null },
    ],
    target_visits: [
      { id: "tv1", org_id: BRIDGE, target_id: IDS.target, visit_type: "unofficial", impression: "Fixture impression.", visit_date: "2026-07-04", next_step: null, notes: null },
    ],
    contacts: [{ id: "ct1", org_id: BRIDGE, athlete_id: IDS.athlete, name: "Fixture Parent", role: "parent_guardian", email: null, phone: null, school_id: null, notes: null }],
    transfer_windows: [
      { id: "tw1", sport: "baseball", division: "D2", season_year: "2026", window_label: "Fixture window", opens_on: "2026-12-01", closes_on: "2026-12-15" },
    ],
    athlete_courses: [
      { id: "ac1", org_id: BRIDGE, athlete_id: IDS.athlete, title: "English 11", subject: "english", credit: 1, grade: "B", term: "25-26 S1", school_name: "Fixture High School", weighted: false, ncaa_approved: null, duplicate_of: null, approval_source: null },
      { id: "ac2", org_id: BRIDGE, athlete_id: IDS.athlete, title: "Algebra II", subject: "math", credit: 1, grade: "A", term: "25-26 S1", school_name: "Unscaled High School", weighted: false, ncaa_approved: null, duplicate_of: null, approval_source: null },
    ],
    high_school_grading_scales: [
      { id: "gs1", school_name: "Fixture High School", bands: [{ letter: "A", min: 90, max: 100 }, { letter: "B", min: 80, max: 89 }], reports_weighted_grades: false, weighting_is_class_rank_only: false, weight_bonus: 0, source_note: "fixture", verified_at: "2026-01-01" },
    ],
    org_grading_scales: [
      { id: IDS.orgScale, org_id: BRIDGE, school_name: "Fixture High School", bands: [{ letter: "A", min: 93, max: 100 }], reports_weighted_grades: false, weighting_is_class_rank_only: false, weight_bonus: 0, source_note: "typed by a coordinator", entered_by: OWNER, updated_at: "2026-02-01" },
    ],
    ncaa_approved_course_lists: [
      { id: "nl1", school_name: "Fixture High School", ceeb_code: "000000", is_complete: true, retrieved_on: "2026-01-01", source_note: "fixture portal" },
    ],
    ncaa_approved_courses: [
      { id: "nc1", list_id: "nl1", title: "English 11", subject: "english", max_credit: 1, weighted: false },
    ],
    org_approved_course_lists: [
      { id: IDS.orgList, org_id: BRIDGE, school_name: "Unscaled High School", ceeb_code: null, is_complete: false, retrieved_on: null, source_note: "partial, typed here", entered_by: OWNER, updated_at: "2026-03-01" },
    ],
    org_approved_courses: [
      { id: "oc1", list_id: IDS.orgList, org_id: BRIDGE, title: "Algebra II", subject: "math", max_credit: 1, weighted: false },
    ],
    donors: [
      { id: IDS.donor, org_id: BRIDGE, name: "Fixture Donor", donor_type: "individual", email: null, deleted_at: null },
      // A donor who sits on no board. The donor page looks for a seat and
      // gets nothing back, which is the branch that reads a field off an
      // undefined row if the optional is dropped.
      { id: IDS.donorNoSeat, org_id: BRIDGE, name: "Fixture Lapsed Donor", donor_type: "corporate", email: null, deleted_at: null },
    ],
    campaigns: [{ id: IDS.campaign, org_id: BRIDGE, name: "Fixture Campaign", kind: "appeal", goal_amount: 25000, ends_on: "2026-12-31" }],
    gifts: [
      { id: "gf1", org_id: BRIDGE, donor_id: IDS.donor, campaign_id: IDS.campaign, pledge_id: null, amount: 5000, received_on: "2026-03-01", category: "board", method: "check", solicited_by: IDS.boardMember },
      // Anonymous and in-kind: two rows that break a page reading
      // donor_id or summing everything as cash.
      { id: "gf2", org_id: BRIDGE, donor_id: null, campaign_id: null, pledge_id: null, amount: 750, received_on: "2026-04-01", category: "individual", method: "cash", solicited_by: null },
      { id: "gf3", org_id: BRIDGE, donor_id: IDS.donor, campaign_id: null, pledge_id: null, amount: 1200, received_on: "2026-05-01", category: "corporate", method: "in_kind", solicited_by: null },
    ],
    pledges: [
      { id: "pl1", org_id: BRIDGE, donor_id: IDS.donor, campaign_id: null, amount: 10000, promised_on: "2026-01-15", due_on: "2026-06-30", status: "open", solicited_by: null },
    ],
    fundraising_budget: [{ id: "fb1", org_id: BRIDGE, fiscal_year: 2026, category: "board", amount: 40000 }],
    grants: [
      { id: "gr1", org_id: BRIDGE, funder_name: "Fixture Trust", status: "pending", amount_requested: 15000, amount_awarded: null, submitted_on: "2026-02-01", decision_on: null, notes: null },
    ],
    boards: [
      { id: IDS.board, org_id: BRIDGE, name: "Fixture Executive Board", kind: "executive", sport: null, give_get_amount: 10000, min_seats: 1, max_seats: 15, description: null, sort_order: 0 },
    ],
    board_members: [
      { id: IDS.boardMember, org_id: BRIDGE, board_id: IDS.board, name: "Fixture Chair", donor_id: IDS.donor, user_id: null, role_title: "Chair", status: "active", term_start: "2026-01-01", term_end: "2028-12-31", commitment_amount: 10000, email: null, phone: null, notes: null },
      // A seat with no donor record, which is the branch that cannot find
      // its own giving and has to say so rather than report zero.
      { id: "bm2", org_id: BRIDGE, board_id: IDS.board, name: "Fixture Prospect", donor_id: null, user_id: null, role_title: null, status: "prospect", term_start: null, term_end: null, commitment_amount: 0, email: null, phone: null, notes: null },
    ],
    documents: [
      // status and route are separate enums in 0007: the route is what
      // the pipeline decided, the status is where the document got to.
      // Writing "review" (a route) into status is a mistake this fixture
      // made on its first pass and the render caught, because the queue
      // filters on status and showed nothing.
      {
        id: IDS.document,
        org_id: BRIDGE,
        athlete_id: IDS.athlete,
        file_name: "fixture.pdf",
        file_size: 1000,
        media_type: "application/pdf",
        source_role: "coordinator",
        status: "pending",
        route: "review",
        category: "transcript",
        provenance: "model",
        extracted: { gpa: 3.4 },
        confidence: { score: 0.62, reasons: ["fixture"] },
        candidates: [],
        failure_reason: null,
        issues: null,
        applied_at: null,
        undone_at: null,
        created_at: "2026-06-01",
      },
      // A failed document, because the queue has a third section for
      // them and an unrendered branch is an untested one.
      {
        id: "doc-failed",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "unreadable.jpg",
        file_size: 2000,
        media_type: "image/jpeg",
        source_role: "parent",
        status: "failed",
        route: "reject",
        category: null,
        provenance: null,
        extracted: null,
        confidence: null,
        candidates: null,
        failure_reason: "Nothing legible on the page.",
        issues: null,
        applied_at: null,
        undone_at: null,
        created_at: "2026-06-02",
      },
    ],
    benchmark_sets: [],
  };
}
