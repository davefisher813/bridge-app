import { describe, expect, it } from "vitest";
import { sniffKind } from "@/lib/docai/magicBytes";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("sniffKind", () => {
  it("recognizes a PDF by its %PDF magic bytes", () => {
    expect(sniffKind(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34))).toBe("pdf");
  });

  it("recognizes a JPEG by its FFD8FF magic bytes", () => {
    expect(sniffKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe("jpeg");
  });

  it("recognizes a PNG by its full 8-byte signature", () => {
    expect(sniffKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
  });

  it("recognizes a GIF by its GIF8 signature", () => {
    expect(sniffKind(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("gif");
  });

  it("recognizes a WEBP by its RIFF....WEBP signature", () => {
    expect(sniffKind(bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50))).toBe("webp");
  });

  it("recognizes a HEIC by its ftyp box brand", () => {
    expect(sniffKind(bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63))).toBe("heic");
  });

  it("recognizes an HEIF brand variant (mif1) as heic too", () => {
    expect(sniffKind(bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31))).toBe("heic");
  });

  it("does not misclassify a RIFF file that isn't WEBP", () => {
    expect(sniffKind(bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20))).toBe("unknown");
  });

  it("does not misclassify an ftyp box with an unrecognized brand", () => {
    expect(sniffKind(bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32))).toBe("unknown");
  });

  it("returns unknown for a renamed file whose bytes don't match its extension's claim", () => {
    // A plain text file's bytes, regardless of what a .jpg extension might claim.
    expect(sniffKind(new TextEncoder().encode("just some text content"))).toBe("unknown");
  });

  it("returns unknown for an empty buffer", () => {
    expect(sniffKind(new Uint8Array(0))).toBe("unknown");
  });
});
