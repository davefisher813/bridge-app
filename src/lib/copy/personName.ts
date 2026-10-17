// A name as shown (Dave, 2026-10-17: "hathaway roper" in the gifts list).
// A name typed or imported wholly in lower case is shown capitalised word
// by word; a name with any capital in it is shown exactly as written, so
// McDonald, DeShawn and LLC are never "corrected".
export function displayName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n || n !== n.toLowerCase()) return n;
  return n.replace(/(^|[\s\-'’.(/])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}
