// Models sometimes wrap JSON in markdown fences or add a stray sentence
// before/after it despite being told not to. Faithful port of the
// cleanup Bridge repeated in three places (triage.check,
// categories.extract - bffsa-site/index.html ~lines 2200-2207,
// 2343-2350): strip fences, try a straight parse, then fall back to
// the first complete {...} object in the text.
//
// The fallback walks braces rather than matching from the first "{" to
// the LAST "}", which is what the first version did: a closing remark
// like "Let me know if {anything} is unclear" after the object made the
// greedy match unparseable and threw a good extraction away.

export class ModelJsonParseError extends Error {
  constructor(public readonly rawText: string) {
    super(`Could not parse JSON from model response: ${rawText.slice(0, 200)}`);
    this.name = "ModelJsonParseError";
  }
}

// The first balanced {...} in the text, string-aware so a brace inside a
// quoted value does not end the object early. Null when there is none.
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// JSON as a model writes it when it slips: a trailing comma before a
// closing brace or bracket, which JSON.parse refuses.
function withoutTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
}

export function parseModelJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const attempts = [cleaned, firstJsonObject(cleaned), withoutTrailingCommas(cleaned), withoutTrailingCommas(firstJsonObject(cleaned) ?? "")];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next shape
    }
  }
  throw new ModelJsonParseError(cleaned);
}
