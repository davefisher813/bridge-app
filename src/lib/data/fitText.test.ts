import { describe, expect, it } from "vitest";
import { tidyFitRow, tidyFitText, type FitRow } from "./fits";

describe("stored fit text is tidied as it is read", () => {
  it("drops the D3 scholarship reason and the D3 no-data line, shortens the rest", () => {
    expect(
      tidyFitText([
        "D3 school: athletic scholarships are not allowed by NCAA rules (unrelated to the House settlement)",
        "No cost or aid data for this D3 school",
        "Scored on financial only: no academic or athletic data yet",
        "No GPA on file: enter GPA for an accurate academic fit",
        "No measurables on file: enter stats for an accurate athletic fit",
        "Merit aid here averages $8,400",
      ]),
    ).toEqual(["No academic or athletic data", "No GPA on file", "No measurables on file", "Merit aid here averages $8,400"]);
  });
  it("cleans the fit's own lines and every dimension's", () => {
    const row = {
      reasons: ["D3 school: athletic scholarships are not allowed by NCAA rules (unrelated to the House settlement)"],
      warnings: ["Scored on academic only: no athletic or financial data yet"],
      dimensions: { academic: { score: 50, warnings: ["No GPA on file: enter GPA for an accurate academic fit"], reasons: [] }, counted: ["academic"] },
    } as unknown as FitRow;
    const t = tidyFitRow(row);
    expect(t.reasons).toEqual([]);
    expect(t.warnings).toEqual(["No athletic or financial data"]);
    expect((t.dimensions.academic as { warnings: string[] }).warnings).toEqual(["No GPA on file"]);
    expect(t.dimensions.counted).toEqual(["academic"]);
  });
});
