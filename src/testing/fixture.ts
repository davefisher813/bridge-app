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
const LONG_INVITE = "00000000-0000-0000-0000-0000000000b4";
// A parent of the fixture athlete: a family login, linked to one
// athlete and nobody else.
const FAMILY = "00000000-0000-0000-0000-0000000000b5";

export const ORG_WITH_MODULES = "bridge-fixture";
export const ORG_WITHOUT_MODULES = "elite-fixture";
export const OWNER_ID = OWNER;
export const MEMBER_ID = MEMBER;
export const OUTSIDER_ID = OUTSIDER;
export const LONG_INVITE_ID = LONG_INVITE;
export const FAMILY_ID = FAMILY;

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
  athleteTransfer: "00000000-0000-0000-0000-0000000000c3",
  athleteElite: "00000000-0000-0000-0000-0000000000c4",
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
      { id: OWNER, email: "owner@example.test", full_name: "Example Owner", last_sign_in_at: "2026-09-01T12:00:00.000Z" },
      // Never signed in: the members screen lists them as invited.
      { id: MEMBER, email: "member@example.test", full_name: "Example Member", last_sign_in_at: null },
      // Belongs to the other org only: the person an owner adds to
      // Bridge without an invitation email, because the account exists.
      { id: OUTSIDER, email: "outsider@example.test", full_name: "Example Outsider", last_sign_in_at: "2026-09-02T12:00:00.000Z" },
      // Invited, never signed in, no name yet: the address is the title
      // of their row and their page, and it is longer than a phone is
      // wide. That is what the edge-spill audit exists to catch.
      { id: LONG_INVITE, email: "an.unusually.long.invited.address@example-organization.test", full_name: null, last_sign_in_at: null },
      { id: FAMILY, email: "parent@example.test", full_name: "Fixture Parent", last_sign_in_at: "2026-09-03T12:00:00.000Z" },
    ],
    orgs: [
      {
        id: BRIDGE,
        // Long on purpose: the real Bridge org is 38 characters, and the
        // name sits at the top of every org screen.
        name: "Fixture Foundation for Student Athletes",
        slug: ORG_WITH_MODULES,
        modules: { board_governance: true, donor_fundraising: true },
        role_labels: { owner: "Executive Director", staff: "Coordinator", member: "Board" },
        branding: { logo: "/logos/bridge-mark.png", lockup: "/logos/bridge-lockup.png" },
        scoring_preset: "money_first",
        docai_budget_cents: 2000,
      },
      {
        id: ELITE,
        name: "Fixture Squad",
        slug: ORG_WITHOUT_MODULES,
        modules: { board_governance: false, donor_fundraising: false },
        role_labels: null,
        branding: {},
        scoring_preset: "balanced",
        docai_budget_cents: 0,
      },
    ],
    org_members: [
      { id: "m1", user_id: OWNER, org_id: BRIDGE, role: "owner" },
      { id: "m2", user_id: MEMBER, org_id: BRIDGE, role: "member" },
      { id: "m3", user_id: OWNER, org_id: ELITE, role: "owner" },
      { id: "m4", user_id: OUTSIDER, org_id: ELITE, role: "staff" },
      { id: "m5", user_id: LONG_INVITE, org_id: BRIDGE, role: "member" },
      { id: "m6", user_id: FAMILY, org_id: BRIDGE, role: "family" },
      // The same member login in the org with no modules, so the lite
      // member screens (no Giving, no seat) have somewhere to render.
      { id: "m7", user_id: MEMBER, org_id: ELITE, role: "member" },
    ],
    // Two athletes, so the family home is the picker and Colleges groups
    // by athlete: a parent with two kids is a real case (Dave, 2026-09-21).
    // One model call logged this month, so the More screen has a number.
    docai_usage: [
      { id: "du1", org_id: BRIDGE, document_id: IDS.document, request_id: "req_fixture_extract", model: "claude-opus-5", input_tokens: 1200, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0, cost_cents: 1.35, created_at: new Date().toISOString() },
    ],
    athlete_guardians: [
      { org_id: BRIDGE, athlete_id: IDS.athlete, user_id: FAMILY, relationship: "parent", created_at: "2026-09-03T12:00:00.000Z" },
      { org_id: BRIDGE, athlete_id: IDS.athleteNoGpa, user_id: FAMILY, relationship: "parent", created_at: "2026-09-03T12:00:00.000Z" },
    ],
    athletes: [
      // The one athlete in the org with no modules. Elite Squad is every
      // org that is not Bridge, so its screens need rows of their own:
      // without one, a cross-org leak would read as an empty screen.
      {
        id: IDS.athleteElite,
        org_id: ELITE,
        recruit_type: "hs",
        name: "Squad Athlete",
        sport: "baseball",
        position: "SS",
        status: "Active",
        gpa: 3.1,
        gpa_verified: false,
        grad_year: 2028,
        date_of_birth: "2010-06-11",
        first_full_time_enrollment: null,
        intended_enrollment: null,
        detail: { kind: "hs" },
        measurables: {},
        is_international: false,
        toefl_score: null,
        ielts_score: null,
        f1_visa_status: null,
        ncaa_eligibility_status: "Not Started",
        deleted_at: null,
        goal: "balanced",
        family_budget_cents: null,
        home_state: "NY",
        grades: {},
      },
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
        goal: "balanced",
        family_budget_cents: 1500000,
        home_state: "CT",
        grades: { frame: 55, athleticism: 60, skill: 50, iq: 55, competitiveness: 65 },
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
        // No budget, no home state, no grades: the financial dimension
        // falls back to the school-only model and the athletic score is
        // metrics alone.
        goal: "balanced",
        family_budget_cents: null,
        home_state: null,
        grades: {},
      },
      {
        // A transfer, shaped like the first real athlete Dave entered:
        // 4-to-4, a D3 school with a long name, a trailing space in the
        // major, no HS fields at all.
        id: IDS.athleteTransfer,
        org_id: BRIDGE,
        recruit_type: "transfer_4to4",
        name: "Fixture Transfer",
        sport: "baseball",
        position: "MIF",
        status: "Active",
        gpa: null,
        gpa_verified: false,
        grad_year: null,
        date_of_birth: null,
        first_full_time_enrollment: "2024-08-26",
        intended_enrollment: null,
        detail: { kind: "transfer", collegeGpa: 4, desiredMajor: "Business ", currentSchool: "City College of New York", transferCount: 1, currentDivision: "D3", eligibilityYearsRemaining: 3 },
        measurables: null,
        is_international: false,
        toefl_score: null,
        ielts_score: null,
        f1_visa_status: null,
        ncaa_eligibility_status: null,
        deleted_at: null,
        goal: "education",
        family_budget_cents: 2000000,
        home_state: "NY",
        grades: {},
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
        program_tier: "d2_naia",
        state: "CT",
        majors: ["Business", "Biology"],
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
        program_tier: "d2_naia",
        state: "NY",
        majors: ["Business"],
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
      { id: "tw1", sport: "baseball", division: "D2", season_year: "2026", window_label: "Fixture window", opens_on: "2026-12-01", closes_on: "2026-12-15", source_url: "https://example.test/fixture-window" },
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
      // The chair's seat is the fixture member's sign-in, so the member
      // screens (Bridge: Board) have a seat to show.
      { id: IDS.boardMember, org_id: BRIDGE, board_id: IDS.board, name: "Fixture Chair", donor_id: IDS.donor, user_id: MEMBER, role_title: "Chair", status: "active", term_start: "2026-01-01", term_end: "2028-12-31", commitment_amount: 10000, email: null, phone: null, notes: null },
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
        // Two warnings, so the document screen's What It Flagged section
        // is rendered and audited rather than an untested branch.
        extracted: { gpa: 3.4, warnings: ["The GPA cell was smudged; 3.4 could be 3.1.", "No graduation year was read off this transcript."] },
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
      // A reading that never came back: the row was written, the
      // function was killed. Old enough to count as stuck, so the
      // screen's clear-it branch is rendered and audited.
      {
        id: "doc-stuck",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "cut-off.pdf",
        file_size: 3000,
        media_type: "application/pdf",
        source_role: "coordinator",
        status: "processing",
        route: null,
        category: null,
        provenance: null,
        extracted: null,
        confidence: null,
        candidates: null,
        failure_reason: null,
        issues: null,
        applied_at: null,
        undone_at: null,
        created_at: "2026-06-03T10:00:00.000Z",
      },
    ],
    benchmark_sets: [],
    // The metrics log (migration 0021). Three fastball readings for the
    // pitcher from three source tiers, so "best verified, else most
    // recent" has something to choose between: the self-reported 88 is
    // the highest and must lose to the Premier 86. The transfer's two
    // sixty times put the faster one on the coach-timed row, which
    // scores under the PBR one because the tier decides, not the number.
    athlete_metrics: [
      { id: "mx1", org_id: BRIDGE, athlete_id: IDS.athlete, metric: "fbVelo", value: 86, measured_on: "2026-08-15", source: "premier", source_detail: "Bridge Showcase", entered_by: OWNER, created_at: "2026-08-15T18:00:00.000Z" },
      { id: "mx2", org_id: BRIDGE, athlete_id: IDS.athlete, metric: "fbVelo", value: 84, measured_on: "2026-06-01", source: "coach", source_detail: "practice", entered_by: OWNER, created_at: "2026-06-01T18:00:00.000Z" },
      { id: "mx3", org_id: BRIDGE, athlete_id: IDS.athlete, metric: "fbVelo", value: 88, measured_on: "2026-09-01", source: "self", source_detail: null, entered_by: OWNER, created_at: "2026-09-01T18:00:00.000Z" },
      { id: "mx4", org_id: BRIDGE, athlete_id: IDS.athlete, metric: "heightIn", value: 74, measured_on: "2026-06-01", source: "coach", source_detail: "practice", entered_by: OWNER, created_at: "2026-06-01T18:00:00.000Z" },
      { id: "mx5", org_id: BRIDGE, athlete_id: IDS.athleteTransfer, metric: "sixty", value: 6.9, measured_on: "2026-07-20", source: "pbr", source_detail: "PBR Connecticut", entered_by: OWNER, created_at: "2026-07-20T18:00:00.000Z" },
      { id: "mx6", org_id: BRIDGE, athlete_id: IDS.athleteTransfer, metric: "exitVelo", value: 92, measured_on: "2026-08-15", source: "premier", source_detail: "Bridge Showcase", entered_by: OWNER, created_at: "2026-08-15T18:00:00.000Z" },
      { id: "mx7", org_id: BRIDGE, athlete_id: IDS.athleteTransfer, metric: "armVelo", value: 84, measured_on: "2026-08-02", source: "coach", source_detail: "practice", entered_by: OWNER, created_at: "2026-08-02T18:00:00.000Z" },
      { id: "mx8", org_id: BRIDGE, athlete_id: IDS.athleteTransfer, metric: "sixty", value: 6.7, measured_on: "2026-09-14", source: "coach", source_detail: "practice", entered_by: OWNER, created_at: "2026-09-14T18:00:00.000Z" },
    ],
    // What Bridge knows privately about the shared school: the coach
    // contact and a position of need that matches the transfer (MIF,
    // 2027 is the pitcher's grad year, so neither row gets the boost
    // for free; the engine has to check both halves).
    org_school_notes: [
      {
        id: "osn1",
        org_id: BRIDGE,
        school_id: IDS.school,
        coach_name: "Fixture Coach",
        coach_email: "coach@fixture-state.test",
        positions_of_need: [{ position: "MIF", gradYear: 2027 }],
        notes: "Wants a shortstop for 2027.",
        updated_at: "2026-09-01T12:00:00.000Z",
      },
    ],
    // Stored matches, computed just now so the Today screen's seven-day
    // "new" window sees them. The shape is what the engine writes:
    // every dimension carries score, confidence, veto, reasons and
    // warnings, and the transfer's row carries eligibility as well.
    athlete_school_fits: [
      {
        id: "fit1",
        org_id: BRIDGE,
        athlete_id: IDS.athlete,
        school_id: IDS.school,
        score: 93,
        tag: "Safety",
        partial: false,
        dimensions: {
          academic: { score: 90, confidence: "high", veto: false, reasons: ["GPA 3.4 above the 2.5 minimum"], warnings: [] },
          athletic: { score: 92, confidence: "high", veto: false, reasons: ["Fastball 86 meets the D2 target of 84"], warnings: [] },
          financial: { score: 96, confidence: "high", veto: false, reasons: ["Net cost 14,000 is under the 15,000 budget"], warnings: [] },
        },
        reasons: ["GPA 3.4 clears the 2.5 minimum.", "Net cost fits the family budget with room to spare."],
        warnings: [],
        inputs_hash: "fixture",
        computed_at: new Date().toISOString(),
      },
      {
        id: "fit2",
        org_id: BRIDGE,
        athlete_id: IDS.athlete,
        school_id: IDS.schoolD3,
        score: 71,
        tag: "Fit",
        partial: false,
        dimensions: {
          academic: { score: 78, confidence: "high", veto: false, reasons: ["GPA 3.4 above the 3.0 minimum"], warnings: [] },
          athletic: { score: 92, confidence: "high", veto: false, reasons: ["Fastball 86 meets the D3 target of 82"], warnings: [] },
          financial: { score: 40, confidence: "medium", veto: false, reasons: ["Net cost 45,200 is more than 25 percent over the 15,000 budget"], warnings: [] },
        },
        reasons: ["GPA 3.4 clears the 3.0 minimum.", "Net cost runs well past the family budget."],
        warnings: [],
        inputs_hash: "fixture",
        computed_at: new Date().toISOString(),
      },
      {
        id: "fit4",
        org_id: BRIDGE,
        athlete_id: IDS.athleteNoGpa,
        school_id: IDS.schoolD3,
        score: 48,
        tag: "Reach",
        partial: true,
        dimensions: {
          academic: { score: 50, confidence: "unknown", veto: false, reasons: [], warnings: ["No GPA on file: enter GPA for an accurate academic fit"] },
          athletic: { score: 50, confidence: "unknown", veto: false, reasons: [], warnings: ["No measurables on file: enter stats for an accurate athletic fit"] },
          financial: { score: 48, confidence: "low", veto: false, reasons: ["Cost of attendance: $55k/yr"], warnings: ["No family budget on file: add one for a net-cost fit"] },
          counted: ["financial"],
        },
        reasons: ["Cost of attendance: $55k/yr"],
        warnings: ["Scored on financial only: no academic or athletic data yet"],
        inputs_hash: "fixture",
        computed_at: new Date().toISOString(),
      },
      {
        id: "fit3",
        org_id: BRIDGE,
        athlete_id: IDS.athleteTransfer,
        school_id: IDS.school,
        score: 81,
        tag: "Safety",
        partial: false,
        dimensions: {
          academic: { score: 95, confidence: "high", veto: false, reasons: ["College GPA 4.0 above the 2.5 minimum"], warnings: [] },
          athletic: { score: 70, confidence: "high", veto: false, reasons: ["Sixty 6.9 meets the D2 target of 7.0"], warnings: ["Arm 84 is under the 85 target"] },
          financial: { score: 75, confidence: "high", veto: false, reasons: ["Out-of-state cost 38,000 less 9,000 athletic aid against a 20,000 budget"], warnings: [] },
          eligibility: { score: 80, confidence: "medium", veto: false, reasons: ["Three years of eligibility remaining"], warnings: ["Portal window not on file for D2 baseball"] },
        },
        reasons: ["College GPA 4.0 clears the 2.5 minimum.", "Net cost lands within 25 percent of the family budget."],
        warnings: [],
        inputs_hash: "fixture",
        computed_at: new Date().toISOString(),
      },
    ],
  };
}
