import { randomBytes } from "node:crypto";

// The stand-in model decides how well a document reads from the file's
// name and its size (src/lib/docai/stubCaller.ts): under 0.15 unreadable,
// under 0.45 marginal, above that clean. A test picks the outcome it wants
// by picking the file. The seed is recomputed here and checked, so if the
// stand-in's rule ever changes the tests say so instead of failing in a
// way that looks like a bug in the app.
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

// Every file is exactly this long, whatever its random part, so the name
// alone fixes the outcome. (8 hex characters of randomness keep two
// uploads from being the same bytes.)
function pdfBytes(): Buffer {
  return Buffer.from(`%PDF-1.4\n%${randomBytes(4).toString("hex")}\n1 0 obj << >> endobj\n%%EOF\n`);
}

export interface TestFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

function file(name: string, band: "clean" | "unreadable"): TestFile {
  const buffer = pdfBytes();
  const seed = seedOf(`${name}:${buffer.length}`);
  const ok = band === "clean" ? seed >= 0.45 : seed < 0.15;
  if (!ok) throw new Error(`${name} at ${buffer.length} bytes seeds ${seed}, which is not ${band}. The stand-in's rule changed: pick another name in e2e/support/files.ts.`);
  return { name, mimeType: "application/pdf", buffer };
}

// Reads cleanly (0.9151 at 46 bytes). From a parent it goes to review
// rather than straight onto the athlete, which is the flow under test.
export const readableTranscript = () => file("fall-transcript.pdf", "clean");

// Reads as too blurry to use (0.0025 at 46 bytes).
export const unreadableScan = () => file("scan-2.pdf", "unreadable");
