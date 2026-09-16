// Mock data for the click-through prototype.
//
// Two organizations, because the multi-tenancy is a thing worth showing
// rather than describing: switching to Elite Squad changes the role
// labels, hides the fundraising and board modules, and shows a different
// roster, with no code branching on which org it is.
//
// Every person here is invented. No real athlete, donor or board member
// appears in a prototype, the same rule the seed scripts follow.

const DATA = {
  orgs: {
    bridge: {
      id: "org-bridge",
      name: "Bridge Foundation for Student Athletes",
      shortName: "Bridge",
      slug: "bridge",
      roleLabels: { owner: "Executive Director", staff: "Coordinator", member: "Board Member" },
      modules: { recruiting: true, doc_ai: true, board_governance: true, donor_fundraising: true },
      you: { name: "Example Director", role: "owner" },
    },
    "elite-squad": {
      id: "org-elite",
      name: "Elite Squad NY",
      shortName: "Elite Squad",
      slug: "elite-squad",
      roleLabels: { owner: "Owner", staff: "Coach", member: "Parent" },
      modules: { recruiting: true, doc_ai: true, board_governance: false, donor_fundraising: false },
      you: { name: "Example Owner", role: "owner" },
    },
  },

  schools: [
    {
      id: "sch-1",
      name: "Hartwell University",
      division: "D1",
      conference: "Northeast Conference",
      sportsSponsored: ["baseball"],
      academics: { gpaMin: 2.5, gpaAvg: 3.4, satRange: "1100-1290" },
      financials: { athleticScholarship: "partial", avgAthleticAid: 14000, outstateTotal: 58000, instateTotal: 38000, rosterSpotsOpen: 2 },
      athletics: { playingTimeOutlook: "competitive", positionDepth: "Two arms ahead on the depth chart" },
    },
    {
      id: "sch-2",
      name: "Corville College",
      division: "D3",
      conference: "Liberty League",
      sportsSponsored: ["baseball"],
      academics: { gpaMin: 3.0, gpaAvg: 3.6, satRange: "1200-1370" },
      // D3 never shows a scholarship claim whatever this says. The
      // prototype runs the real engine, so the law holds here too.
      financials: { athleticScholarship: "partial", avgMeritAid: 22000, outstateTotal: 64000, instateTotal: 64000 },
      athletics: { playingTimeOutlook: "realistic" },
    },
    {
      id: "sch-3",
      name: "Marbury State",
      division: "D2",
      conference: "Central Atlantic",
      sportsSponsored: ["baseball"],
      academics: { gpaMin: 2.2, gpaAvg: 3.1 },
      financials: { athleticScholarship: "partial", avgAthleticAid: 9000, outstateTotal: 31000, instateTotal: 21000 },
      athletics: { playingTimeOutlook: "realistic", positionDepth: "Graduating both starters" },
    },
    {
      id: "sch-4",
      name: "Pinehurst Academy",
      division: "JUCO D1",
      conference: "Region XV",
      sportsSponsored: ["baseball"],
      academics: { gpaMin: 2.0 },
      financials: { athleticScholarship: "partial", avgAthleticAid: 6000, outstateTotal: 18000, instateTotal: 12000 },
      athletics: { playingTimeOutlook: "realistic" },
    },
  ],

  athletes: [
    {
      id: "ath-1",
      orgId: "org-bridge",
      recruitType: "hs",
      name: "Marcus Ellery",
      sport: "baseball",
      position: "RHP",
      gpa: 3.1,
      gpaVerified: true,
      status: "Active",
      school: "Cardinal Ridge High School",
      dateOfBirth: "2008-11-04",
      intendedEnrollment: "2027-08-20",
      detail: { kind: "hs", gradYear: 2027, apCount: 2, honorsCount: 3, satTotal: 1150 },
      measurables: { fastballVelo: 88, exitVelo: 94 },
    },
    {
      id: "ath-2",
      orgId: "org-bridge",
      recruitType: "hs",
      name: "Andre Whitlock",
      sport: "baseball",
      position: "SS",
      gpa: 2.95,
      gpaVerified: true,
      status: "Active",
      school: "Cardinal Ridge High School",
      dateOfBirth: "2008-06-22",
      intendedEnrollment: "2027-08-20",
      detail: { kind: "hs", gradYear: 2027, apCount: 0, honorsCount: 1, satTotal: 1020 },
      measurables: { sixtyTime: 6.9, exitVelo: 91 },
    },
    {
      id: "ath-3",
      orgId: "org-bridge",
      recruitType: "hs",
      name: "Tobias Reyn",
      sport: "baseball",
      position: "OF",
      gpa: 3.4,
      gpaVerified: false,
      status: "Active",
      school: "Westhaven Prep",
      dateOfBirth: "2007-03-15",
      intendedEnrollment: "2027-08-20",
      detail: { kind: "hs", gradYear: 2027, apCount: 4, honorsCount: 2, satTotal: 1280 },
      measurables: { sixtyTime: 6.6, exitVelo: 97 },
    },
    {
      id: "ath-4",
      orgId: "org-bridge",
      recruitType: "transfer",
      name: "Desmond Kale",
      sport: "baseball",
      position: "C",
      gpa: 3.2,
      gpaVerified: true,
      status: "Active",
      school: "Westhaven Prep",
      dateOfBirth: "2005-09-30",
      firstFullTimeEnrollment: "2024-08-19",
      detail: { kind: "transfer", currentSchool: "Pinehurst Academy", currentDivision: "JUCO D1", collegeGpa: 3.2, creditsEarned: 48, yearsRemaining: 2 },
      measurables: { popTime: 1.95, exitVelo: 95 },
    },
    {
      id: "ath-5",
      orgId: "org-elite",
      recruitType: "hs",
      name: "Jonah Petrakis",
      sport: "baseball",
      position: "LHP",
      gpa: 3.6,
      gpaVerified: true,
      status: "Active",
      school: "Nassau Central",
      dateOfBirth: "2008-01-18",
      intendedEnrollment: "2027-08-20",
      detail: { kind: "hs", gradYear: 2027, apCount: 3, honorsCount: 2, satTotal: 1240 },
      measurables: { fastballVelo: 85, exitVelo: 88 },
    },
    {
      id: "ath-6",
      orgId: "org-elite",
      recruitType: "hs",
      name: "Rocco Vantalo",
      sport: "baseball",
      position: "3B",
      gpa: 2.8,
      gpaVerified: true,
      status: "Active",
      school: "Nassau Central",
      dateOfBirth: "2008-04-02",
      intendedEnrollment: "2027-08-20",
      detail: { kind: "hs", gradYear: 2027, apCount: 0, honorsCount: 0, satTotal: 990 },
      measurables: { sixtyTime: 7.1, exitVelo: 93 },
    },
  ],

  targets: [
    { id: "tg-1", orgId: "org-bridge", athleteId: "ath-1", schoolId: "sch-1", status: "Offer", coachName: "Coach Bramley", offerType: "athletic", offerScholarshipPercent: 35, updatedAt: "2026-09-10", visitDate: "2026-10-04", commCount: 6, visitCount: 1 },
    { id: "tg-2", orgId: "org-bridge", athleteId: "ath-1", schoolId: "sch-3", status: "In Contact", coachName: "Coach Dunn", updatedAt: "2026-08-02", commCount: 2, visitCount: 0 },
    { id: "tg-3", orgId: "org-bridge", athleteId: "ath-2", schoolId: "sch-3", status: "Visit", coachName: "Coach Dunn", updatedAt: "2026-09-12", visitDate: "2026-09-27", commCount: 4, visitCount: 1 },
    { id: "tg-4", orgId: "org-bridge", athleteId: "ath-2", schoolId: "sch-4", status: "Target", updatedAt: "2026-06-18", commCount: 0, visitCount: 0 },
    { id: "tg-5", orgId: "org-bridge", athleteId: "ath-3", schoolId: "sch-2", status: "Committed", coachName: "Coach Aldis", offerType: "academic", offerScholarshipPercent: 40, updatedAt: "2026-09-14", commCount: 9, visitCount: 2 },
    { id: "tg-6", orgId: "org-bridge", athleteId: "ath-4", schoolId: "sch-1", status: "In Contact", coachName: "Coach Bramley", updatedAt: "2026-07-21", commCount: 3, visitCount: 0 },
    { id: "tg-7", orgId: "org-elite", athleteId: "ath-5", schoolId: "sch-2", status: "Offer", coachName: "Coach Aldis", offerType: "academic", offerScholarshipPercent: 30, updatedAt: "2026-09-11", commCount: 5, visitCount: 1 },
    { id: "tg-8", orgId: "org-elite", athleteId: "ath-6", schoolId: "sch-4", status: "Target", updatedAt: "2026-05-30", commCount: 1, visitCount: 0 },
  ],

  // Courses off a transcript. Cardinal Ridge prints numbers, which is
  // the case the grading-scale screen exists for; Westhaven prints
  // letters and converts with no table at all.
  courses: [
    { id: "c1", athleteId: "ath-1", title: "English 11", subject: "english", credit: 1, grade: "88", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c2", athleteId: "ath-1", title: "English 10", subject: "english", credit: 1, grade: "84", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c3", athleteId: "ath-1", title: "English 9", subject: "english", credit: 1, grade: "91", term: "22-23", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c4", athleteId: "ath-1", title: "Algebra 2", subject: "math", credit: 1, grade: "79", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c5", athleteId: "ath-1", title: "Geometry", subject: "math", credit: 1, grade: "83", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c6", athleteId: "ath-1", title: "Algebra 1", subject: "math", credit: 1, grade: "86", term: "22-23", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c7", athleteId: "ath-1", title: "AP Biology", subject: "science", credit: 1, grade: "90", term: "24-25", school_name: "Cardinal Ridge High School", weighted: true, ncaa_approved: true, duplicate_of: null },
    { id: "c8", athleteId: "ath-1", title: "Chemistry", subject: "science", credit: 1, grade: "81", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c9", athleteId: "ath-1", title: "US History", subject: "social_science", credit: 1, grade: "87", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c10", athleteId: "ath-1", title: "Global History", subject: "social_science", credit: 1, grade: "85", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c11", athleteId: "ath-1", title: "Spanish 2", subject: "other_academic", credit: 1, grade: "89", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c12", athleteId: "ath-1", title: "Spanish 1", subject: "other_academic", credit: 1, grade: "92", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c13", athleteId: "ath-1", title: "AP Psychology", subject: "other_academic", credit: 1, grade: "88", term: "24-25", school_name: "Cardinal Ridge High School", weighted: true, ncaa_approved: true, duplicate_of: null },
    { id: "c14", athleteId: "ath-1", title: "Computer Science", subject: "other_academic", credit: 1, grade: "94", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c15", athleteId: "ath-1", title: "Economics", subject: "other_academic", credit: 0.5, grade: "90", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "c16", athleteId: "ath-1", title: "Government", subject: "social_science", credit: 0.5, grade: "88", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    // The A grades that lift a transcript average and are excluded from
    // the NCAA one, which is the whole thing the eligibility screen
    // exists to show.
    { id: "c17", athleteId: "ath-1", title: "Phys. Ed. 11", subject: "non_academic", credit: 0.5, grade: "98", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: false, duplicate_of: null },
    { id: "c18", athleteId: "ath-1", title: "Studio Art", subject: "non_academic", credit: 0.5, grade: "97", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: false, duplicate_of: null },

    // Andre: same school, weaker core, which lands him in a different
    // NCAA bucket on the same grading scale.
    { id: "d1", athleteId: "ath-2", title: "English 11", subject: "english", credit: 1, grade: "78", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d2", athleteId: "ath-2", title: "English 10", subject: "english", credit: 1, grade: "81", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d3", athleteId: "ath-2", title: "English 9", subject: "english", credit: 1, grade: "76", term: "22-23", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d4", athleteId: "ath-2", title: "Algebra 2", subject: "math", credit: 1, grade: "72", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d5", athleteId: "ath-2", title: "Geometry", subject: "math", credit: 1, grade: "74", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d6", athleteId: "ath-2", title: "Algebra 1", subject: "math", credit: 1, grade: "80", term: "22-23", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d7", athleteId: "ath-2", title: "Biology", subject: "science", credit: 1, grade: "77", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d8", athleteId: "ath-2", title: "Earth Science", subject: "science", credit: 1, grade: "83", term: "22-23", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d9", athleteId: "ath-2", title: "US History", subject: "social_science", credit: 1, grade: "79", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d10", athleteId: "ath-2", title: "Global History", subject: "social_science", credit: 1, grade: "82", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d11", athleteId: "ath-2", title: "Spanish 1", subject: "other_academic", credit: 1, grade: "85", term: "23-24", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d12", athleteId: "ath-2", title: "Spanish 2", subject: "other_academic", credit: 1, grade: "81", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d13", athleteId: "ath-2", title: "Health", subject: "other_academic", credit: 1, grade: "88", term: "22-23", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "d14", athleteId: "ath-2", title: "Phys. Ed. 11", subject: "non_academic", credit: 0.5, grade: "99", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: false, duplicate_of: null },
    { id: "d15", athleteId: "ath-2", title: "Weight Training", subject: "non_academic", credit: 0.5, grade: "99", term: "24-25", school_name: "Cardinal Ridge High School", weighted: false, ncaa_approved: false, duplicate_of: null },

    // Tobias: letter grades, so no conversion table is needed at all.
    { id: "e1", athleteId: "ath-3", title: "English 11", subject: "english", credit: 1, grade: "A", term: "24-25", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e2", athleteId: "ath-3", title: "English 10", subject: "english", credit: 1, grade: "A-", term: "23-24", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e3", athleteId: "ath-3", title: "English 9", subject: "english", credit: 1, grade: "B+", term: "22-23", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e4", athleteId: "ath-3", title: "AP Calculus", subject: "math", credit: 1, grade: "B", term: "24-25", school_name: "Westhaven Prep", weighted: true, ncaa_approved: true, duplicate_of: null },
    { id: "e5", athleteId: "ath-3", title: "Precalculus", subject: "math", credit: 1, grade: "A-", term: "23-24", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e6", athleteId: "ath-3", title: "Algebra 2", subject: "math", credit: 1, grade: "A", term: "22-23", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e7", athleteId: "ath-3", title: "AP Chemistry", subject: "science", credit: 1, grade: "B+", term: "24-25", school_name: "Westhaven Prep", weighted: true, ncaa_approved: true, duplicate_of: null },
    { id: "e8", athleteId: "ath-3", title: "Biology", subject: "science", credit: 1, grade: "A", term: "23-24", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e9", athleteId: "ath-3", title: "US History", subject: "social_science", credit: 1, grade: "A", term: "24-25", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e10", athleteId: "ath-3", title: "World History", subject: "social_science", credit: 1, grade: "B+", term: "23-24", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e11", athleteId: "ath-3", title: "Latin 3", subject: "other_academic", credit: 1, grade: "A-", term: "24-25", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e12", athleteId: "ath-3", title: "Latin 2", subject: "other_academic", credit: 1, grade: "A", term: "23-24", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e13", athleteId: "ath-3", title: "Latin 1", subject: "other_academic", credit: 1, grade: "A", term: "22-23", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e14", athleteId: "ath-3", title: "Philosophy", subject: "other_academic", credit: 1, grade: "A-", term: "24-25", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "e15", athleteId: "ath-3", title: "Phys. Ed.", subject: "non_academic", credit: 0.5, grade: "A", term: "24-25", school_name: "Westhaven Prep", weighted: false, ncaa_approved: false, duplicate_of: null },

    // Desmond: a transfer transcript covering two schools, which is the
    // case per-course school exists for.
    { id: "f1", athleteId: "ath-4", title: "English 11", subject: "english", credit: 1, grade: "85", term: "22-23", school_name: "Northbridge High", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "f2", athleteId: "ath-4", title: "Algebra 2", subject: "math", credit: 1, grade: "85", term: "22-23", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
    { id: "f3", athleteId: "ath-4", title: "Biology", subject: "science", credit: 1, grade: "B", term: "22-23", school_name: "Westhaven Prep", weighted: false, ncaa_approved: true, duplicate_of: null },
  ],

  // Cardinal Ridge is on file and is deliberately NOT a ten-point scale,
  // so switching it to the default visibly moves the core GPA.
  gradingScales: [
    {
      school_name: "Cardinal Ridge High School",
      bands: [
        { letter: "A", min: 90, max: 100 },
        { letter: "B", min: 80, max: 89 },
        { letter: "C", min: 73, max: 79 },
        { letter: "D", min: 65, max: 72 },
        { letter: "F", min: 0, max: 64 },
      ],
      reports_weighted_grades: true,
      weighting_is_class_rank_only: false,
      weight_bonus: 0.5,
      origin: "org",
      source_note: "Legend printed on page 2 of the official transcript",
    },
  ],

  documents: [
    { id: "doc-1", orgId: "org-bridge", fileName: "ellery-transcript-2025.pdf", category: "transcript", sourceRole: "coordinator", status: "applied", route: "auto_apply", athleteId: "ath-1", confidence: 0.91, createdAt: "2026-09-08" },
    { id: "doc-2", orgId: "org-bridge", fileName: "IMG_4471.jpeg", category: "transcript", sourceRole: "parent", status: "pending", route: "review", athleteId: null, confidence: 0.63, createdAt: "2026-09-14", candidates: [{ athleteId: "ath-2", name: "Andre Whitlock", score: 0.74 }, { athleteId: "ath-1", name: "Marcus Ellery", score: 0.31 }] },
    { id: "doc-3", orgId: "org-bridge", fileName: "corville-offer.pdf", category: "offer_letter", sourceRole: "email", status: "applied", route: "auto_apply", athleteId: "ath-3", confidence: 0.88, createdAt: "2026-09-14" },
    { id: "doc-4", orgId: "org-bridge", fileName: "scan0032.pdf", category: null, sourceRole: "parent", status: "failed", route: "reject", athleteId: null, confidence: 0.22, createdAt: "2026-09-15", failureReason: "The scan was too dark to read. Ask for a photo taken in daylight." },
    { id: "doc-5", orgId: "org-elite", fileName: "petrakis-transcript.pdf", category: "transcript", sourceRole: "coordinator", status: "pending", route: "review", athleteId: null, confidence: 0.71, createdAt: "2026-09-13", candidates: [{ athleteId: "ath-5", name: "Jonah Petrakis", score: 0.82 }] },
  ],

  donors: [
    { id: "dn-1", orgId: "org-bridge", name: "Hallowell Family Fund", donor_type: "foundation", email: "giving@example.org" },
    { id: "dn-2", orgId: "org-bridge", name: "Priya Raman", donor_type: "board_member", email: "praman@example.com" },
    { id: "dn-3", orgId: "org-bridge", name: "Castlebrook Partners", donor_type: "corporate", email: "community@example.com" },
    { id: "dn-4", orgId: "org-bridge", name: "Owen Strand", donor_type: "board_member", email: "ostrand@example.com" },
    { id: "dn-5", orgId: "org-bridge", name: "Marisol Vega", donor_type: "individual", email: "mvega@example.com" },
    { id: "dn-6", orgId: "org-bridge", name: "Deacon Tyre", donor_type: "board_member", email: "dtyre@example.com" },
  ],

  campaigns: [
    { id: "cm-1", orgId: "org-bridge", name: "Bridge Invitational", kind: "event", goalCents: 2500000, endsOn: "2026-08-13" },
    { id: "cm-2", orgId: "org-bridge", name: "Year-end appeal", kind: "appeal", goalCents: 3000000, endsOn: "2026-12-31" },
  ],

  gifts: [
    { id: "gf-1", orgId: "org-bridge", amountCents: 500000, receivedOn: "2026-02-14", category: "board", method: "check", donorId: "dn-2", campaignId: null, pledgeId: null, solicitedBy: null },
    { id: "gf-2", orgId: "org-bridge", amountCents: 250000, receivedOn: "2026-03-02", category: "individual", method: "stripe", donorId: "dn-5", campaignId: null, pledgeId: null, solicitedBy: "bm-2" },
    { id: "gf-3", orgId: "org-bridge", amountCents: 1000000, receivedOn: "2026-04-19", category: "corporate", method: "check", donorId: "dn-3", campaignId: null, pledgeId: null, solicitedBy: "bm-1" },
    { id: "gf-4", orgId: "org-bridge", amountCents: 1875000, receivedOn: "2026-08-13", category: "special_event", method: "stripe", donorId: null, campaignId: "cm-1", pledgeId: null, solicitedBy: null },
    { id: "gf-5", orgId: "org-bridge", amountCents: 400000, receivedOn: "2026-08-13", category: "special_event", method: "stripe", donorId: "dn-1", campaignId: "cm-1", pledgeId: null, solicitedBy: "bm-3" },
    { id: "gf-6", orgId: "org-bridge", amountCents: 68500, receivedOn: "2026-08-13", category: "special_event", method: "in_kind", donorId: "dn-3", campaignId: "cm-1", pledgeId: null, solicitedBy: null },
    { id: "gf-7", orgId: "org-bridge", amountCents: 300000, receivedOn: "2026-06-01", category: "board", method: "check", donorId: "dn-4", campaignId: null, pledgeId: "pl-1", solicitedBy: null },
    { id: "gf-8", orgId: "org-bridge", amountCents: 150000, receivedOn: "2026-09-02", category: "individual", method: "stripe", donorId: "dn-5", campaignId: "cm-2", pledgeId: null, solicitedBy: "bm-2" },
    { id: "gf-9", orgId: "org-bridge", amountCents: 75000, receivedOn: "2026-09-05", category: "individual", method: "cash", donorId: null, campaignId: "cm-2", pledgeId: null, solicitedBy: null },
  ],

  pledges: [
    { id: "pl-1", orgId: "org-bridge", amountCents: 1000000, promisedOn: "2026-01-15", dueOn: "2026-12-31", status: "open", donorId: "dn-4", campaignId: null, solicitedBy: null },
    { id: "pl-2", orgId: "org-bridge", amountCents: 500000, promisedOn: "2026-02-01", dueOn: "2026-06-30", status: "open", donorId: "dn-1", campaignId: "cm-2", solicitedBy: "bm-3" },
    { id: "pl-3", orgId: "org-bridge", amountCents: 250000, promisedOn: "2026-03-10", dueOn: null, status: "open", donorId: "dn-6", campaignId: null, solicitedBy: null },
  ],

  budget: [
    { fiscalYear: 2026, category: "individual", amountCents: 6000000 },
    { fiscalYear: 2026, category: "board", amountCents: 3000000 },
    { fiscalYear: 2026, category: "corporate", amountCents: 4500000 },
    { fiscalYear: 2026, category: "special_event", amountCents: 2500000 },
    { fiscalYear: 2026, category: "grant", amountCents: 2500000 },
  ],

  grants: [
    { id: "gr-1", orgId: "org-bridge", funderName: "Stamford Community Trust", status: "applied", amountRequested: 2500000, amountAwarded: null, deadlineOn: "2026-08-01", appliedOn: "2026-07-28", decisionExpectedOn: "2026-10-15", reportDueOn: null },
    { id: "gr-2", orgId: "org-bridge", funderName: "Nutmeg Youth Foundation", status: "researching", amountRequested: 1500000, amountAwarded: null, deadlineOn: "2026-11-01", appliedOn: null, decisionExpectedOn: null, reportDueOn: null },
  ],

  boards: [
    { id: "bd-1", orgId: "org-bridge", name: "Executive Board", kind: "executive", sport: null, giveGetCents: 1000000, minSeats: 1, maxSeats: 15 },
    { id: "bd-2", orgId: "org-bridge", name: "General Board", kind: "general", sport: null, giveGetCents: 500000, minSeats: 1, maxSeats: 30 },
    { id: "bd-3", orgId: "org-bridge", name: "Baseball Board", kind: "sport", sport: "baseball", giveGetCents: 500000, minSeats: 3, maxSeats: 5 },
    { id: "bd-4", orgId: "org-bridge", name: "Development Board", kind: "development", sport: null, giveGetCents: 100000, minSeats: 1, maxSeats: 30 },
  ],

  boardMembers: [
    { id: "bm-1", orgId: "org-bridge", boardId: "bd-1", name: "Priya Raman", donorId: "dn-2", roleTitle: "Chair", status: "active", termStart: "2025-01-01", termEnd: "2027-12-31", commitmentCents: 1000000 },
    { id: "bm-2", orgId: "org-bridge", boardId: "bd-1", name: "Owen Strand", donorId: "dn-4", roleTitle: "Treasurer", status: "active", termStart: "2025-01-01", termEnd: "2027-12-31", commitmentCents: 1000000 },
    { id: "bm-3", orgId: "org-bridge", boardId: "bd-1", name: "Deacon Tyre", donorId: "dn-6", roleTitle: "Vice Chair", status: "active", termStart: "2026-01-01", termEnd: "2028-12-31", commitmentCents: 1000000 },
    { id: "bm-4", orgId: "org-bridge", boardId: "bd-3", name: "Renata Coyle", donorId: null, roleTitle: "Sport Director", status: "active", termStart: "2026-01-01", termEnd: null, commitmentCents: 500000 },
    { id: "bm-5", orgId: "org-bridge", boardId: "bd-3", name: "Hollis Bree", donorId: null, roleTitle: "Board Chair", status: "active", termStart: "2026-03-01", termEnd: null, commitmentCents: 500000 },
    { id: "bm-6", orgId: "org-bridge", boardId: "bd-3", name: "Jules Anfield", donorId: null, roleTitle: "Recruiting Lead", status: "prospect", termStart: null, termEnd: null, commitmentCents: 500000 },
    { id: "bm-7", orgId: "org-bridge", boardId: "bd-2", name: "Marisol Vega", donorId: "dn-5", roleTitle: null, status: "active", termStart: "2026-01-01", termEnd: null, commitmentCents: 500000 },
    { id: "bm-8", orgId: "org-bridge", boardId: "bd-4", name: "Tam Oyelaran", donorId: null, roleTitle: null, status: "active", termStart: "2026-01-01", termEnd: null, commitmentCents: 100000 },
  ],

  // The contact log behind each target's message count. Every coach and
  // every line of it is invented.
  communications: [
    { id: "cm1", targetId: "tg-1", kind: "email", direction: "in", at: "2026-09-10", summary: "Wants updated velo before the October visit" },
    { id: "cm2", targetId: "tg-1", kind: "call", direction: "out", at: "2026-09-02", summary: "Walked through the 35 percent athletic offer" },
    { id: "cm3", targetId: "tg-1", kind: "visit", direction: "out", at: "2026-08-19", summary: "Unofficial visit, met the pitching staff" },
    { id: "cm4", targetId: "tg-1", kind: "email", direction: "out", at: "2026-07-30", summary: "Sent summer showcase schedule" },
    { id: "cm5", targetId: "tg-1", kind: "email", direction: "in", at: "2026-06-11", summary: "Asked for a transcript through junior year" },
    { id: "cm6", targetId: "tg-1", kind: "camp", direction: "out", at: "2026-05-24", summary: "Attended the prospect camp on campus" },
    { id: "cm7", targetId: "tg-2", kind: "email", direction: "out", at: "2026-08-02", summary: "Introduction and highlight link" },
    { id: "cm8", targetId: "tg-2", kind: "email", direction: "in", at: "2026-08-09", summary: "Acknowledged, no roster need until next cycle" },
    { id: "cm9", targetId: "tg-3", kind: "visit", direction: "out", at: "2026-09-12", summary: "Official visit scheduled for the 27th" },
    { id: "cm10", targetId: "tg-3", kind: "call", direction: "in", at: "2026-09-04", summary: "Coach asked about the second AP science course" },
    { id: "cm11", targetId: "tg-3", kind: "email", direction: "out", at: "2026-08-15", summary: "Sent fall schedule and academic update" },
    { id: "cm12", targetId: "tg-3", kind: "text", direction: "in", at: "2026-07-28", summary: "Quick check in after the summer tournament" },
    { id: "cm13", targetId: "tg-5", kind: "call", direction: "out", at: "2026-09-14", summary: "Verbal commitment confirmed" },
    { id: "cm14", targetId: "tg-5", kind: "email", direction: "in", at: "2026-09-08", summary: "Academic award letter attached" },
    { id: "cm15", targetId: "tg-5", kind: "visit", direction: "out", at: "2026-08-22", summary: "Second visit with family" },
    { id: "cm16", targetId: "tg-6", kind: "email", direction: "out", at: "2026-07-21", summary: "Sent transfer portal timeline questions" },
    { id: "cm17", targetId: "tg-7", kind: "call", direction: "in", at: "2026-09-11", summary: "Offer extended, decision by November" },
    { id: "cm18", targetId: "tg-8", kind: "email", direction: "out", at: "2026-05-30", summary: "First contact, no reply yet" },
  ],
};
