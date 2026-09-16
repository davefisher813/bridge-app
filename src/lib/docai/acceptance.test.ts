import { describe, it, expect } from "vitest";
import { checkIngestedRecord, decodedByteLength, isPlausibleBase64, MAX_RECORDS_PER_UPLOAD } from "./acceptance";
import { MAX_INGEST_BYTES } from "./limits";

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const HEIC_HEADER = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
const ZIP_HEADER = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

const pdf = (over: Partial<Parameters<typeof checkIngestedRecord>[0]> = {}) => ({
  originalName: "transcript.pdf",
  originalSize: 1000,
  mediaType: "application/pdf",
  kind: "pdf",
  base64Length: 1400,
  byteLength: 1000,
  header: PDF_HEADER,
  ...over,
});

describe("server-side acceptance", () => {
  it("accepts a real PDF", () => {
    expect(checkIngestedRecord(pdf()).ok).toBe(true);
  });

  it("accepts a real JPEG", () => {
    const r = checkIngestedRecord(pdf({ originalName: "photo.jpg", mediaType: "image/jpeg", kind: "image", header: JPEG_HEADER }));
    expect(r.ok).toBe(true);
    expect(r.sniffed).toBe("jpeg");
  });

  it("refuses a file over the limit, measured rather than reported", () => {
    // The client says it is small. The bytes say otherwise, and the
    // bytes are what count: originalSize comes from a caller that this
    // check exists because it cannot be trusted.
    const r = checkIngestedRecord(pdf({ originalSize: 10, byteLength: MAX_INGEST_BYTES + 1 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/limit/);
  });

  it("refuses HEIC, which nothing downstream can read", () => {
    const r = checkIngestedRecord(pdf({ originalName: "IMG_0042.HEIC", mediaType: "image/heic", kind: "image", header: HEIC_HEADER }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/JPEG or PNG/);
  });

  it("refuses a file that is neither a PDF nor an image whatever it is named", () => {
    const r = checkIngestedRecord(pdf({ originalName: "transcript.pdf", header: ZIP_HEADER }));
    expect(r.ok).toBe(false);
    expect(r.sniffed).toBe("unknown");
  });

  it("refuses a PDF sent as an image, which fails unreadably downstream", () => {
    const r = checkIngestedRecord(pdf({ kind: "image", mediaType: "image/jpeg", header: PDF_HEADER }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/contents are a PDF/);
  });

  it("refuses an image sent as a PDF", () => {
    const r = checkIngestedRecord(pdf({ kind: "pdf", mediaType: "application/pdf", header: JPEG_HEADER }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/JPEG image/);
  });

  it("refuses an empty payload", () => {
    expect(checkIngestedRecord(pdf({ byteLength: 0 })).ok).toBe(false);
  });

  it("caps how many files one request can queue", () => {
    expect(MAX_RECORDS_PER_UPLOAD).toBeGreaterThan(0);
    expect(MAX_RECORDS_PER_UPLOAD).toBeLessThanOrEqual(25);
  });
});

describe("base64 handling", () => {
  it("rejects anything that is not base64 before decoding it", () => {
    expect(isPlausibleBase64("")).toBe(false);
    expect(isPlausibleBase64("not base64!")).toBe(false);
    expect(isPlausibleBase64("abc")).toBe(false); // wrong length
    expect(isPlausibleBase64("aGVsbG8=")).toBe(true);
  });

  it("measures the decoded size without decoding", () => {
    // "hello" is 5 bytes, encodes to "aGVsbG8=".
    expect(decodedByteLength("aGVsbG8=")).toBe(5);
    expect(decodedByteLength(Buffer.from("hi").toString("base64"))).toBe(2);
    expect(decodedByteLength(Buffer.from("abc").toString("base64"))).toBe(3);
    expect(decodedByteLength("")).toBe(0);
  });

  it("agrees with a real decode across sizes, so the cap cannot be off by a byte", () => {
    for (let n = 1; n <= 64; n++) {
      const b64 = Buffer.from("x".repeat(n)).toString("base64");
      expect(decodedByteLength(b64)).toBe(n);
    }
  });
});
