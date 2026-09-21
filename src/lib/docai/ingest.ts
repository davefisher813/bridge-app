// Browser-side file ingest: reads a File the user dropped or picked,
// figures out what it actually is (magicBytes.ts, not the extension),
// and produces an IngestedRecord ready for the extraction pipeline
// (pipeline.ts) to send to the model. Faithful in spirit to Bridge's
// diReadAndProcess/diReadBuffer/diReadDataURL (bffsa-site's Doc AI
// ingest), but rebuilt against this repo's own IngestedRecord shape.
//
// EXIF orientation is handled by the browser, not by hand-rolled code
// here. The original design (still in git history) parsed the JPEG's
// own EXIF orientation tag and applied a manual canvas rotation -
// scripts/docai_ingest_browsertest.mjs's real-Chromium verification
// caught that this sandbox's Chromium already auto-rotates on
// createImageBitmap (per the current spec's "from-image" default) and
// ignores an explicit `imageOrientation: "none"` override for a
// Blob-sourced JPEG, so the manual rotation was silently double-rotating
// every oriented photo. See docs/DECISIONS.md for the full story - this
// is exactly the kind of bug "porting without a way to test it" would
// have shipped.
//
// This file depends on File/FileReader/Blob/createImageBitmap/canvas -
// none of which exist in Node, so it can't run under vitest the way
// magicBytes.ts does. It's verified with Playwright driving a real
// headless Chromium instead (scripts/docai_ingest_browsertest.mjs)
// rather than left unported and unverified - see docs/ARCHITECTURE.md.

import type { IngestedRecord, SourceRole } from "./types";
import { sniffKind } from "./magicBytes";
import { MAX_IMAGE_EDGE, MAX_INGEST_BYTES } from "./limits";

// Re-exported so existing callers keep working. The constant itself
// moved to ./limits so the server can import it without pulling this
// browser-only module in. See limits.ts.
export { MAX_INGEST_BYTES } from "./limits";

const SUPPORTED_IMAGE_KINDS = new Set(["jpeg", "png", "gif", "webp"]);

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

// Chunked to avoid blowing the call stack on String.fromCharCode.apply
// for a multi-megabyte file - same chunking Bridge used for PDFs.
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

interface NormalizedImage {
  base64: string;
  width?: number;
  height?: number;
  skipped: boolean;
  fallbackReason?: string;
  // The format the bytes are in after normalising, which can differ
  // from the input when a photo was scaled down.
  mediaType?: string;
}

// Decodes the image and re-encodes it through canvas, so the output
// format/base64 shape is consistent regardless of input format, and
// width/height are real decoded values rather than trusted from the
// file's own claims. A photo bigger than MAX_IMAGE_EDGE on its long
// side is scaled down first: a 12 megapixel phone photo is four
// megabytes of pixels the model would downsample anyway, and scaling it
// here is what lets a camera shot fit under the cap at all. createImageBitmap applies the image's EXIF
// orientation itself (this sandbox's Chromium does so unconditionally -
// see the file header comment), so bitmap.width/height are already the
// correctly-oriented, final dimensions; no manual rotation needed or
// wanted. Falls back to the untouched original bytes if decoding fails
// for any reason - a normalization miss should degrade the image, never
// block the whole upload.
async function normalizeImage(bytes: Uint8Array, mediaType: string): Promise<NormalizedImage> {
  try {
    // Cast: TS's DOM lib types BlobPart against Uint8Array<ArrayBuffer>
    // specifically, but a Uint8Array view over any ArrayBufferLike works
    // identically at runtime - this is a type-strictness quirk, not a
    // real runtime concern.
    const blob = new Blob([bytes as unknown as BlobPart], { type: mediaType });
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });

    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    // A scaled photo goes as JPEG whatever it arrived as: a PNG
    // screenshot keeps its format at full size, but a PNG of a
    // camera photo scaled down is several times the JPEG for no gain.
    const outType = scale < 1 && mediaType === "image/png" ? "image/jpeg" : mediaType;
    const base64 = canvasToBase64(canvas, outType);
    return { base64, width, height, skipped: false, mediaType: outType };
  } catch (e) {
    return { base64: bytesToBase64(bytes), skipped: true, fallbackReason: `Could not normalize image, sending as-is: ${(e as Error).message}` };
  }
}

