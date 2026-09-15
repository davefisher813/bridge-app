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

  // A weighted 100-point school can and does report an average above
  // 100: Cardinal Hayes weights every H/R/AP course and its transcripts
  // carry course grades like 102. Those used to fall past the `n <= 100`
  // branch into `return null`, so a real weighted average came back as
  // "no GPA at all" rather than as a very good one. Anything in this
  // band is a 100-scale number and is treated as the top of that scale.
  const HUNDRED_SCALE_MAX = 110;

  if (!explicit) {
    if (n <= 4.3) scale = "4.0";
    else if (n <= 5.5) scale = "5.0"; // some weighted scales
    else if (n <= 11) scale = "10"; // some international
    else if (n <= 22) scale = "20"; // French/Belgian
    else if (n <= HUNDRED_SCALE_MAX) scale = "100";
    else return null; // out of bounds
  }

  if (scale === "4.0" && (n < 0 || n > 4.3)) return null;
  if (scale === "5.0" && (n < 0 || n > 5.5)) return null;
  if (scale === "10" && (n < 0 || n > 10)) return null;
  if (scale === "20" && (n < 0 || n > 20)) return null;
  if (scale === "100" && (n < 0 || n > HUNDRED_SCALE_MAX)) return null;

  // origValue below keeps what the document actually said; a weighted
  // 100-scale value above 97 already lands on 4.0 in the branch below,
  // so a 102 needs no special case beyond being let through the bound.
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
