// Every school in the shared database, and which of them this org is
// pursuing.
//
// There was a /schools/new and no /schools. You could add a school to
// the shared reference table and then never see the list you had added
// it to, which also made it easy to add a duplicate.
//
// The list itself (search, filters, A to Z) is src/components/
// SchoolDirectory.tsx, shared with the family and member directories.
// What is here and not there is the org's own side: the schools it is
// recruiting at, and a directory editor's Add and Import.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { isDirectoryEditor, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { AddButton, Body, LinkButton, Notice, Row, Screen, Section, Stack } from "@/components/kit";
import { SchoolDirectory } from "@/components/SchoolDirectory";
import { loadDirectory } from "@/lib/data/schoolDirectory";

export const dynamic = "force-dynamic";

export default async function SchoolsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ imported?: string; q?: string; division?: string; state?: string; conference?: string; major?: string; notice?: string }> }) {
  const { slug } = await params;
  const { imported, q, division, state, conference, major, notice } = await searchParams;
  const importedCount = imported ? Number(imported) : 0;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  // Add and Import write the shared directory, so they show only to a
  // directory editor (migration 0040). An owner of any other org reads
  // the list the way staff do.
  const canEditDirectory = await isDirectoryEditor(user);
  const viewer = canEditDirectory ? "owner" : user.role === "owner" ? "staff" : user.role;
  const base = `/org/${slug}/schools`;

  const supabase = await createClient();
  const [directory, { data: targetRows }] = await Promise.all([loadDirectory(supabase, { q, division, state, conference, major }), supabase.from("recruiting_targets").select("school_id, status, athletes(deleted_at)").eq("org_id", org.id)]);
  // A removed athlete's targets stay on file but count for nothing here,
  // the same as on the school page and the board.
  type TargetCount = { school_id: string; status: string; athletes: { deleted_at: string | null } | { deleted_at: string | null }[] | null };
  const onRoster = (t: TargetCount) => {
    const a = Array.isArray(t.athletes) ? (t.athletes[0] ?? null) : t.athletes;
    return !a?.deleted_at;
  };
  const targets = ((targetRows ?? []) as TargetCount[]).filter(onRoster);

  const countBySchool = new Map<string, number>();
  for (const t of targets) countBySchool.set(t.school_id, (countBySchool.get(t.school_id) ?? 0) + 1);

  // Schools this org is actually pursuing first. A list of every school
  // in the database, alphabetically, buries the four that matter.
  const pursued = directory.rows.filter((s) => countBySchool.has(s.id));
  // The A to Z below is everything else, as it was before the directory:
  // a school already listed above is not listed twice.
  const rest = directory.groups.map((g) => ({ ...g, rows: g.rows.filter((s) => !countBySchool.has(s.id)) })).filter((g) => g.rows.length > 0);

  return (
    <Screen title="Schools" action={canEditDirectory ? <AddButton href={`${base}/new`} label="Add" /> : undefined}>
      {notice && (
        // Remove School lands here (audit crud F3).
        <Notice tone="success" title="Done">
          {notice}
        </Notice>
      )}
      {importedCount > 0 && (
        <Notice tone="success" title={`${importedCount} ${importedCount === 1 ? "School" : "Schools"} Imported`}>
          Every athlete on the roster has been scored against them. Open one to check the numbers landed.
        </Notice>
      )}
      <SchoolDirectory base={base} viewer={viewer} filters={directory.filters} options={directory.options} groups={rest} listedAbove={pursued.length > 0} total={directory.total}>
        {pursued.length > 0 && (
          <Section label="You Are Recruiting Here" count={pursued.length} role="contact" kind="target">
            {pursued.map((s) => (
              <Row
                key={s.id}
                href={`${base}/${s.id}`}
                kind="school"
                role="contact"
                title={s.name}
                meta={[s.division ?? "No division", s.conference, s.location ?? s.state].filter(Boolean).join(" · ")}
                trailing={
                  <Body weight="bold" numeric>
                    {countBySchool.get(s.id)}
                  </Body>
                }
              />
            ))}
          </Section>
        )}
      </SchoolDirectory>

      {/* Directory editors only, and through the service role, because
          `schools` is shared reference data: a wrong row here is wrong
          for every organization. Same boundary as the verified grading
          scales. */}
      {canEditDirectory && (
        <Stack gap={3}>
          <LinkButton href={`${base}/new`} variant="secondary">
            Add a School
          </LinkButton>
          <Row href={`${base}/import`} kind="document" role="place" title="Import from a Spreadsheet" meta="A CSV from the template, every row checked before anything lands" wrap />
        </Stack>
      )}
    </Screen>
  );
}
