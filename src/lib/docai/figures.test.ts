import { describe, expect, it } from "vitest";
import { figureText, isMoney } from "./figures";

describe("figures: only money gets a dollar sign (live test D1)", () => {
  it("keeps the dollar sign and separators on money", () => {
    expect(figureText(10000, "pledge")).toBe("$10,000 pledge");
    expect(figureText(2500, "annual membership fee")).toBe("$2,500 annual membership fee");
    expect(figureText(500, null)).toBe("$500");
  });
  it("leaves measures, years and counts plain", () => {
    expect(figureText(4, "GPA (unweighted)")).toBe("4 GPA (unweighted)");
    expect(figureText(2026, "Graduation year")).toBe("2026 Graduation year");
    expect(figureText(170, "Weight")).toBe("170 Weight");
    expect(figureText(7, "60-yard dash")).toBe("7 60-yard dash");
    expect(figureText(100, "Exit velocity (mph)")).toBe("100 Exit velocity (mph)");
    expect(figureText(3, "Minimum GPA required")).toBe("3 Minimum GPA required");
    expect(figureText(3.75, "Weighted GPA")).toBe("3.75 Weighted GPA");
  });
  it("isMoney", () => {
    expect(isMoney("scholarship award")).toBe(true);
    expect(isMoney("Class of 2027")).toBe(false);
  });
});
