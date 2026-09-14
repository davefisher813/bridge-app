// GPA scale normalization. Faithful port of Bridge's _normalizeGpa
// (bffsa-site/index.html ~line 2717) - this logic is real, tested-by-use
// admin-tuned data (which score ranges map to which 4.0-scale value on a
// 100-point transcript), not a patch, so it carries over as-is.

export interface NormalizedGpa {
  gpa: number;
  origScale: string;
  origValue: number;
}

export function normalizeGpa(rawGpa: number | null | undefined, scaleHint?: string): NormalizedGpa | null {
  if (rawGpa == null) return null;
  const n = rawGpa;
  if (Number.isNaN(n)) return null;

  let scale = (scaleHint || "").toLowerCase().trim();
  const explicit = scale === "4.0" || scale === "5.0" || scale === "10" || scale === "20" || scale === "100";

  if (!explicit) {
    if (n <= 4.3) scale = "4.0";
    else if (n <= 5.5) scale = "5.0"; // some weighted scales
    else if (n <= 11) scale = "10"; // some international
    else if (n <= 22) scale = "20"; // French/Belgian
    else if (n <= 100) scale = "100";
    else return null; // out of bounds
  }

  if (scale === "4.0" && (n < 0 || n > 4.3)) return null;
  if (scale === "5.0" && (n < 0 || n > 5.5)) return null;
  if (scale === "10" && (n < 0 || n > 10)) return null;
  if (scale === "20" && (n < 0 || n > 20)) return null;
  if (scale === "100" && (n < 0 || n > 100)) return null;

  let converted = n;
  if (scale === "5.0") converted = (n * 4) / 5;
  else if (scale === "10") converted = (n * 4) / 10;
  else if (scale === "20") converted = (n * 4) / 20;
  else if (scale === "100") {
    // US 100-scale, roughly: 90+ = A (4.0), 80-89 = B (3.0), 70-79 = C
    // (2.0), 60-69 = D (1.0). Ported as-is: admin-tuned, not a patch.
    if (n >= 97) converted = 4.0;
    else if (n >= 93) converted = 3.7 + ((n - 93) / 4) * 0.3;
    else if (n >= 90) converted = 3.3 + ((n - 90) / 3) * 0.4;
    else if (n >= 87) converted = 3.0 + ((n - 87) / 3) * 0.3;
    else if (n >= 83) converted = 2.7 + ((n - 83) / 4) * 0.3;
    else if (n >= 80) converted = 2.3 + ((n - 80) / 3) * 0.4;
    else if (n >= 77) converted = 2.0 + ((n - 77) / 3) * 0.3;
    else if (n >= 70) converted = 1.0 + ((n - 70) / 7) * 1.0;
    else if (n >= 60) converted = 0.7 + ((n - 60) / 10) * 0.3;
    else converted = 0;
  }

  converted = Math.max(0, Math.min(4.3, Math.round(converted * 100) / 100));
  return { gpa: converted, origScale: scale, origValue: n };
}
