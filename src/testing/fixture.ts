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

import { makeFile } from "./vaultFiles";
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
  // Read while no AI key was set (documents.read_by = 'stub'): never
  // appliable, and the review screen says why.
  documentStub: "00000000-0000-0000-0000-000000000112",
  highSchool: "00000000-0000-0000-0000-000000000141",
  highSchoolUnscaled: "00000000-0000-0000-0000-000000000142",
  orgScale: "00000000-0000-0000-0000-000000000121",
  orgList: "00000000-0000-0000-0000-000000000131",
  athleteTransfer: "00000000-0000-0000-0000-0000000000c3",
  athleteElite: "00000000-0000-0000-0000-0000000000c4",
  athleteCommitted: "00000000-0000-0000-0000-0000000000c5",
  athleteEnrolled: "00000000-0000-0000-0000-0000000000c6",
  targetCommitted: "00000000-0000-0000-0000-000000000e3",
  targetToClose: "00000000-0000-0000-0000-000000000e4",
  targetEnrolledCommitted: "00000000-0000-0000-0000-000000000e5",
  targetEnrolledClosed: "00000000-0000-0000-0000-000000000e6",
  athleteGraduated: "00000000-0000-0000-0000-0000000000c7",
  athleteDrafted: "00000000-0000-0000-0000-0000000000c8",
  athleteTransferring: "00000000-0000-0000-0000-0000000000c9",
  targetTransferring: "00000000-0000-0000-0000-000000000e7",
  // Stage 5 Phase 4 (migration 0046): assignments on the fixture athlete,
  // one per status plus one due soon, and the file a family filed.
  documentFiled: "00000000-0000-0000-0000-000000000113",
  assignmentOverdue: "00000000-0000-0000-0000-000000000151",
  assignmentDueSoon: "00000000-0000-0000-0000-000000000152",
  assignmentSubmitted: "00000000-0000-0000-0000-000000000153",
  assignmentRevision: "00000000-0000-0000-0000-000000000154",
  assignmentComplete: "00000000-0000-0000-0000-000000000155",
  assignmentCancelled: "00000000-0000-0000-0000-000000000156",
  assignmentElite: "00000000-0000-0000-0000-000000000157",
} as const;

