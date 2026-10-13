// Where a link or a form may send someone after it is done: a path on
// this site, never another one.
//
// Checking for a leading "/" and refusing "//" is not enough. Browsers
// read a backslash as a slash, so "/\evil.com" goes to https://evil.com,
// and the URL parser strips tabs and newlines, so "/\t/evil.com" becomes
// "//evil.com". So the value is refused on any backslash or control
// character (raw or percent-encoded), and then resolved against a base
// and refused unless it is still on that base.

const BASE = "https://same-origin.invalid";

// Built from char codes so no control character sits in the source.
const UNSAFE = new RegExp(`[\\\\${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}]`);

export function safeLocalPath(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/";
  }
  for (const v of [value, decoded]) {
    if (UNSAFE.test(v) || v.startsWith("//")) return "/";
  }
  let resolved: URL;
  try {
    resolved = new URL(value, BASE);
  } catch {
    return "/";
  }
  if (resolved.origin !== BASE) return "/";
  return value;
}
