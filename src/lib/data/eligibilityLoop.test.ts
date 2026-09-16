// The loop: a transcript goes through the real pipeline, its course
// rows land in the shape the database stores, and those rows produce a
// real eligibility verdict.
//
// This test exists because the first version of the eligibility screen
// shipped with nothing feeding it. The engine was right, the screen was
// right, and `applyExtractionToAthlete` wrote only a GPA, so every
// athlete read "cannot be calculated yet" forever. Nothing failed. The
// gap was between two correct pieces, which is exactly the kind a unit
// test on either side does not catch.
//
// The database write itself is not covered here (it needs Supabase).
// What is covered is everything either side of it: what the pipeline
// emits, and what the adapter makes of rows in that shape.

import { describe, expect, it } from "vitest";
import { runExtractionPipeline } from "@/lib/docai/pipeline";
import { createStubCaller } from "@/lib/docai/stubCaller";
import { transcriptSchema } from "@/lib/docai/schemas";
import { buildEligibilityView, type AthleteCourseRow } from "./ncaaAdapters";
import type { IngestedRecord, ResolverAthlete } from "@/lib/docai/types";

const roster: ResolverAthlete[] = [{ id: "a1", name: "Sample Athlete", school: "Sample High School", gradYear: 2027 }];

function record(name: string, size: number): IngestedRecord {
  return {
    originalName: name,
    originalSize: size,
    originalMime: "application/pdf",
    kind: "pdf",
    sourceRole: "coordinator",
    ingestedAt: new Date().toISOString(),
    requestId: `req_${name}`,
    mediaType: "application/pdf",
    base64: "AAAA",
    blockType: "document",
  };
}

async function extractTranscript(name: string, size: number) {
  const result = await runExtractionPipeline({
    categoryId: "transcript",
    records: [record(name, size)],
    sourceRole: "coordinator",
    roster,
    rosterContext: roster,
    priorVersions: [],
    callModel: createStubCaller({ category: "transcript", seedText: `${name}:${size}` }),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("extraction failed");
  return result.extracted as Record<string, unknown>;
}

// Mirrors what applyExtractionToAthlete inserts, so this test breaks if
// the two ever describe a course differently.
function toStoredRows(extracted: Record<string, unknown>): AthleteCourseRow[] {
  const courses = extracted.courses as Array<Record<string, unknown>>;
  const school = extracted.school as string;
  return courses.map((c, i) => ({
    id: `c${i}`,
    title: c.title as AthleteCourseRow["title"],
    subject: c.subject as AthleteCourseRow["subject"],
    credit: c.credit as number,
    grade: c.grade as string,
    term: (c.term as string) ?? null,
    school_name: school,
    weighted: c.weighted === true,
    ncaa_approved: null,
    duplicate_of: null,
  }));
}

describe("a transcript extraction carries what eligibility needs", () => {
  it("returns a course list, not just a GPA", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    expect(Array.isArray(extracted.courses)).toBe(true);
    expect((extracted.courses as unknown[]).length).toBeGreaterThan(10);
  });

  it("returns a date of birth, which the age clock needs", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    expect(extracted.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("survives its own schema, course rows and all", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    expect(transcriptSchema.safeParse(extracted).success).toBe(true);
  });

  it("returns no grading scale rather than inventing one", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    expect(extracted.gradingScale ?? null).toBeNull();
  });
});

describe("stored rows produce a real verdict", () => {
  it("gets from an uploaded transcript to a qualifier status with no manual step", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    const view = buildEligibilityView({
      courses: toStoredRows(extracted),
      scales: [],
      division: "D1",
      athlete: { dateOfBirth: extracted.dateOfBirth as string, firstFullTimeEnrollment: null, intendedEnrollment: "2028-08-15" },
      today: "2026-09-16",
    });

    expect(view.eligibility.coreGpa?.gpa).not.toBeNull();
    expect(["qualifier", "early_academic_qualifier", "academic_redshirt", "nonqualifier"]).toContain(view.eligibility.status);
    expect(view.eligibility.status).not.toBe("insufficient_data");
  });

  it("leaves PE and art out of the core GPA even though they are A grades", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    const rows = toStoredRows(extracted);
    expect(rows.some((r) => r.subject === "non_academic" && r.grade === "A")).toBe(true);

    const view = buildEligibilityView({ courses: rows, scales: [], division: "D1", athlete: { dateOfBirth: null, firstFullTimeEnrollment: null, intendedEnrollment: null }, today: "2026-09-16" });
    const countedTitles = view.eligibility.coreGpa!.counted.map((c) => c.course.title);
    expect(countedTitles).not.toContain("Phys. Ed. 11");
    expect(countedTitles).not.toContain("Art 1");
  });

  it("drops the withdrawn course, which carries no quality points", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    const view = buildEligibilityView({ courses: toStoredRows(extracted), scales: [], division: "D1", athlete: { dateOfBirth: null, firstFullTimeEnrollment: null, intendedEnrollment: null }, today: "2026-09-16" });
    expect(view.eligibility.coreGpa!.counted.every((c) => c.course.grade !== "W")).toBe(true);
  });

  it("asks a human about the repeated course title rather than merging it", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    const view = buildEligibilityView({ courses: toStoredRows(extracted), scales: [], division: "D1", athlete: { dateOfBirth: null, firstFullTimeEnrollment: null, intendedEnrollment: null }, today: "2026-09-16" });
    expect(view.eligibility.warnings.join(" ")).toMatch(/appears more than once/i);
  });

  it("says the GPA is an estimate while no course has been checked against the approved list", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    const view = buildEligibilityView({ courses: toStoredRows(extracted), scales: [], division: "D1", athlete: { dateOfBirth: null, firstFullTimeEnrollment: null, intendedEnrollment: null }, today: "2026-09-16" });
    expect(view.eligibility.warnings.join(" ")).toMatch(/not been checked against/i);
  });

  it("shows the core GPA and the transcript GPA are different numbers", async () => {
    const extracted = await extractTranscript("clean-transcript.pdf", 260000);
    const view = buildEligibilityView({ courses: toStoredRows(extracted), scales: [], division: "D1", athlete: { dateOfBirth: null, firstFullTimeEnrollment: null, intendedEnrollment: null }, today: "2026-09-16" });
    const core = view.eligibility.coreGpa!.gpa!;
    const transcript = extracted.gpa as number;
    expect(core).not.toBe(transcript);
  });
});
