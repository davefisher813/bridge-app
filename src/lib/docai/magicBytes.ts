// Sniffs a file's real format from its leading bytes rather than trusting
// its extension or browser-reported MIME type - a renamed or
// mislabeled file (a .jpg that's actually a HEIC export, a screenshot
// saved as .png that's really a WEBP) would otherwise sail through as
// whatever its name claims. Pure function: no File/Blob/DOM dependency,
// so it's testable without a browser. See src/lib/docai/ingest.ts,
// which is the browser-dependent caller.

export type SniffedKind = "pdf" | "jpeg" | "png" | "gif" | "webp" | "heic" | "unknown";

export function sniffKind(bytes: Uint8Array): SniffedKind {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf"; // %PDF
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "gif"; // GIF87a / GIF89a
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "webp";
  }
  // ISO base media file format (HEIC/HEIF): a "ftyp" box at offset 4,
  // with the actual brand four bytes after that.
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand)) {
      return "heic";
    }
  }
  return "unknown";
}
