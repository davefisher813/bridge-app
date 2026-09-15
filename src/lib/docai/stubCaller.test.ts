import { describe, expect, it } from "vitest";
import { createStubCaller } from "./stubCaller";
import { runExtractionPipeline } from "./pipeline";
import type { IngestedRecord, ResolverAthlete } from "./types";

// The stub exists so the upload screen can be used before an API key
// does. That claim is only worth anything if the stub actually drives the
// pipeline through every outcome a real model would, so this checks that
// rather than checking the stub's own return values.

function recordFor(name: string, size: number): IngestedRecord {
  return {
    originalName: name,
    originalSize: size,
    originalMime: "application/pdf",
    kind: "pdf",
    sourceRole: "coordinator",
    ingestedAt: new Date().toISOString(),
    requestId: "req_stub",
    mediaType: "application/pdf",
    base64: "JVBERi0=",
    blockType: "document",
  };
}

const ROSTER: ResolverAthlete[] = [
  { id: "a1", name: "Sample Athlete", school: "Sample High School", gradYear: 2027 },
];

async function routeFor(name: string, size: number, sourceRole: "coordinator" | "parent" = "coordinator") {
  const records = [recordFor(name, size)];
  const result = await runExtractionPipeline({
    categoryId: "transcript",
    records,
    sourceRole,
    roster: ROSTER,
    rosterContext: ROSTER,
    priorVersions: [],
    callModel: createStubCaller({ category: "transcript", seedText: `${name}:${size}` }),
  });
  return result.ok ? result.route : `failed:${result.stage}`;
}

describe("the stub caller drives the real pipeline", () => {
  it("is deterministic: the same file always lands the same way", async () => {
    const first = await routeFor("transcript.pdf", 12345);
    const second = await routeFor("transcript.pdf", 12345);
    expect(second).toBe(first);
  });

  it("produces every outcome across a spread of files, not just one", async () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 120; i++) {
      outcomes.add(await routeFor(`scan-${i}.pdf`, 10000 + i * 137));
    }
    // A stub that only ever returned "auto_apply" would make the review
    // and refusal screens unreachable, which is most of the flow.
    expect(outcomes.has("auto_apply")).toBe(true);
    expect(outcomes.has("review")).toBe(true);
    expect(outcomes.has("failed:triage_retake")).toBe(true);
  });

  it("weights the source the way the real pipeline does", async () => {
    // Same file, different sender. A parent-supplied scan is trusted less
    // (see provenance.ts), so it can never route higher than the same
    // document uploaded by a coordinator.
    const rank = { reject: 0, review: 1, auto_apply: 2 } as Record<string, number>;
    let comparisons = 0;
    for (let i = 0; i < 40; i++) {
      const name = `weighted-${i}.pdf`;
      const mine = await routeFor(name, 20000 + i * 91, "coordinator");
      const theirs = await routeFor(name, 20000 + i * 91, "parent");
      if (mine.startsWith("failed") || theirs.startsWith("failed")) continue;
      comparisons++;
      expect(rank[theirs]).toBeLessThanOrEqual(rank[mine]!);
    }
    expect(comparisons).toBeGreaterThan(0);
  });
});
