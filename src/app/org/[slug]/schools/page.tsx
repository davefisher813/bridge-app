// Every school in the shared database, and which of them this org is
// pursuing.
//
// There was a /schools/new and no /schools. You could add a school to
// the shared reference table and then never see the list you had added
// it to, which also made it easy to add a duplicate.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { AddButton, Body, EmptyState, LinkButton, Notice, Row, Screen, Section, Stack } from "@/components/kit";
import { SearchField } from "@/components/SearchField";

export const dynamic = "force-dynamic";

export default async function SchoolsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ imported?: string; q?: string }> }) {
  const { slug } = await params;
  const { imported, q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim().toLowerCase();
  const importedCount = imported ? Number(imported) : 0;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const isOwner = user.role === "owner";

  const supabase = await createClient();
  const [{ data: schoolRows }, { data: targetRows }] = await Promise.all([
    supabase.from("schools").select("id, name, division, conference").order("name", { ascending: true }),
    supabase.from("recruiting_targets").select("school_id, status").eq("org_id", org.id),
  ]);

  const allSchools = (schoolRows ?? []) as Array<{ id: string; name: string; division: string | null; conference: string | null }>;
  // Name, division or conference. The hundreds of schools a real import
  // brings in need a way to find one.
  const schools = q ? allSchools.filter((s) => `${s.name} ${s.division ?? ""} ${s.conference ?? ""}`.toLowerCase().includes(q)) : allSchools;
  const targets = (targetRows ?? []) as Array<{ school_id: string; status: string }>;

  const countBySchool = new Map<string, number>();
  for (const t of targets) countBySchool.set(t.school_id, (countBySchool.get(t.school_id) ?? 0) + 1);

  // Schools this org is actually pursuing first. A list of every school
  // in the database, alphabetically, buries the four that matter.
  const pursued = schools.filter((s) => countBySchool.has(s.id));
  const rest = schools.filter((s) => !countBySchool.has(s.id));

  const row = (s: (typeof schools)[number], mine: boolean) => (
    <Row
      key={s.id}
      href={`/org/${slug}/schools/${s.id}`}
      kind="school"
      role={mine ? "contact" : "target"}
      title={s.name}
      meta={`${s.division ?? "No division"}${s.conference ? ` · ${s.conference}` : ""}`}
      trailing={
        mine ? (
          <Body weight="bold" numeric>
            {countBySchool.get(s.id)}
          </Body>
        ) : undefined
      }
    />
  );

  return (
    <Screen title="Schools" action={isOwner ? <AddButton href={`/org/${slug}/schools/new`} label="Add" /> : undefined}>
      {importedCount > 0 && (
        <Notice tone="success" title={`${importedCount} ${importedCount === 1 ? "School" : "Schools"} Imported`}>
          Every athlete on the roster has been scored against them. Open one to check the numbers landed.
        </Notice>
      )}
      {(allSchools.length > 5 || q) && <SearchField initial={q} placeholder="A school, a division or a conference" />}
      {schools.length === 0 ? (
        <EmptyState kind="school" title={q ? "No School Matches" : "No Schools Yet"}>
          {q ? "Try part of the name, or clear the search." : isOwner ? "Add the first one below." : "An owner adds schools, because the list is shared across every organization."}
        </EmptyState>
      ) : (
        <>
          {pursued.length > 0 && (
            <Section label="You Are Recruiting Here" count={pursued.length} role="contact" kind="target">
              {pursued.map((s) => row(s, true))}
            </Section>
          )}
          {rest.length > 0 && (
            <Section label="Everything Else" count={rest.length} role="place" kind="school">
              {rest.map((s) => row(s, false))}
            </Section>
          )}
        </>
      )}

      {/* Owner only, and through the service role, because `schools` is
          shared reference data: a wrong row here is wrong for every
          organization. Same boundary as the verified grading scales. */}
      {isOwner && (
        <Stack gap={3}>
          <LinkButton href={`/org/${slug}/schools/new`} variant="secondary">
            Add a School
          </LinkButton>
          <Row href={`/org/${slug}/schools/import`} kind="document" role="place" title="Import from a Spreadsheet" meta="A CSV from the template, every row checked before anything lands" wrap />
        </Stack>
      )}
    </Screen>
  );
}
