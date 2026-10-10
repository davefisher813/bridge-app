// Vercel preview deployments must never touch the production database
// (backend audit F-02). Previews are built with the same environment
// variables as production unless someone sets them apart, so a preview of
// an unmerged branch could read and write Bridge's real data. Two layers:
// vercel.json builds only main, and this guard refuses every request a
// preview receives anyway, unless PREVIEW_DATABASE_OK=1 is set on purpose
// for a preview that points at a separate database.

export function previewBlocked(env: Record<string, string | undefined>): boolean {
  return env.VERCEL_ENV === "preview" && env.PREVIEW_DATABASE_OK !== "1";
}

export const PREVIEW_BLOCKED_MESSAGE = "This is a preview build. Previews do not connect to the live database. Use the live app.";