function canvasToBase64(canvas: HTMLCanvasElement, mediaType: string): string {
  const dataUrl = canvas.toDataURL(mediaType === "image/png" ? "image/png" : "image/jpeg", 0.92);
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "";
}

export interface IngestOptions {
  sourceRole: SourceRole;
  requestId: string;
}

export async function ingestFile(file: File, opts: IngestOptions): Promise<IngestedRecord> {
  const base = {
    originalName: file.name,
    originalSize: file.size,
    originalMime: file.type || "application/octet-stream",
    sourceRole: opts.sourceRole,
    ingestedAt: new Date().toISOString(),
    requestId: opts.requestId,
  };

  const tooLarge = (size: number, kind: IngestedRecord["kind"], mediaType: string): IngestedRecord => {
    const mb = (size / 1024 / 1024).toFixed(1);
    return {
      ...base,
      kind,
      mediaType,
      base64: "",
      blockType: "document",
      normalizedSkipped: true,
      fallbackReason: `File too large for AI processing (${mb}MB, max ${(MAX_INGEST_BYTES / 1024 / 1024).toFixed(0)}MB).`,
    };
  };

  // A photo over the cap may still fit once it is scaled down, so only
  // a file too big to even read into memory is refused here. Anything
  // else is checked again after normalising, on the bytes that would
  // actually be sent.
  if (file.size > MAX_INGEST_BYTES * 4) return tooLarge(file.size, "unknown", base.originalMime);

  const buf = await readAsArrayBuffer(file);
  const bytes = new Uint8Array(buf);
  const sniffed = sniffKind(bytes);

  if (sniffed === "pdf") {
    if (bytes.length > MAX_INGEST_BYTES) return tooLarge(bytes.length, "pdf", "application/pdf");
    return { ...base, kind: "pdf", mediaType: "application/pdf", base64: bytesToBase64(bytes), blockType: "document" };
  }

  if (sniffed === "heic") {
    // Neither Anthropic's vision API nor most non-Safari browsers
    // (this sandbox's headless Chromium included, confirmed by the
    // Playwright verification for this file) can decode HEIC. Surfaced
    // as an honest gap rather than silently sent as bytes the model
    // would reject or dropped without explanation.
    return {
      ...base,
      kind: "heic",
      mediaType: file.type || "image/heic",
      base64: "",
      blockType: "image",
      normalizedSkipped: true,
      fallbackReason: "HEIC photos can't be processed directly - ask for a JPEG or PNG instead.",
    };
  }

  if (SUPPORTED_IMAGE_KINDS.has(sniffed)) {
    const mediaType = `image/${sniffed}`;
    const normalized = await normalizeImage(bytes, mediaType);
    // Base64 is a third bigger than the bytes it carries.
    const sentBytes = Math.floor((normalized.base64.length * 3) / 4);
    if (sentBytes > MAX_INGEST_BYTES) return tooLarge(sentBytes, "image", normalized.mediaType ?? mediaType);
    return {
      ...base,
      kind: "image",
      mediaType: normalized.mediaType ?? mediaType,
      base64: normalized.base64,
      blockType: "image",
      width: normalized.width,
      height: normalized.height,
      normalizedSkipped: normalized.skipped,
      fallbackReason: normalized.fallbackReason,
    };
  }

  if (bytes.length > MAX_INGEST_BYTES) return tooLarge(bytes.length, "unknown", base.originalMime);
  return {
    ...base,
    kind: "unknown",
    mediaType: base.originalMime,
    base64: "",
    blockType: "document",
    normalizedSkipped: true,
    fallbackReason: `Unsupported file type. Try a PDF, JPEG, or PNG instead.`,
  };
}
