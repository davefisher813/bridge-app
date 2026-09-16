// What the server will accept, decided from the bytes that actually
// arrived rather than from what the client said about them.
//
// The gap this closes, recorded in docs/ROADMAP.md on 2026-09-16: the
// size cap, the type sniffing and the HEIC refusal all lived in
// src/lib/docai/ingest.ts, which runs in the BROWSER. A direct call to
// the server action skipped every one of them, so the only thing
// standing between a 400MB file, or an executable relabelled as a PDF,
// and the pipeline was a client the caller controls.
//
// Pure on purpose, like the rest of this directory: it takes the record
// plus the decoded header and true byte length, and the caller does the
// decoding. That keeps it testable without a browser and runnable in the
// test bench alongside everything else here.

import { sniffKind, type SniffedKind } from "./magicBytes";
import { MAX_INGEST_BYTES } from "./limits";

export interface AcceptanceInput {
  // What the client claimed.
  originalName: string;
  originalSize: number;
  mediaType: string;
  kind: string;
  base64Length: number;
  // What actually arrived.
  byteLength: number;
  header: Uint8Array;
}

export interface AcceptanceResult {
  ok: boolean;
  // Shown to whoever uploaded it, so it says what to do rather than
  // just refusing.
  reason?: string;
  // The format the bytes really are, regardless of the name or the
  // reported MIME type.
  sniffed: SniffedKind;
}

// One upload at a time is a document with pages, not a batch. A cap
// exists so a single request cannot queue unbounded pipeline work.
export const MAX_RECORDS_PER_UPLOAD = 12;

// Formats the pipeline can actually read. HEIC is deliberately not here:
// no server-side decoder is wired up, and Claude's vision input does not
// take it, so accepting one would mean storing a file that can never be
// processed.
const ACCEPTED: SniffedKind[] = ["pdf", "jpeg", "png", "gif", "webp"];

export function checkIngestedRecord(input: AcceptanceInput): AcceptanceResult {
  const sniffed = sniffKind(input.header);

  if (input.byteLength <= 0) {
    return { ok: false, sniffed, reason: `${input.originalName} arrived empty.` };
  }

  // Measured, not reported. originalSize comes from the client and a
  // client that lies about it is exactly the case this function exists
  // for.
  if (input.byteLength > MAX_INGEST_BYTES) {
    const mb = (input.byteLength / 1024 / 1024).toFixed(1);
    const max = (MAX_INGEST_BYTES / 1024 / 1024).toFixed(0);
    return { ok: false, sniffed, reason: `${input.originalName} is ${mb}MB, over the ${max}MB limit.` };
  }

  if (sniffed === "heic") {
    return {
      ok: false,
      sniffed,
      reason: `${input.originalName} is a HEIC photo, which cannot be read directly. Ask for a JPEG or PNG instead.`,
    };
  }

  if (!ACCEPTED.includes(sniffed)) {
    // Named as what it is, not as what it claimed, because "your PDF is
    // not a PDF" is the useful sentence here.
    return {
      ok: false,
      sniffed,
      reason: `${input.originalName} is not a PDF or an image. It was sent as ${input.mediaType || "an unknown type"}, but its contents are not a readable document.`,
    };
  }

  // A PDF renamed .jpg still reads fine, so a mismatch is not by itself
  // a refusal. What is refused is a mismatch in the direction that
  // matters: the client saying "image" when the bytes are a PDF makes
  // the pipeline send an image block for a document, which fails
  // downstream in a way nobody can diagnose from the error.
  const claimedPdf = input.kind === "pdf" || input.mediaType === "application/pdf";
  if (claimedPdf !== (sniffed === "pdf")) {
    return {
      ok: false,
      sniffed,
      reason: `${input.originalName} was sent as ${claimedPdf ? "a PDF" : "an image"} but its contents are ${sniffed === "pdf" ? "a PDF" : `a ${sniffed.toUpperCase()} image`}. Upload it again rather than renaming it.`,
    };
  }

  return { ok: true, sniffed };
}

// A base64 payload with no padding problems and nothing outside the
// alphabet. Checked before decoding, because a malformed string decodes
// to silent garbage that then sniffs as "unknown" and produces a
// confusing refusal.
export function isPlausibleBase64(s: string): boolean {
  if (s.length === 0 || s.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

// Bytes a base64 string decodes to, without decoding it.
export function decodedByteLength(s: string): number {
  if (s.length === 0) return 0;
  const padding = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return (s.length / 4) * 3 - padding;
}