// A day counted from whenever the fixture is built, as YYYY-MM-DD, so a
// row meant to be due soon never drifts into overdue as the calendar
// moves. An overdue row uses a fixed past date instead: it can only get
// more overdue.
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// The five-state fields migration 0048 adds to every document. A fixture
// row says what it needs to and this fills in the rest the way the
// migration's backfill does: processing, pending, applied, failed and
// filed rows are Needs Review, discarded is Archived, and the original is
// the one stored copy. Ready is never inferred; a row must ask for it.
const FORMAT_OF: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
function withVaultFields(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((d) => ({
    lifecycle: d.status === "discarded" ? "archived" : "needs_review",
    lifecycle_changed_at: d.created_at,
    format: FORMAT_OF[String(d.media_type)] ?? null,
    original_paths: d.storage_paths ?? [],
    review_reason: d.status === "failed" ? (d.failure_reason ?? null) : d.status === "processing" ? "Reading did not finish." : null,
    uploaded_by: null,
    ...d,
  }));
}

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
      // A file the family login put under its org's family folder
      // (migration 0046): <org>/family/<request>/<file>, owned by the
      // login that uploaded it, the one submit_assignment checks. The
      // submitted fixture assignment's filed document points at it.
      {
        bucket: "documents",
        name: `${BRIDGE}/family/req_fixture_family/1-june-score-report.pdf`,
        owner: FAMILY,
        base64: Buffer.from("%PDF-1.4\n%fixture score report\n1 0 obj << >> endobj\n%%EOF\n").toString("base64"),
      },
      // The originals behind the vault fixtures below, real bytes of each
      // format so the download route returns something a viewer can open.
      ...(
        [
          ["req_fixture_word/1-team-letter.docx", "docx"],
          ["req_fixture_mismatch/1-june-scores.pdf", "pdf"],
          ["req_fixture_csv/1-roster-export.csv", "csv"],
          ["req_fixture_txt/1-old-notes.txt", "txt"],
          ["req_fixture_reading/1-scan-in-progress.pdf", "pdf"],
          ["req_fixture_xlsx/1-just-arrived.xlsx", "xlsx"],
        ] as const
      ).map(([name, kind]) => ({ bucket: "documents", name: `${BRIDGE}/${name}`, base64: Buffer.from(makeFile(kind)).toString("base64") })),
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
        // Left as production has it. Nothing reads it since 2026-09-27
        // (the access names are fixed), and the law in accessLaws.test.ts
        // proves none of these words reaches a screen.
        role_labels: { owner: "Executive Director", staff: "Coordinator", member: "Board" },
        branding: { logo: "/logos/bridge-mark.png", lockup: "/logos/bridge-lockup.png" },
        scoring_preset: "money_first",
        docai_budget_cents: 2000,
        // The org whose owner edits the shared directory (schools,
        // coaches, transfer windows; migration 0040). Elite does not, so
        // an owner who is not a directory editor has a fixture too.
        edits_shared_directory: true,
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
        edits_shared_directory: false,
      },
    ],
    org_members: [
      // A Title set by an Admin (migration 0041), shown in place of the
      // access level next to the owner's name, on the athlete pages
      // they advise included.
      { id: "m1", user_id: OWNER, org_id: BRIDGE, role: "owner", title: "Head of Recruiting" },
      { id: "m2", user_id: MEMBER, org_id: BRIDGE, role: "member" },
      { id: "m3", user_id: OWNER, org_id: ELITE, role: "owner" },
      // A leftover staff row. Migration 0041 moves every one to owner;
      // this one stays so the screens prove a straggler reads as Admin.
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
      { org_id: BRIDGE, athlete_id: IDS.athleteEnrolled, user_id: FAMILY, relationship: "parent", created_at: "2026-09-03T12:00:00.000Z" },
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
        date_of_birth: null,
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
        // The owner advises this one and the next (migration 0039): one
        // checked in six days ago, one never. The rest carry no advisor.
        // The stamp is the trigger's (migration 0043): when the owner
        // was last assigned, which orders the Advisor sheet.
        advisor_id: OWNER,
        advisor_assigned_at: "2026-09-10T12:00:00.000Z",
        sport: "baseball",
        position: "RHP",
        status: "Active",
        gpa: 3.4,
        gpa_verified: true,
        grad_year: 2027,
        date_of_birth: "2009-04-02",
        first_full_time_enrollment: null,
        intended_enrollment: "2027-08-20",
        // The high school as picked from the directory (Stage 4), so Edit
        // has a value to show and keep.
        detail: { kind: "hs", apCount: 2, highSchool: "Fixture High School", highSchoolId: IDS.highSchool },
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
        advisor_id: OWNER,
        advisor_assigned_at: "2026-09-20T12:00:00.000Z",
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
      {
        // Committed on one target, still In Contact on another: the
        // Mark Enrolled screen and action have something real to close.
        id: IDS.athleteCommitted,
        org_id: BRIDGE,
        recruit_type: "hs",
        name: "Fixture Committed",
        sport: "baseball",
        position: "SS",
        status: "Committed",
        gpa: 3.5,
        gpa_verified: true,
        grad_year: 2027,
        date_of_birth: "2009-01-01",
        first_full_time_enrollment: null,
        intended_enrollment: "2027-08-20",
        detail: { kind: "hs" },
        measurables: {},
        is_international: false,
        toefl_score: null,
        ielts_score: null,
        f1_visa_status: null,
        ncaa_eligibility_status: "In Progress",
        deleted_at: null,
        goal: "balanced",
        family_budget_cents: null,
        home_state: "CT",
        grades: {},
      },
      {
        // Already enrolled: no Matches section, the stepper gives way
        // to the Enrolled row, and the target that would have stayed
        // open already carries its closing note.
        id: IDS.athleteEnrolled,
        org_id: BRIDGE,
        recruit_type: "hs",
        name: "Fixture Enrolled",
        sport: "baseball",
        position: "OF",
        status: "Enrolled",
        gpa: 3.6,
        gpa_verified: true,
        grad_year: 2026,
        date_of_birth: "2008-05-01",
        first_full_time_enrollment: "2026-08-01",
        intended_enrollment: "2026-08-01",
        detail: { kind: "hs" },
        measurables: {},
        is_international: false,
        toefl_score: null,
        ielts_score: null,
        f1_visa_status: null,
        ncaa_eligibility_status: "Cleared",
        deleted_at: null,
        goal: "balanced",
        family_budget_cents: null,
        home_state: "CT",
        grades: {},
      },
      {
        // Graduated from college with no target on file: the school is
        // the Current School on the record. Dave, 2026-09-26.
        id: IDS.athleteGraduated,
        org_id: BRIDGE,
        recruit_type: "transfer_4to4",
        name: "Fixture Graduated",
        sport: "baseball",
        position: "C",
        status: "Graduated",
        graduated_on: "2026-05-15",
        gpa: null,
        gpa_verified: false,
        grad_year: null,
        date_of_birth: null,
        first_full_time_enrollment: "2022-08-20",
        intended_enrollment: null,
        detail: { kind: "transfer", currentSchool: "Fixture Tech", transferCount: 0 },
        measurables: null,
        is_international: false,
        toefl_score: null,
        ielts_score: null,
        f1_visa_status: null,
        ncaa_eligibility_status: null,
        deleted_at: null,
        goal: "balanced",
        family_budget_cents: null,
        home_state: "CT",
        grades: {},
      },
      {
        // Drafted out of high school: named by the team, round and year.
        id: IDS.athleteDrafted,
        org_id: BRIDGE,
        recruit_type: "hs",
        name: "Fixture Drafted",
        sport: "baseball",
        position: "RHP",
        status: "Drafted",
        draft_team: "Fixture Pros",
        draft_round: 5,
        draft_year: 2026,
        gpa: null,
        gpa_verified: false,
        grad_year: 2026,
        date_of_birth: null,
        first_full_time_enrollment: null,
        intended_enrollment: null,
        detail: { kind: "hs" },
        measurables: null,
        is_international: false,
        toefl_score: null,
        ielts_score: null,
        f1_visa_status: null,
        ncaa_eligibility_status: null,
        deleted_at: null,
        goal: "balanced",
        family_budget_cents: null,
        home_state: "CT",
        grades: {},
      },
      {
        // Reopened recruiting after enrolling: a college athlete scored
        // again as a transfer. Not placed, so Matches and Targets are
        // back on the profile, and Today counts a Transferring tile.
        id: IDS.athleteTransferring,
        org_id: BRIDGE,
        recruit_type: "transfer_4to4",
        name: "Fixture Transferring",
        sport: "baseball",
        position: "1B",
        status: "Transferring",
        gpa: null,
        gpa_verified: false,
        grad_year: null,
        date_of_birth: null,
        first_full_time_enrollment: "2025-08-25",
        intended_enrollment: null,
        detail: { kind: "transfer", currentSchool: "Fixture State University", currentDivision: "D2", eligibilityYearsRemaining: 2, transferCount: 1 },
        measurables: null,
        is_international: false,
        toefl_score: null,
        ielts_score: null,
        f1_visa_status: null,
        ncaa_eligibility_status: null,
        deleted_at: null,
        goal: "balanced",
        family_budget_cents: null,
        home_state: "CT",
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
        academics: { gpaMin: 2.5, gpaAvg: 3.2, satRange: "1050-1250", majorsNote: "Biology (BS) and Exercise Science (BS)." },
        financials: { athleticScholarship: "partial", avgAthleticAid: 9000, outstateTotal: 38000, rosterSpotsOpen: 2 },
        athletics: { playingTimeOutlook: "competitive", positionDepth: "Three arms ahead on the depth chart." },
        conflicts: [],
        profile_date: "2024-01-01",
        program_tier: "d2_naia",
        state: "CT",
        location: "Fixture City, CT",
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
        location: "Fixture Town, NY",
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
        closed_from: null,
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
        closed_from: null,
        updated_at: "2026-05-01",
      },
      {
        id: IDS.targetCommitted,
        org_id: BRIDGE,
        athlete_id: IDS.athleteCommitted,
        school_id: IDS.school,
        status: "Committed",
        coach_name: "Fixture Coach",
        offer_type: "scholarship",
        offer_scholarship_percent: 100,
        closed_from: null,
        updated_at: "2026-08-01",
      },
      {
        // Still open: the enroll screen previews this closing, and the
        // action closes it to Not Interested with a note.
        id: IDS.targetToClose,
        org_id: BRIDGE,
        athlete_id: IDS.athleteCommitted,
        school_id: IDS.schoolD3,
        status: "In Contact",
        coach_name: null,
        offer_type: null,
        offer_scholarship_percent: null,
        closed_from: null,
        updated_at: "2026-08-10",
      },
      {
        id: IDS.targetEnrolledCommitted,
        org_id: BRIDGE,
        athlete_id: IDS.athleteEnrolled,
        school_id: IDS.school,
        status: "Committed",
        coach_name: "Fixture Coach",
        offer_type: "scholarship",
        offer_scholarship_percent: 100,
        closed_from: null,
        updated_at: "2026-01-01",
      },
      {
        // Already closed by a prior enrollment, note and all: proves the
        // Colleges section still shows the honest history.
        id: IDS.targetEnrolledClosed,
        org_id: BRIDGE,
        athlete_id: IDS.athleteEnrolled,
        school_id: IDS.schoolD3,
        status: "Not Interested",
        coach_name: null,
        offer_type: null,
        offer_scholarship_percent: null,
        // What the close-out replaced, so Reopen Recruiting can put it
        // back. Every other row says null explicitly: the fake's .not()
        // treats a missing key as not-null, so an omitted closed_from
        // would read as reopenable in tests only.
        closed_from: "In Contact",
        notes: "Closed automatically: Fixture Enrolled enrolled at Fixture State University on Aug 1, 2026.",
        updated_at: "2026-08-01",
      },
      {
        // The one open target of the athlete who reopened recruiting:
        // their profile shows Matches and Targets again.
        id: IDS.targetTransferring,
        org_id: BRIDGE,
        athlete_id: IDS.athleteTransferring,
        school_id: IDS.schoolD3,
        status: "In Contact",
        coach_name: null,
        offer_type: null,
        offer_scholarship_percent: null,
        closed_from: null,
        updated_at: "2026-09-10",
      },
    ],
    target_communications: [
      { id: "tc1", org_id: BRIDGE, target_id: IDS.target, kind: "email", notes: "Fixture note.", occurred_on: "2026-08-20" },
      { id: "tc2", org_id: BRIDGE, target_id: IDS.target, kind: "call", notes: null, occurred_on: null },
    ],
    target_visits: [
      { id: "tv1", org_id: BRIDGE, target_id: IDS.target, visit_type: "unofficial", impression: "Fixture impression.", visit_date: "2026-07-04", next_step: null, notes: null },
    ],
    // Stage 3 (migration 0039). One check-in on the fixture athlete, six
    // days before whenever the fixture is built so it is never due and
    // never drifts into due as the calendar moves; the athlete with no
    // GPA has none, so Today and My Athletes have a never checked in row.
    // Two messages on the same athlete's thread, staff then family, and
    // no read marks yet. Check-ins are staff only; the family reads the
    // thread and never the log.
    athlete_checkins: [
      { id: "ck1", org_id: BRIDGE, athlete_id: IDS.athlete, advisor_id: OWNER, kind: "call", occurred_on: new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10), notes: "Fixture check-in note.", created_at: new Date(Date.now() - 6 * 86_400_000).toISOString() },
    ],
    athlete_messages: [
      { id: "am1", org_id: BRIDGE, athlete_id: IDS.athlete, author_id: OWNER, body: "Fixture message from staff.", created_at: "2026-09-21T14:00:00.000Z" },
      { id: "am2", org_id: BRIDGE, athlete_id: IDS.athlete, author_id: FAMILY, body: "Fixture reply from the family.", created_at: "2026-09-22T18:30:00.000Z" },
    ],
    athlete_message_reads: [],
    contacts: [{ id: "ct1", org_id: BRIDGE, athlete_id: IDS.athlete, name: "Fixture Parent", role: "parent_guardian", email: null, phone: null, school_id: null, notes: null }],
    transfer_windows: [
      { id: "tw1", sport: "baseball", division: "D2", season_year: "2026", window_label: "Fixture window", opens_on: "2026-12-01", closes_on: "2026-12-15", source_url: "https://example.test/fixture-window", notes: "Fixture window note." },
    ],
    // The shared high school directory (migration 0040). Invented schools,
    // standing in for rows the NCES loader writes. The fake client does
    // not compute generated columns, so name_key is written by hand, the
    // way Postgres would: lower(btrim(name)). The second carries the CEEB
    // code the approved-list form defaults to.
    high_schools: [
      { id: IDS.highSchool, name: "Fixture High School", city: "Fixture City", state: "CT", country: "US", nces_id: "fixture-nces-1", ceeb_code: null, source: "manual", created_at: "2026-09-27T12:00:00.000Z", name_key: "fixture high school" },
      { id: IDS.highSchoolUnscaled, name: "Unscaled High School", city: "Fixture Town", state: "NY", country: "US", nces_id: "fixture-nces-2", ceeb_code: "123456", source: "manual", created_at: "2026-09-27T12:00:00.000Z", name_key: "unscaled high school" },
    ],
    // Staff notes (migration 0040): one per org, so a leak across orgs
    // would show up as a note on the wrong screen rather than an empty
    // one. Staff only: no family or member page reads this table.
    athlete_notes: [
      { id: "an1", org_id: BRIDGE, athlete_id: IDS.athlete, author_id: OWNER, context: "general", body: "Fixture note.", created_at: "2026-09-24T15:00:00.000Z" },
      { id: "an2", org_id: ELITE, athlete_id: IDS.athleteElite, author_id: OWNER, context: "general", body: "Fixture squad note.", created_at: "2026-09-25T15:00:00.000Z" },
    ],
    // The activity log (migration 0044): who did what, on the fixture
    // athlete and on the org, in template sentences that carry names,
    // statuses, kinds and dates only, never a note, a message or a
    // reading (src/laws/activityLaws.test.ts holds the fixture to that).
    // None on the transfer athlete, so the empty state renders. One Elite
    // row, so a leak across orgs shows as a wrong line rather than an
    // empty screen. Admins only: no family or member page reads this.
    activity_log: [
      { id: "al1", org_id: BRIDGE, athlete_id: IDS.athlete, actor_id: OWNER, action: "athlete_created", subject_type: "athlete", subject_id: IDS.athlete, summary: "Added Fixture Athlete", created_at: "2026-09-05T13:00:00.000Z" },
      { id: "al2", org_id: BRIDGE, athlete_id: IDS.athlete, actor_id: OWNER, action: "target_added", subject_type: "target", subject_id: IDS.target, summary: "Added Fixture State University as a target for Fixture Athlete", created_at: "2026-09-12T15:30:00.000Z" },
      { id: "al3", org_id: BRIDGE, athlete_id: IDS.athlete, actor_id: OWNER, action: "target_status_changed", subject_type: "target", subject_id: IDS.target, summary: "Moved Fixture Athlete at Fixture State University from Target to In Contact", created_at: "2026-09-18T16:00:00.000Z" },
      { id: "al4", org_id: BRIDGE, athlete_id: IDS.athlete, actor_id: OWNER, action: "checkin_logged", subject_type: "checkin", subject_id: "ck1", summary: "Logged a call check-in for Fixture Athlete on Sep 21, 2026", created_at: "2026-09-21T17:00:00.000Z" },
      { id: "al5", org_id: BRIDGE, athlete_id: IDS.athlete, actor_id: FAMILY, action: "message_sent", subject_type: "message", subject_id: null, summary: "Sent a message", created_at: "2026-09-22T18:30:00.000Z" },
      { id: "al6", org_id: BRIDGE, athlete_id: IDS.athlete, actor_id: OWNER, action: "advisor_set", subject_type: "athlete", subject_id: IDS.athlete, summary: "Set Example Owner as the advisor for Fixture Athlete", created_at: "2026-09-10T12:00:00.000Z" },
      // About the org, not an athlete: the member row the owner invited.
      { id: "al7", org_id: BRIDGE, athlete_id: null, actor_id: OWNER, action: "member_invited", subject_type: "member", subject_id: "m2", summary: "Invited Example Member as a Viewer", created_at: "2026-09-04T12:00:00.000Z" },
      { id: "al8", org_id: ELITE, athlete_id: IDS.athleteElite, actor_id: OWNER, action: "athlete_created", subject_type: "athlete", subject_id: IDS.athleteElite, summary: "Added Squad Athlete", created_at: "2026-09-06T12:00:00.000Z" },
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
    documents: withVaultFields([
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
        // Which model read it (migration 0040). A real model, so it can
        // be applied.
        read_by: "claude-opus-5",
        created_at: "2026-06-01",
      },
      // Read by the stub model because no AI key was set: its numbers are
      // invented, so it can never be applied, and the review screen says
      // so instead of offering Apply.
      {
        id: IDS.documentStub,
        org_id: BRIDGE,
        athlete_id: IDS.athlete,
        file_name: "stub-read.pdf",
        file_size: 1000,
        media_type: "application/pdf",
        source_role: "coordinator",
        status: "pending",
        route: "review",
        category: "transcript",
        provenance: "model",
        extracted: { gpa: 3.9, warnings: [] },
        confidence: { score: 0.9, reasons: ["fixture"] },
        candidates: [],
        failure_reason: null,
        issues: null,
        applied_at: null,
        undone_at: null,
        read_by: "stub",
        created_at: "2026-06-04",
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
        read_by: null,
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
        read_by: null,
        created_at: "2026-06-03T10:00:00.000Z",
      },
      // A file an Athlete login handed in with an assignment (migration
      // 0046): status filed, never read by a model, never in Needs
      // Review, never with an Apply button. The submitted assignment
      // below links to it.
      {
        id: IDS.documentFiled,
        org_id: BRIDGE,
        athlete_id: IDS.athlete,
        file_name: "june-score-report.pdf",
        file_size: 1000,
        media_type: "application/pdf",
        source_role: "parent",
        status: "filed",
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
        read_by: null,
        storage_paths: [`${BRIDGE}/family/req_fixture_family/1-june-score-report.pdf`],
        content_hash: "fixture-filed-hash",
        created_at: "2026-09-22T20:00:00.000Z",
      },
      // The rest of the vault's five states, so every one renders on the
      // list and on the document screen. A stored Word file nobody tagged
      // with a type: straight to Needs Review, not read.
      {
        id: "doc-word",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "team-letter.docx",
        file_size: 48213,
        media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        format: "word",
        source_role: "coordinator",
        status: "pending",
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
        read_by: null,
        storage_paths: [`${BRIDGE}/req_fixture_word/1-team-letter.docx`],
        original_paths: [`${BRIDGE}/req_fixture_word/1-team-letter.docx`],
        content_hash: "3f786850e387550fdab836ed7e6dc881de23001b9a1f2d2c8c1b8b3a51f0a1b2",
        uploaded_by: OWNER,
        created_at: "2026-09-25T15:00:00.000Z",
      },
      // Piece 2 (migration 0049): a spreadsheet nobody tagged, suggested
      // as a college list about one athlete, waiting for Confirm.
      {
        id: "doc-suggested",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "Fixture_Athlete college list.xlsx",
        file_size: 9216,
        media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        format: "excel",
        source_role: "coordinator",
        status: "pending",
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
        read_by: null,
        storage_paths: [`${BRIDGE}/req_fixture_suggested/1-Fixture_Athlete_college_list.xlsx`],
        original_paths: [`${BRIDGE}/req_fixture_suggested/1-Fixture_Athlete_college_list.xlsx`],
        content_hash: "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2",
        uploaded_by: OWNER,
        created_at: "2026-10-08T14:00:00.000Z",
        suggested_type: "school_list",
        suggested_type_confidence: 0.75,
        suggested_type_reasons: ['File name says "college list"', "A spreadsheet"],
        identity_status: "proposed",
        identity_candidates: [{ athleteId: IDS.athlete, name: "Fixture Athlete", school: "Fixture High School", gradYear: 2027, score: 0.8, reasons: ["Name in the file name"] }],
        suggested_at: "2026-10-08T14:00:00.000Z",
        subject_athlete_id: null,
      },
      // Two athletes a family email points at: nobody is picked.
      {
        id: "doc-ambiguous",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "contact-sheet.csv",
        file_size: 1024,
        media_type: "text/csv",
        format: "csv",
        source_role: "coordinator",
        status: "pending",
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
        read_by: null,
        storage_paths: [`${BRIDGE}/req_fixture_ambiguous/1-contact-sheet.csv`],
        original_paths: [`${BRIDGE}/req_fixture_ambiguous/1-contact-sheet.csv`],
        content_hash: "c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3",
        uploaded_by: OWNER,
        created_at: "2026-10-08T14:05:00.000Z",
        suggested_type: "other",
        suggested_type_confidence: 0,
        suggested_type_reasons: ["Nothing in the name or the words points at a type"],
        identity_status: "ambiguous",
        identity_candidates: [
          { athleteId: IDS.athlete, name: "Fixture Athlete", school: null, gradYear: null, score: 0.95, reasons: ["A family email in the file"] },
          { athleteId: IDS.athleteNoGpa, name: "Fixture Unknown", school: null, gradYear: null, score: 0.95, reasons: ["A family email in the file"] },
        ],
        suggested_at: "2026-10-08T14:05:00.000Z",
        subject_athlete_id: null,
      },
      // Tagged Transcript, but it was a score report: kept, in Needs
      // Review, with the reason on the row. Not a rejection.
      {
        id: "doc-mismatch",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "june-scores.pdf",
        file_size: 61440,
        media_type: "application/pdf",
        format: "pdf",
        requested_category: "transcript",
        source_role: "coordinator",
        status: "failed",
        route: "reject",
        category: "transcript",
        failure_stage: "triage_wrong_category",
        failure_reason: "This looks like test scores, not a transcript.",
        review_reason: "Did not look like Transcript",
        provenance: null,
        extracted: null,
        confidence: null,
        candidates: null,
        issues: null,
        applied_at: null,
        undone_at: null,
        read_by: "claude-opus-5",
        storage_paths: [`${BRIDGE}/req_fixture_mismatch/1-june-scores.pdf`],
        original_paths: [`${BRIDGE}/req_fixture_mismatch/1-june-scores.pdf`],
        content_hash: "9a1f7c6b0e3d4a5f8b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f00",
        uploaded_by: OWNER,
        created_at: "2026-09-26T15:00:00.000Z",
      },
      // Marked Ready by a person.
      {
        id: "doc-ready",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "roster-export.csv",
        file_size: 2048,
        media_type: "text/csv",
        format: "csv",
        source_role: "admin",
        status: "pending",
        route: null,
        lifecycle: "ready",
        lifecycle_changed_at: "2026-09-27T16:00:00.000Z",
        category: null,
        provenance: null,
        extracted: null,
        confidence: null,
        candidates: null,
        failure_reason: null,
        issues: null,
        applied_at: null,
        undone_at: null,
        read_by: null,
        storage_paths: [`${BRIDGE}/req_fixture_csv/1-roster-export.csv`],
        original_paths: [`${BRIDGE}/req_fixture_csv/1-roster-export.csv`],
        content_hash: "5c1a2b3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f",
        uploaded_by: OWNER,
        created_at: "2026-09-27T15:00:00.000Z",
      },
      // Archived by a person: out of the working lists, still here.
      {
        id: "doc-archived",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "old-notes.txt",
        file_size: 512,
        media_type: "text/plain",
        format: "txt",
        source_role: "coordinator",
        status: "pending",
        route: null,
        lifecycle: "archived",
        lifecycle_changed_at: "2026-09-28T16:00:00.000Z",
        category: null,
        provenance: null,
        extracted: null,
        confidence: null,
        candidates: null,
        failure_reason: null,
        issues: null,
        applied_at: null,
        undone_at: null,
        read_by: null,
        storage_paths: [`${BRIDGE}/req_fixture_txt/1-old-notes.txt`],
        original_paths: [`${BRIDGE}/req_fixture_txt/1-old-notes.txt`],
        content_hash: "7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f00112233445566778899aabbccd",
        uploaded_by: OWNER,
        created_at: "2026-09-20T15:00:00.000Z",
      },
      // Reading right now (a minute old): Processing, not stuck.
      {
        id: "doc-reading",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "scan-in-progress.pdf",
        file_size: 90000,
        media_type: "application/pdf",
        format: "pdf",
        requested_category: "transcript",
        source_role: "coordinator",
        status: "processing",
        route: null,
        lifecycle: "processing",
        lifecycle_changed_at: new Date(Date.now() - 60_000).toISOString(),
        review_reason: null,
        category: null,
        provenance: null,
        extracted: null,
        confidence: null,
        candidates: null,
        failure_reason: null,
        issues: null,
        applied_at: null,
        undone_at: null,
        read_by: "claude-opus-5",
        storage_paths: [`${BRIDGE}/req_fixture_reading/1-scan-in-progress.pdf`],
        original_paths: [`${BRIDGE}/req_fixture_reading/1-scan-in-progress.pdf`],
        content_hash: "1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f0a",
        uploaded_by: OWNER,
        created_at: new Date(Date.now() - 60_000).toISOString(),
      },
      // Stored and not yet decided: Uploaded, the moment between the file
      // being confirmed and something choosing what happens to it.
      {
        id: "doc-uploaded",
        org_id: BRIDGE,
        athlete_id: null,
        file_name: "just-arrived.xlsx",
        file_size: 15360,
        media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        format: "excel",
        source_role: "coordinator",
        status: "pending",
        route: null,
        lifecycle: "uploaded",
        lifecycle_changed_at: new Date(Date.now() - 30_000).toISOString(),
        category: null,
        provenance: null,
        extracted: null,
        confidence: null,
        candidates: null,
        failure_reason: null,
        issues: null,
        applied_at: null,
        undone_at: null,
        read_by: null,
        storage_paths: [`${BRIDGE}/req_fixture_xlsx/1-just-arrived.xlsx`],
        original_paths: [`${BRIDGE}/req_fixture_xlsx/1-just-arrived.xlsx`],
        content_hash: "2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f0a1b",
        uploaded_by: OWNER,
        created_at: new Date(Date.now() - 30_000).toISOString(),
      },
    ]),
    // Assignments (migration 0046). On the fixture athlete, one in each
    // status: overdue (assigned, a fixed date well past), due soon
    // (assigned, three days out), submitted (with the filed document and
    // the family's note), needs revision (with the reviewer's comment),
    // complete, and cancelled. None on the transfer athlete, so the
    // empty states render. One Elite row, so a leak across orgs shows as
    // a wrong line rather than an empty screen. Admins and the athlete's
    // own login only: no member page reads this table.
    assignments: [
      { id: IDS.assignmentOverdue, org_id: BRIDGE, athlete_id: IDS.athlete, title: "Send Fall Transcript", instructions: "Upload your most recent transcript as a PDF or a clear photo.", category: "academics", kind: "upload", due_on: "2026-09-01", status: "assigned", document_id: null, family_note: null, reviewer_comment: null, created_by: OWNER, reviewed_by: null, submitted_at: null, reviewed_at: null, created_at: "2026-08-25T14:00:00.000Z", updated_at: "2026-08-25T14:00:00.000Z" },
      { id: IDS.assignmentDueSoon, org_id: BRIDGE, athlete_id: IDS.athlete, title: "Confirm Showcase Dates", instructions: "Look over the three dates and confirm you can make them.", category: "athletics", kind: "confirm", due_on: inDays(3), status: "assigned", document_id: null, family_note: null, reviewer_comment: null, created_by: OWNER, reviewed_by: null, submitted_at: null, reviewed_at: null, created_at: "2026-09-20T14:00:00.000Z", updated_at: "2026-09-20T14:00:00.000Z" },
      { id: IDS.assignmentSubmitted, org_id: BRIDGE, athlete_id: IDS.athlete, title: "Upload Test Scores", instructions: "Send the official score report.", category: "eligibility", kind: "upload", due_on: "2026-09-25", status: "submitted", document_id: IDS.documentFiled, family_note: "Sent the June score report.", reviewer_comment: null, created_by: OWNER, reviewed_by: null, submitted_at: "2026-09-22T20:00:00.000Z", reviewed_at: null, created_at: "2026-09-15T14:00:00.000Z", updated_at: "2026-09-22T20:00:00.000Z" },
      { id: IDS.assignmentRevision, org_id: BRIDGE, athlete_id: IDS.athlete, title: "Complete Family Budget Form", instructions: "Fill in what the family can spend per year.", category: "financial_aid", kind: "complete_info", due_on: inDays(20), status: "needs_revision", document_id: null, family_note: "Filled in the budget.", reviewer_comment: "Please add the second parent's contribution.", created_by: OWNER, reviewed_by: OWNER, submitted_at: "2026-09-18T20:00:00.000Z", reviewed_at: "2026-09-19T15:00:00.000Z", created_at: "2026-09-10T14:00:00.000Z", updated_at: "2026-09-19T15:00:00.000Z" },
      { id: IDS.assignmentComplete, org_id: BRIDGE, athlete_id: IDS.athlete, title: "Confirm Graduation Year", instructions: null, category: "recruiting", kind: "confirm", due_on: "2026-08-30", status: "complete", document_id: null, family_note: "Confirmed, 2027.", reviewer_comment: null, created_by: OWNER, reviewed_by: OWNER, submitted_at: "2026-08-28T20:00:00.000Z", reviewed_at: "2026-08-29T15:00:00.000Z", created_at: "2026-08-20T14:00:00.000Z", updated_at: "2026-08-29T15:00:00.000Z" },
      { id: IDS.assignmentCancelled, org_id: BRIDGE, athlete_id: IDS.athlete, title: "Register For Fall Camp", instructions: null, category: "other", kind: "other", due_on: null, status: "cancelled", document_id: null, family_note: null, reviewer_comment: null, created_by: OWNER, reviewed_by: null, submitted_at: null, reviewed_at: null, created_at: "2026-08-15T14:00:00.000Z", updated_at: "2026-08-16T14:00:00.000Z" },
      { id: IDS.assignmentElite, org_id: ELITE, athlete_id: IDS.athleteElite, title: "Squad Only Task", instructions: null, category: "other", kind: "other", due_on: "2026-09-02", status: "assigned", document_id: null, family_note: null, reviewer_comment: null, created_by: OWNER, reviewed_by: null, submitted_at: null, reviewed_at: null, created_at: "2026-08-30T14:00:00.000Z", updated_at: "2026-08-30T14:00:00.000Z" },
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
    // The shared coach directory (migration 0036). Invented people at an
    // invented school; the second has no email, so the row calls instead.
    college_coaches: [
      { id: "cc1", school_id: IDS.school, school_name: "Fixture State University", name: "Fixture Assistant", title: "Assistant Coach", email: "assistant@fixture.example", phone: null, is_recruiting_coordinator: true, email_verified: true, source_url: null, notes: null },
      { id: "cc2", school_id: IDS.school, school_name: "Fixture State University", name: "Fixture Head", title: "Head Coach", email: null, phone: "555-0100", is_recruiting_coordinator: false, email_verified: false, source_url: null, notes: null },
    ],
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
        net_cost: 14000,
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
        net_cost: 45200,
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
        net_cost: 55000,
        inputs_hash: "fixture",
        computed_at: new Date().toISOString(),
      },
      {
        // The same athlete's one fully scored match, at a lower raw
        // score than the partial row above. The ranking rule (full
        // before partial, src/lib/fit/rank.ts) puts this row first even
        // so; a list sorted by raw score alone would not, which is what
        // gives the ordering laws a case to catch.
        id: "fit6",
        org_id: BRIDGE,
        athlete_id: IDS.athleteNoGpa,
        school_id: IDS.school,
        score: 41,
        tag: "Reach",
        partial: false,
        dimensions: {
          academic: { score: 44, confidence: "low", veto: false, reasons: ["Coursework on file is thin against the 2.5 minimum"], warnings: [] },
          athletic: { score: 38, confidence: "low", veto: false, reasons: ["Staff grades put the arm under the D2 target"], warnings: [] },
          financial: { score: 42, confidence: "low", veto: false, reasons: ["Out-of-state cost 38,000 less 9,000 athletic aid"], warnings: ["No family budget on file: add one for a net-cost fit"] },
          counted: ["academic", "athletic", "financial"],
        },
        reasons: ["Staff grades put the arm under the D2 target."],
        warnings: [],
        net_cost: 29000,
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
        net_cost: 29000,
        inputs_hash: "fixture",
        computed_at: new Date().toISOString(),
      },
      {
        // The reopened athlete's one stored match, so their profile has
        // a Matches section with a number in it again.
        id: "fit5",
        org_id: BRIDGE,
        athlete_id: IDS.athleteTransferring,
        school_id: IDS.schoolD3,
        score: 64,
        tag: "Fit",
        partial: false,
        dimensions: {
          academic: { score: 60, confidence: "medium", veto: false, reasons: ["No college GPA on file"], warnings: [] },
          athletic: { score: 62, confidence: "low", veto: false, reasons: [], warnings: ["No measurables on file"] },
          financial: { score: 70, confidence: "medium", veto: false, reasons: ["Cost of attendance: $55k/yr"], warnings: [] },
          eligibility: { score: 65, confidence: "medium", veto: false, reasons: ["Two years of eligibility remaining"], warnings: ["Portal window not on file for D3 baseball"] },
        },
        reasons: ["Two years of eligibility remaining."],
        warnings: [],
        net_cost: 41000,
        inputs_hash: "fixture",
        computed_at: new Date().toISOString(),
      },
    ],
  };
}
