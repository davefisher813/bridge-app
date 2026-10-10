import { describe, expect, it } from "vitest";
import { documentTypeLabel, isFileType } from "@/lib/documents/fileTypes";

const READER = { transcript: "Transcript", test_scores: "Test Scores" };

describe("documentTypeLabel", () => {
  it("prefers the reader's settled type", () => {
    expect(documentTypeLabel({ category: "test_scores", requested_category: "transcript" }, READER)).toBe("Test Scores");
  });
  it("falls back to the type it was uploaded as, so Transcript sticks when the reader could not read it", () => {
    expect(documentTypeLabel({ category: null, requested_category: "transcript" }, READER)).toBe("Transcript");
  });
  it("shows a file-only type", () => {
    expect(documentTypeLabel({ filed_as: "board_document" }, READER)).toBe("Board Document");
    expect(documentTypeLabel({ filed_as: "athlete_profile" }, READER)).toBe("Athlete Profile");
  });
  it("is null with no type at all, and ignores a value it does not know", () => {
    expect(documentTypeLabel({}, READER)).toBeNull();
    expect(documentTypeLabel({ filed_as: "bylaws" }, READER)).toBeNull();
    expect(isFileType("board_document")).toBe(true);
    expect(isFileType("transcript")).toBe(false);
  });
});
