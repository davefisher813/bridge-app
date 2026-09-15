import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import { Avatar, EmptyState, RailCard } from "@/components/catalog";
import { statusHue } from "@/components/statusHue";

function RosterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c1-4 4-6 7-6s6 2 7 6" strokeLinecap="round" />
    </svg>
  );
}

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
// plain list is full-bleed rows, not a card per athlete. Add/edit now
// exists (src/app/org/[slug]/roster/new, .../[id]/edit) - staff/owner
// only; members still see the read-only list.
export default async function RosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const { data: athletes } = await supabase
    .from("athletes")
    .select("id, name, sport, position, recruit_type, gpa, status")
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .order("name");

  const rows = (athletes ?? []) as AthleteRow[];

  return (
    <main>
      <div className="px-4 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[13px] font-bold uppercase tracking-[0.04em] text-muted">Athletes</div>
          <div className="flex items-center gap-3">
            <div className="text-[12px] text-muted">{rows.length}</div>
            {canEdit && (
              <Link href={`/org/${slug}/roster/new`} className="text-[12px] font-bold text-accent">
                + Add
              </Link>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<RosterIcon />} title="No athletes yet">
            {canEdit ? (
              <Link href={`/org/${slug}/roster/new`} className="font-bold text-accent">
                Add your first athlete &rarr;
              </Link>
            ) : (
              "Ask an owner or coordinator to add one."
            )}
          </EmptyState>
        ) : (
          // Catalog item C2: each athlete is a card with a rail in their
          // own status hue, rather than a hairline-divided full-bleed row.
          <div className="flex flex-col gap-2">
            {rows.map((a) => {
              const row = (
                <RailCard hue={statusHue(a.status)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar name={a.name} />
                      <div>
                        <div className="text-[15px] font-semibold text-ink">{a.name}</div>
                        <div className="text-[12px] text-muted">
                          {a.sport}
                          {a.position ? ` · ${a.position}` : ""} · {RECRUIT_TYPE_LABEL[a.recruit_type] ?? a.recruit_type}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="text-[13px] font-semibold tabular-nums text-ink">{a.gpa != null ? a.gpa.toFixed(2) : "–"}</div>
                      <StatusPill status={a.status} />
                    </div>
                  </div>
                </RailCard>
              );
              return (
                <Link key={a.id} href={`/org/${slug}/roster/${a.id}`} className="block">
                  {row}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
