import { describe, expect, it } from "vitest";
import { assignmentStackKey, stackAssignments } from "./assignmentStack";

const pdf = "application/pdf";
const xl = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("assignment stacks", () => {
  it("the three name styles of one athlete's PDFs share a key", () => {
    const keys = ["bridge-assignments-johan-diaz.pdf", "assignment-2-johan-diaz.pdf", "Johan Diaz - Assignment 2.pdf"].map((n) => assignmentStackKey(n, pdf)!.key);
    expect(new Set(keys).size).toBe(1);
  });
  it("spreadsheets stack apart from PDFs, and the download prefix is ignored", () => {
    const a = assignmentStackKey("browser-download-20261009T014604.188895757Z-19-Johan_Diaz_-_Bridge_Assignments.xlsx", xl)!.key;
    const b = assignmentStackKey("Johan Diaz - Bridge Assignments.xlsx", xl)!.key;
    expect(a).toBe(b);
    expect(a).not.toBe(assignmentStackKey("assignment-2-johan-diaz.pdf", pdf)!.key);
  });
  it("another athlete never joins, and a file that is not an assignment is left alone", () => {
    expect(assignmentStackKey("assignment-2-maya-lopez.pdf", pdf)!.key).not.toBe(assignmentStackKey("assignment-2-johan-diaz.pdf", pdf)!.key);
    expect(assignmentStackKey("transcript-johan-diaz.pdf", pdf)).toBeNull();
  });
  it("the row that needs attention leads and the rest hide behind it", () => {
    const mk = (id: string, file_name: string, lifecycle: string) => ({ id, file_name, media_type: pdf, lifecycle, created_at: "2026-10-01T00:00:00Z" });
    const { hidden, behind } = stackAssignments([mk("a", "assignment-2-johan-diaz.pdf", "archived"), mk("r", "bridge-assignments-johan-diaz.pdf", "ready"), mk("x", "Johan Diaz - Assignment 2.pdf", "archived")]);
    expect([...behind.keys()]).toEqual(["r"]);
    expect(behind.get("r")!.others).toHaveLength(2);
    expect(hidden.has("a") && hidden.has("x") && !hidden.has("r")).toBe(true);
  });
});
