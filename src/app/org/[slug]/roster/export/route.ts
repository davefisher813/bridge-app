import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { loadAdvisorChoices } from "@/lib/org/advisors";
import { parseBulkIds } from "@/lib/bulk/ids";
import { gradYearOf, rosterCsv, type RosterCsvRow } from "@/lib/bulk/csv";
import { orgToday } from "@/lib/datetime/today";
import { effectiveStatus, placementAthlete } from "@/lib/placement";

// The selected athletes as a CSV: /org/<slug>/roster/export?ids=a,b,c
// (200 at most). Staff only, read with the caller's own session and
// scoped by org_id AND the ids, so an id from another org is not there to
// export. The columns are the roster's own (name, sport, position,
// status, recruit type, GPA) plus the graduation year when stored and the
// advisor's name. No guardian or contact data, no notes, no ids.
//
// Anyone who is not staff of the org gets the same 404, as the document
// download does.
const RECRUIT_TYPE_LABEL: Record<string, string> = {
  hs: "High School",
  transfer_4to4: "Transfer (4-to-4)",
  transfer_juco: "Transfer (JUCO)",
  transfer_grad: "Transfer (Grad)",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const org = await getOrgBySlug(slug);
  if (!org) return notFound();
  const user = await getCurrentUser(org.id);
  if (!user || !STAFF_ROLES.includes(user.role)) return notFound();

  const fd = new FormData();
  for (const id of (new URL(request.url).searchParams.get("ids") ?? "").split(",")) fd.append("ids", id);
  const parsed = parseBulkIds(fd);
  if (!parsed.ok) return new NextResponse(parsed.error, { status: 400, headers: { "Cache-Control": "no-store" } });

  const supabase = await createClient();
  const [{ data }, { data: committed }, advisors] = await Promise.all([
    supabase.from("athletes").select("id, name, sport, position, recruit_type, gpa, status, detail, advisor_id, draft_team, draft_round, draft_year").eq("org_id", org.id).in("id", parsed.ids).is("deleted_at", null).order("name"),
    supabase.from("recruiting_targets").select("id, athlete_id, status, schools(name)").eq("org_id", org.id).eq("status", "Committed").in("athlete_id", parsed.ids),
    loadAdvisorChoices(supabase, org.id),
  ]);

  const advisorName = new Map(advisors.map((a) => [a.id, a.name]));
  const commitsOf = new Map<string, { id: string; status: string; schoolName: string | null }[]>();
  for (const t of (committed ?? []) as { id: string; athlete_id: string; status: string; schools: { name: string } | { name: string }[] | null }[]) {
    const school = Array.isArray(t.schools) ? t.schools[0] : t.schools;
    commitsOf.set(t.athlete_id, [...(commitsOf.get(t.athlete_id) ?? []), { id: t.id, status: t.status, schoolName: school?.name ?? null }]);
  }

  const rows: RosterCsvRow[] = ((data ?? []) as { id: string; name: string; sport: string; position: string | null; recruit_type: string; gpa: number | null; status: string; detail: unknown; advisor_id: string | null; draft_team: string | null; draft_round: number | null; draft_year: number | null }[]).map((a) => ({
    name: a.name,
    sport: a.sport,
    position: a.position,
    status: effectiveStatus(placementAthlete(a), commitsOf.get(a.id) ?? []),
    recruitType: RECRUIT_TYPE_LABEL[a.recruit_type] ?? a.recruit_type,
    gradYear: gradYearOf(a.detail),
    advisor: a.advisor_id ? (advisorName.get(a.advisor_id) ?? null) : null,
    gpa: a.gpa,
  }));

  const day = orgToday();
  return new NextResponse(rosterCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="athletes-${day}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
