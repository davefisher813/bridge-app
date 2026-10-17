import { describe, expect, it } from "vitest";
import { greetingFor } from "./greeting";

describe("the Today greeting follows the hour (live test V1)", () => {
  it("morning, afternoon and evening", () => {
    expect(greetingFor(8)).toBe("Good morning");
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(16)).toBe("Good afternoon");
    expect(greetingFor(20)).toBe("Good evening");
    expect(greetingFor(2)).toBe("Good evening");
    expect(greetingFor(5)).toBe("Good morning");
  });
});
