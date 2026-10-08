import { describe, expect, it } from "vitest";
import { confidenceLabel, suggestIdentity, suggestType, wordsOf, type RosterEntry } from "./suggest";

// Synthetic roster. Names only; no real athletes.
const ROSTER: RosterEntry[] = [
  { id: "a1", name: "Jordan Alvarez", emails: ["parent.alvarez@example.test"], school: "Central High", gradYear: 2027 },
  { id: "a2", name: "Marcus Branche" },
  { id: "a3", name: "Devin Branche" },
  { id: "a4", name: "Ian Cole" },
  { id: "a5", name: "Luis De Los Santos" },
  { id: "a6", name: "Sam Ortega" },
  { id: "a7", name: "Sam Ortega" },
  { id: "a8", name: "Tyler Okafor-Reed" },
];

describe("suggestIdentity", () => {
  it("proposes the athlete whose full name is in the file name", () => {
    const s = suggestIdentity({ fileName: "Jordan_Alvarez.pdf", roster: ROSTER });
    expect(s.status).toBe("proposed");
    expect(s.candidates[0]).toMatchObject({ athleteId: "a1", school: "Central High", gradYear: 2027, reasons: ["Name in the file name"] });
  });

  it("reads Lastname_Firstname and camelCase file names", () => {
    expect(suggestIdentity({ fileName: "alvarez_jordan_transcript.pdf", roster: ROSTER }).candidates[0]?.athleteId).toBe("a1");
    expect(suggestIdentity({ fileName: "JordanAlvarez2026.xlsx", roster: ROSTER }).candidates[0]?.athleteId).toBe("a1");
  });

  it("never treats a surname alone as anybody: two brothers share it", () => {
    const s = suggestIdentity({ fileName: "Branche transcript.pdf", roster: ROSTER });
    expect(s).toEqual({ status: "unmatched", candidates: [] });
  });

  it("names the right brother when the given name is there", () => {
    const s = suggestIdentity({ fileName: "Devin Branche - SAT.pdf", roster: ROSTER });
    expect(s.status).toBe("proposed");
    expect(s.candidates.map((c) => c.athleteId)).toEqual(["a3"]);
  });

  it("calls two athletes with the same name ambiguous instead of picking one", () => {
    const s = suggestIdentity({ fileName: "Sam Ortega offer.pdf", roster: ROSTER });
    expect(s.status).toBe("ambiguous");
    expect(s.candidates.map((c) => c.athleteId).sort()).toEqual(["a6", "a7"]);
  });

  it("forgives one typo in a long name part, never in a short one", () => {
    expect(suggestIdentity({ fileName: "jordan alvares.pdf", roster: ROSTER }).candidates[0]?.athleteId).toBe("a1");
    expect(suggestIdentity({ fileName: "Jan Cole.pdf", roster: ROSTER }).status).toBe("unmatched");
  });

  it("handles a several-word family name and a hyphenated one", () => {
    expect(suggestIdentity({ fileName: "Luis_Santos_profile.docx", roster: ROSTER }).candidates[0]?.athleteId).toBe("a5");
    expect(suggestIdentity({ fileName: "tyler okafor reed.pdf", roster: ROSTER }).candidates[0]?.athleteId).toBe("a8");
  });

  it("weighs an exact family email above a name", () => {
    const s = suggestIdentity({ fileName: "form.csv", textSample: "Parent: parent.alvarez@example.test", roster: ROSTER });
    expect(s.candidates[0]).toMatchObject({ athleteId: "a1", score: 0.95, reasons: ["A family email in the file"] });
  });

  it("takes the app's own athlete id in the file as strong evidence", () => {
    const roster = [{ id: "3f2a9c1e-0000-4000-8000-00000000abcd", name: "Kai Moreno" }];
    const s = suggestIdentity({ fileName: "export.csv", textSample: "athlete_id,3F2A9C1E-0000-4000-8000-00000000ABCD", roster });
    expect(s.candidates[0]).toMatchObject({ score: 0.95, reasons: ["Their Bridge ID in the file"] });
  });

  it("never scores a school or a class year on its own", () => {
    expect(suggestIdentity({ fileName: "Central High 2027.pdf", roster: ROSTER }).status).toBe("unmatched");
  });

  it("scores a name in both the file name and the file above either alone", () => {
    const both = suggestIdentity({ fileName: "Ian Cole.docx", textSample: "Student: Ian Cole", roster: ROSTER }).candidates[0]!;
    const one = suggestIdentity({ fileName: "Ian Cole.docx", roster: ROSTER }).candidates[0]!;
    expect(both.score).toBeGreaterThan(one.score);
  });

  it("never claims certainty: the ceiling is below 1", () => {
    const s = suggestIdentity({ fileName: "Jordan Alvarez.txt", textSample: "Jordan Alvarez parent.alvarez@example.test", roster: ROSTER });
    expect(s.candidates[0]!.score).toBeLessThan(1);
  });

  it("finds nobody on an empty roster", () => {
    expect(suggestIdentity({ fileName: "Jordan_Alvarez.pdf", roster: [] }).status).toBe("unmatched");
  });
});

