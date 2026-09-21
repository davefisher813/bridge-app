// The monthly Doc AI cap as typed on the form: whole dollars, zero or
// more, into cents. Pure, so the action file can stay a "use server"
// module that exports only actions.

export const MAX_DOCAI_BUDGET_DOLLARS = 10_000;

export function parseBudgetDollars(raw: unknown): { ok: true; cents: number } | { ok: false; error: string } {
  const text = String(raw ?? "").trim().replace(/^\$/, "");
  if (text === "") return { ok: false, error: "Enter a dollar amount" };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "A dollar amount, zero or more" };
  if (!Number.isInteger(n)) return { ok: false, error: "Whole dollars" };
  if (n > MAX_DOCAI_BUDGET_DOLLARS) return { ok: false, error: `Up to $${MAX_DOCAI_BUDGET_DOLLARS.toLocaleString("en-US")} a month` };
  return { ok: true, cents: Math.round(n * 100) };
}

