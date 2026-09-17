// Every school in the shared database, and which of them this org is
// pursuing.
//
// There was a /schools/new and no /schools. You could add a school to
// the shared reference table and then never see the list you had added
// it to, which also made it easy to add a duplicate.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";

export const dynamic = "force-dynamic";

export default async function SchoolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const isOwner = user.role === "owner";

  const supabase = await createClient();
  const [{ data: schoolRows }, { data: targetRows }] = await Promise.all([
    supabase.from("schools").select("id, name, division, conference").order("name", { ascending: true }),
    supabase.from("recruiting_targets").select("school_id, status").eq("org_id", org.id),
  ]);

  const schools = (schoolRows ?? []) as Array<{ id: string; name: string; division: string | null; conference: string | null }>;
  const targets = (targetRows ?? []) as Array<{ school_id: string; status: string }>;

  const countBySchool = new Map<string, number>();
  for (const t of targets) countBySchool.set(t.school_id, (countBySchool.get(t.school_id) ?? 0) + 1);

  // Schools this org is actually pursuing first. A list of every school
  // in the database, alphabetically, buries the four that matter.
  const pursued = schools.filter((s) => countBySchool.has(s.id));
  const rest = schools.filter((s) => !countBySchool.has(s.id));

  const row = (s: (typeof schools)[number], mine: boolean) => (
    <RailCard key={s.id} role={mine ? "contact" : "target"} kind="school">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14.5px] font-bold leading-tight text-ink">{s.name}</div>
          <div className="mt-0.5 text-[12.5px] leading-tight text-muted">
            {s.division ?? "No division"}
            {s.conference ? ` · ${s.conference}` : ""}
          </div>
        </div>
        {mine && (
          <span className="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">
            {countBySchool.get(s.id)}
          </span>
        )}
      </div>
    </RailCard>
  );

  return (
    <main className="px-4 pb-24 pt-3">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="text-[22px] font-extrabold text-ink">Schools</h1>
        <span className="text-[13px] font-bold text-muted">{schools.length}</span>
      </div>

      {schools.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="school" role="neutral" className="h-7 w-7" />} title="No schools yet">
          {isOwner ? "Add the first one below." : "An owner adds schools, because the list is shared across every organization."}
        </EmptyState>
      ) : (
        <>
          {pursued.length > 0 && (
            <>
              <div className="mb-2">
                <SectionHeader label="You are recruiting here" count={pursued.length} role="contact" kind="target" />
              </div>
              <div className="mb-5 flex flex-col gap-2">{pursued.map((s) => row(s, true))}</div>
            </>
          )}
          <div className="mb-2">
            <SectionHeader label="Everything else" count={rest.length} role="target" kind="school" />
          </div>
          <div className="flex flex-col gap-2">{rest.map((s) => row(s, false))}</div>
        </>
      )}

      {/* Owner only, and through the service role, because `schools` is
          shared reference data: a wrong row here is wrong for every
          organization. Same boundary as the verified grading scales. */}
      {isOwner && (
        <Link
          href={`/org/${slug}/schools/new`}
          className="mt-5 flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[15px] font-bold text-ink"
        >
          Add a school
        </Link>
      )}
    </main>
  );
}
