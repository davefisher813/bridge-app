// Models sometimes wrap JSON in markdown fences or add a stray sentence
// before/after it despite being told not to. Faithful port of the
// cleanup Bridge repeated in three places (triage.check,
// categories.extract - bffsa-site/index.html ~lines 2200-2207,
// 2343-2350): strip fences, try a straight parse, then fall back to
// grabbing the first {...} block.

export class ModelJsonParseError extends Error {
  constructor(public readonly rawText: string) {
    super(`Could not parse JSON from model response: ${rawText.slice(0, 200)}`);
    this.name = "ModelJsonParseError";
  }
}

export function parseModelJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]+\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through to the error below
      }
    }
    throw new ModelJsonParseError(cleaned);
  }
}
