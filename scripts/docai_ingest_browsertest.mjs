// Real-browser verification for src/lib/docai/ingest.ts. That file
// depends on File/FileReader/Blob/createImageBitmap/canvas, none of
// which exist under vitest's node environment (see vitest.config.ts) -
// so unlike every other docai module, it cannot be proven correct by
// `npm test` alone. This script drives an actual headless Chromium via
// Playwright, constructs real files (a real PNG, a real JPEG with a
// hand-crafted EXIF orientation tag spliced in, a fake HEIC, an
// oversized file, garbage bytes) entirely in-browser, and asserts on
// what ingestFile() actually returns - including decoding the output
// base64 back into pixels to confirm the EXIF rotation is geometrically
// correct, not just "didn't throw". See docs/ARCHITECTURE.md and
// docs/DECISIONS.md for why this exists instead of a claimed-but-unverified port.
//
// Run with: node scripts/docai_ingest_browsertest.mjs
// Requires: esbuild and playwright (both available in this sandbox
// without being added to package.json - this script is a one-off
// verification tool, not part of the app or its build).

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
// Playwright is installed globally in this sandbox, not as a repo
// dependency (this script is a one-off verification tool, not part of
// the app or its build) - importing its resolved path directly avoids
// needing NODE_PATH tricks that don't apply to ESM resolution anyway.
import playwright from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
const { chromium } = playwright;

const repoRoot = path.resolve(new URL(".", import.meta.url).pathname, "..");
const workDir = mkdtempSync(path.join(tmpdir(), "docai-ingest-"));
const bundlePath = path.join(workDir, "ingest.bundle.js");

console.log("==> Bundling src/lib/docai/ingest.ts with esbuild");
execSync(
  `npx --no-install esbuild src/lib/docai/ingest.ts --bundle --format=iife --global-name=DocAI --target=es2020 --platform=browser --outfile=${bundlePath}`,
  { cwd: repoRoot, stdio: "inherit" }
);
const bundleCode = readFileSync(bundlePath, "utf8");

const CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let failures = 0;
let total = 0;
function check(label, condition, detail) {
  total++;
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    failures++;
    console.log(`FAIL: ${label}${detail ? " - " + detail : ""}`);
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: bundleCode });

  // Confirm the module actually loaded and exposed what we need before
  // trusting anything else this script reports.
  const loaded = await page.evaluate(() => typeof window.DocAI?.ingestFile === "function");
  check("bundle loads and exposes DocAI.ingestFile in a real browser", loaded);
  if (!loaded) {
    await browser.close();
    process.exit(1);
  }

  // ── Empirically settle whether this Chromium's createImageBitmap
  // auto-applies EXIF orientation, and whether {imageOrientation:"none"}
  // can turn that off. This is the finding that drove ingest.ts's
  // design: it does auto-apply, and "none" does NOT suppress it for a
  // Blob-sourced JPEG - so ingest.ts trusts the browser instead of
  // hand-rolling its own rotation (which would double-rotate on top of
  // this). If a future Chromium changes this, this check catches it. ──
  const orientationDefaultResult = await page.evaluate(async () => {
    // 4x2 canvas, left half red, right half blue - encode as JPEG, then
    // splice in an orientation=6 EXIF tag by hand (browsers don't let
    // you set EXIF via canvas encoding).
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = "blue";
    ctx.fillRect(2, 0, 2, 2);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 1));
    const buf = new Uint8Array(await blob.arrayBuffer());

    function buildExifApp1(orientation) {
      const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
      const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation & 0xff, (orientation >> 8) & 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
      const content = [...exifHeader, ...tiff];
      const segLen = content.length + 2;
      return [0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff, ...content];
    }

    const app1 = buildExifApp1(6);
    const withExif = new Uint8Array(2 + app1.length + (buf.length - 2));
    withExif.set(buf.subarray(0, 2), 0); // SOI
    withExif.set(app1, 2);
    withExif.set(buf.subarray(2), 2 + app1.length);

    const rawBitmap = await createImageBitmap(new Blob([withExif], { type: "image/jpeg" }));
    const noneBitmap = await createImageBitmap(new Blob([withExif], { type: "image/jpeg" }), { imageOrientation: "none" });

    return {
      defaultDims: { width: rawBitmap.width, height: rawBitmap.height },
      noneDims: { width: noneBitmap.width, height: noneBitmap.height },
      encodedBytesBase64: btoa(String.fromCharCode(...withExif)),
    };
  });
  console.log(
    `INFO: this Chromium's createImageBitmap dims for a 4x2 orientation=6 JPEG - default: ${JSON.stringify(orientationDefaultResult.defaultDims)}, {imageOrientation:"none"}: ${JSON.stringify(orientationDefaultResult.noneDims)}`
  );
  check(
    "createImageBitmap auto-rotates a 4x2 orientation=6 JPEG to 2x4 by default (this is what ingest.ts relies on)",
    orientationDefaultResult.defaultDims.width === 2 && orientationDefaultResult.defaultDims.height === 4,
    JSON.stringify(orientationDefaultResult.defaultDims)
  );
  check(
    'imageOrientation:"none" does NOT suppress that auto-rotation for a Blob-sourced JPEG in this Chromium - confirms manual rotation on top of this would double-rotate, which is why ingest.ts does not attempt one',
    orientationDefaultResult.noneDims.width === 2 && orientationDefaultResult.noneDims.height === 4,
    JSON.stringify(orientationDefaultResult.noneDims)
  );

  const jpegWithOrientationBase64 = orientationDefaultResult.encodedBytesBase64;

  // ── PNG: a real, hand-built 3x2 PNG (no canvas needed - built with
  // Node's zlib before this script even opened the page) with a
  // distinct pixel per position, to prove createImageBitmap/canvas
  // round-trip real pixel data, not just that nothing threw. ──
  const png = buildTestPng();
  const pngBase64 = Buffer.from(png).toString("base64");

  const results = await page.evaluate(
    async ({ pngBase64, jpegBase64 }) => {
      function base64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
      function makeFile(bytes, name, type) {
        return new File([bytes], name, { type });
      }

      async function decodePixels(base64, mediaType) {
        const bytes = base64ToBytes(base64);
        const bitmap = await createImageBitmap(new Blob([bytes], { type: mediaType }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        return { width: bitmap.width, height: bitmap.height, data: Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data) };
      }

      const out = {};

      // PNG round-trip
      const pngFile = makeFile(base64ToBytes(pngBase64), "test.png", "image/png");
      const pngRecord = await window.DocAI.ingestFile(pngFile, { sourceRole: "admin", requestId: "test-png" });
      out.png = { kind: pngRecord.kind, mediaType: pngRecord.mediaType, width: pngRecord.width, height: pngRecord.height, normalizedSkipped: pngRecord.normalizedSkipped, base64Length: pngRecord.base64.length };
      out.pngDecoded = await decodePixels(pngRecord.base64, "image/png");

      // JPEG with orientation=6 (should come out rotated 90deg CW, dims swapped 4x2 -> 2x4)
      const jpegFile = makeFile(base64ToBytes(jpegBase64), "photo.jpg", "image/jpeg");
      const jpegRecord = await window.DocAI.ingestFile(jpegFile, { sourceRole: "admin", requestId: "test-jpeg" });
      out.jpeg = { kind: jpegRecord.kind, mediaType: jpegRecord.mediaType, width: jpegRecord.width, height: jpegRecord.height, normalizedSkipped: jpegRecord.normalizedSkipped };
      out.jpegDecoded = await decodePixels(jpegRecord.base64, "image/jpeg");

      // PDF: just needs real %PDF magic bytes - not decoded, passthrough
      const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF");
      const pdfFile = makeFile(pdfBytes, "doc.pdf", "application/pdf");
      const pdfRecord = await window.DocAI.ingestFile(pdfFile, { sourceRole: "admin", requestId: "test-pdf" });
      out.pdf = { kind: pdfRecord.kind, mediaType: pdfRecord.mediaType, blockType: pdfRecord.blockType, base64: pdfRecord.base64 };

      // Fake HEIC: real ftyp/heic magic bytes, no real image data after
      const heicBytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
      const heicFile = makeFile(heicBytes, "photo.heic", "image/heic");
      const heicRecord = await window.DocAI.ingestFile(heicFile, { sourceRole: "admin", requestId: "test-heic" });
      out.heic = { kind: heicRecord.kind, normalizedSkipped: heicRecord.normalizedSkipped, fallbackReason: heicRecord.fallbackReason, base64: heicRecord.base64 };

      // Oversized: exceed MAX_INGEST_BYTES without needing a real 4MB+ image
      const oversized = new Uint8Array(window.DocAI.MAX_INGEST_BYTES + 1024);
      const oversizedFile = makeFile(oversized, "huge.png", "image/png");
      const oversizedRecord = await window.DocAI.ingestFile(oversizedFile, { sourceRole: "admin", requestId: "test-big" });
      out.oversized = { kind: oversizedRecord.kind, normalizedSkipped: oversizedRecord.normalizedSkipped, fallbackReason: oversizedRecord.fallbackReason };

      // Unknown/garbage bytes
      const garbage = new TextEncoder().encode("this is not any known file format at all");
      const garbageFile = makeFile(garbage, "mystery.dat", "application/octet-stream");
      const garbageRecord = await window.DocAI.ingestFile(garbageFile, { sourceRole: "admin", requestId: "test-garbage" });
      out.garbage = { kind: garbageRecord.kind, normalizedSkipped: garbageRecord.normalizedSkipped };

      // Renamed-file sniffing: a PNG's real bytes given a .jpg name and image/jpeg MIME
      const mislabeledFile = makeFile(base64ToBytes(pngBase64), "actually-a-png.jpg", "image/jpeg");
      const mislabeledRecord = await window.DocAI.ingestFile(mislabeledFile, { sourceRole: "admin", requestId: "test-mislabel" });
      out.mislabeled = { kind: mislabeledRecord.kind, mediaType: mislabeledRecord.mediaType };

      return out;
    },
    { pngBase64, jpegBase64: jpegWithOrientationBase64 }
  );

  // ── Assertions in Node, against what the real browser actually did ──
  check("PNG ingests as kind=image, image/png, not skipped", results.png.kind === "image" && results.png.mediaType === "image/png" && results.png.normalizedSkipped === false);
  check("PNG round-trip preserves real dimensions (3x2)", results.png.width === 3 && results.png.height === 2, JSON.stringify(results.png));
  check("PNG round-trip produces non-empty base64", results.png.base64Length > 0);
  check(
    "PNG decoded pixel data matches the original 3x2 test pattern (red/green/blue top row)",
    pixelAt(results.pngDecoded, 0, 0, [255, 0, 0]) && pixelAt(results.pngDecoded, 1, 0, [0, 255, 0]) && pixelAt(results.pngDecoded, 2, 0, [0, 0, 255]),
    JSON.stringify(results.pngDecoded.data)
  );

  check("JPEG ingests as kind=image, image/jpeg, not skipped", results.jpeg.kind === "image" && results.jpeg.mediaType === "image/jpeg" && results.jpeg.normalizedSkipped === false, JSON.stringify(results.jpeg));
  check(
    "JPEG orientation=6 reports the browser's already-corrected dimensions (2x4), not the raw stored 4x2",
    results.jpeg.width === 2 && results.jpeg.height === 4,
    JSON.stringify(results.jpeg)
  );
  check("JPEG orientation=6 output canvas matches those same corrected dimensions (2 wide x 4 tall)", results.jpegDecoded.width === 2 && results.jpegDecoded.height === 4, JSON.stringify(results.jpegDecoded));
  // Source was left-half red (x=0..1), right-half blue (x=2..3), all y, in raw
  // (pre-correction) 4x2 pixel space. ingest.ts does no rotation of its own -
  // it trusts whatever createImageBitmap already produced - so this is really
  // asserting that re-encoding through canvas doesn't scramble what the
  // browser already corrected, using the same orientation this Chromium
  // produces (empirically red-half-on-top, confirmed above).
  check(
    "re-encoding through canvas preserves the browser's own EXIF-corrected layout without further scrambling it",
    pixelApprox(results.jpegDecoded, 1, 0, [255, 0, 0], 40) && pixelApprox(results.jpegDecoded, 1, 3, [0, 0, 255], 40),
    JSON.stringify(results.jpegDecoded.data)
  );

  check("PDF ingests as kind=pdf, application/pdf, blockType=document", results.pdf.kind === "pdf" && results.pdf.mediaType === "application/pdf" && results.pdf.blockType === "document");
  check("PDF base64 decodes back to the original bytes", Buffer.from(results.pdf.base64, "base64").toString("utf8").startsWith("%PDF-1.4"));

  check("HEIC is recognized by magic bytes but not decoded (normalizedSkipped, empty base64)", results.heic.kind === "heic" && results.heic.normalizedSkipped === true && results.heic.base64 === "", JSON.stringify(results.heic));
  check("HEIC gets a human-readable fallback reason", typeof results.heic.fallbackReason === "string" && results.heic.fallbackReason.toLowerCase().includes("heic"));

  check("Oversized file is rejected before decoding, with size in the fallback reason", results.oversized.normalizedSkipped === true && /\d+(\.\d+)?MB/.test(results.oversized.fallbackReason || ""), JSON.stringify(results.oversized));

  check("Unrecognized bytes ingest as kind=unknown, normalizedSkipped", results.garbage.kind === "unknown" && results.garbage.normalizedSkipped === true);

  check(
    "A PNG's real bytes are sniffed as image/png even when named .jpg with image/jpeg MIME (magic-byte sniffing beats extension/MIME)",
    results.mislabeled.kind === "image" && results.mislabeled.mediaType === "image/png",
    JSON.stringify(results.mislabeled)
  );

  await browser.close();

  console.log(`\n${total - failures}/${total} DOCAI INGEST BROWSER ASSERTIONS PASSED${failures === 0 ? "" : ` (${failures} FAILED)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

function pixelAt(decoded, x, y, rgb) {
  const i = (y * decoded.width + x) * 4;
  return decoded.data[i] === rgb[0] && decoded.data[i + 1] === rgb[1] && decoded.data[i + 2] === rgb[2];
}
function pixelApprox(decoded, x, y, rgb, tolerance) {
  const i = (y * decoded.width + x) * 4;
  return Math.abs(decoded.data[i] - rgb[0]) <= tolerance && Math.abs(decoded.data[i + 1] - rgb[1]) <= tolerance && Math.abs(decoded.data[i + 2] - rgb[2]) <= tolerance;
}

// ── Minimal real PNG encoder (Node's built-in zlib only, no deps) ──
// 3x2, RGB, distinct color per pixel: row0 = red,green,blue; row1 = white,black,gray.
function buildTestPng() {
  const width = 3;
  const height = 2;
  const pixels = [
    [255, 0, 0], [0, 255, 0], [0, 0, 255],
    [255, 255, 255], [0, 0, 0], [128, 128, 128],
  ];

  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter type 0 (none)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels[y * width + x];
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }

  const idatData = zlib.deflateSync(raw);

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

writeFileSync(path.join(workDir, "note.txt"), "scratch dir for docai_ingest_browsertest.mjs\n");
main().catch((e) => {
  console.error("ERROR", e);
  process.exit(1);
});