describe("suggestType", () => {
  it("reads the file name", () => {
    expect(suggestType({ fileName: "Alvarez_Transcript.pdf", format: "pdf" }).type).toBe("transcript");
    expect(suggestType({ fileName: "NCAA Registration Guide.pdf", format: "pdf" }).type).toBe("eligibility_guidance");
    expect(suggestType({ fileName: "SAT_scores.pdf", format: "pdf" }).type).toBe("test_score_report");
    expect(suggestType({ fileName: "College List.docx", format: "word" }).type).toBe("school_list");
  });

  it("leans a spreadsheet toward a tracker", () => {
    const s = suggestType({ fileName: "Recruiting Assignment Tracker.xlsx", format: "excel" });
    expect(s.type).toBe("assignment_tracker");
    expect(s.reasons).toContain("A spreadsheet");
  });

  it("reads phrases and long words inside a file, not short common words", () => {
    expect(suggestType({ fileName: "notes.txt", format: "txt", textSample: "I sat down to act on this." }).type).toBe("other");
    expect(suggestType({ fileName: "notes.txt", format: "txt", textSample: "Your SAT score report is attached" }).type).toBe("test_score_report");
  });

  it("takes the type picked at upload as strong evidence", () => {
    const s = suggestType({ fileName: "scan001.jpg", format: "jpg", pickedType: "transcript" });
    expect(s).toMatchObject({ type: "transcript", reasons: ["Picked at upload"] });
  });

  it("says Other with no confidence when nothing points anywhere", () => {
    expect(suggestType({ fileName: "IMG_4471.png", format: "png" })).toEqual({ type: "other", confidence: 0, reasons: ["Nothing in the name or the words points at a type"] });
  });

  it("says out loud when a second type is close", () => {
    const s = suggestType({ fileName: "transcript and SAT.pdf", format: "pdf" });
    expect(s.reasons.some((r) => r.startsWith("Could also be"))).toBe(true);
  });

  it("caps confidence below certainty", () => {
    const s = suggestType({ fileName: "official transcript.pdf", format: "pdf", pickedType: "transcript", textSample: "Official Transcript cumulative GPA" });
    expect(s.confidence).toBeLessThanOrEqual(0.95);
  });
});

describe("helpers", () => {
  it("splits words the way file names are written", () => {
    expect(wordsOf("JordanAlvarez_SAT-2026.pdf")).toEqual(["jordan", "alvarez", "sat", "2026", "pdf"]);
  });

  it("labels confidence in three words", () => {
    expect([confidenceLabel(0.9), confidenceLabel(0.7), confidenceLabel(0.5)]).toEqual(["High", "Medium", "Low"]);
  });
});
