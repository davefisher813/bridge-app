// A file name made readable, for a row that has no title and no type
// (live test V5/D6, 2026-10-16): "browser-download-20261009T014437.089730450Z-11-fiscal-policy.pdf"
// reads "Fiscal Policy". The real file name stays in the row's details.

const BROWSER_DOWNLOAD = /^browser-download-\d{8}T\d+(?:\.\d+)?Z-/i;

function titleWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function readableFileName(fileName: string): string {
  let n = fileName.trim();
  n = n.replace(/\.[A-Za-z0-9]{2,5}$/, "");
  n = n.replace(BROWSER_DOWNLOAD, "");
  // A leading sort number ("11-", "03_") is how the file was ordered, not part of its name.
  n = n.replace(/^\d{1,3}[-_ ]+(?=[A-Za-z])/, "");
  n = n.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return n ? titleWords(n) : fileName;
}
