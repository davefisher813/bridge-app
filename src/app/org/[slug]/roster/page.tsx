import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";

interface AthleteRow {
  id: string;
  name: string;
  sport: string;
  position: string | null;
  recruit_type: string;
  gpa: number | null;
  status: string;
}

const RECRUIT_TYPE_LABEL: Record<string, string> = {
  hs: "High School",
  transfer_4to4: "Transfer (4-to-4)",
  transfer_juco: "Transfer (JUCO)",
  transfer_grad: "Transfer (Grad)",
};

// First real screen against docs/DESIGN_SYSTEM.md's chassis rule: a
// plain list is full-bleed rows, not a card per athlete. No edit/create
// flow yet - see docs/ROADMAP.md; this is read-only until that exists.
export default async function RosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);

  const supabase = await createClient();
  const { data: athletes } = await supabase
    .from("athletes")
    .select("id, name, sport, position, recruit_type, gpa, status")
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .order("name");

  const rows = (athletes ?? []) as AthleteRow[];

  return (
    <main className="min-h-screen bg-bg pb-10">
      <div className="border-b border-line bg-paper px-4 py-4">
        <div className="text-[20px] font-extrabold text-ink">{org.name}</div>
        <div className="text-[12px] text-muted">Roster - signed in as {user.email}</div>
      </div>

      <div className="px-4 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[13px] font-bold uppercase tracking-[0.04em] text-muted">Athletes</div>
          <div className="text-[12px] text-muted">{rows.length}</div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-[14px] border border-line bg-paper px-4 py-8 text-center">
            <div className="text-[14px] font-semibold text-ink">No athletes yet</div>
            <p className="mt-1 text-[13px] text-muted">Adding athletes isn't built yet. See docs/ROADMAP.md.</p>
          </div>
        ) : (
          <div className="divide-y divide-line border-y border-line">
            {rows.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[15px] font-semibold text-ink">{a.name}</div>
                  <div className="text-[12px] text-muted">
                    {a.sport}
                    {a.position ? ` · ${a.position}` : ""} · {RECRUIT_TYPE_LABEL[a.recruit_type] ?? a.recruit_type}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-semibold tabular-nums text-ink">{a.gpa != null ? a.gpa.toFixed(2) : "–"}</div>
                  <div className="text-[11px] text-muted">{a.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
