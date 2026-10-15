import { describe, expect, it } from "vitest";
import { hasDeveloperTalk, plainLines, plainText } from "./plainLanguage";

describe("plain language for extraction text (Alfred, 2026-10-15)", () => {
  it("drops a sentence that talks about a field or a column", () => {
    expect(plainText("A recruiting tracker with 40 rows. The ADVISOR column is blank, so studentName is null. Updated in March.")).toBe("A recruiting tracker with 40 rows. Updated in March.");
    expect(plainText("Nothing is null here.")).toBe("");
  });

  it("leaves ordinary sentences and names alone", () => {
    const text = "Letter for DeShawn McDonald from his coach. It praises his work ethic.";
    expect(hasDeveloperTalk(text)).toBe(false);
    expect(plainText(text)).toBe(text);
  });

  it("catches field names in camel and snake case, null, JSON and schema", () => {
    for (const t of ["studentName is missing.", "recommender_org was empty.", "Returned null.", "The JSON had no school.", "Does not match the schema."]) expect(hasDeveloperTalk(t), t).toBe(true);
  });

  it("plainLines drops the lines that are only field talk", () => {
    expect(plainLines(["Hard to read the GPA.", "studentName is null.", "The page is cut off. The column is blank."])).toEqual(["Hard to read the GPA.", "The page is cut off."]);
  });
});
