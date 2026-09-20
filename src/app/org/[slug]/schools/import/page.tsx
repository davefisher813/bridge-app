import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { importSchools } from "@/lib/actions/schools";
import { SchoolImportForm } from "@/components/SchoolImportForm";
import { SCHOOL_CSV_REQUIRED_COLUMNS } from "@/lib/schools/csv";
import { Label, LinkButton, Notice, Screen, Section, Stack } from "@/components/kit";

// The CSV door into the shared schools table. Owner-only, like every
// other write to it. docs/MATCHING_CONTRACT.md section 4: a template,
// required columns, problems listed by row, nothing half-imports; the
// coach columns land on this org's private overlay, not the shared row.
export default async function ImportSchoolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  const action = importSchools.bind(null, slug);

  return (
    <Screen title="Import Schools" back={{ href: `/org/${slug}/schools`, label: "Schools" }} lede="A spreadsheet in, every school scored against every athlete out.">
      <Section label="The Template" role="place" kind="document">
        <Stack gap={3}>
          <Label>Open the template, fill one row per school, and export it as CSV. A school already on file with the same name is updated, not duplicated.</Label>
          <LinkButton href="/templates/schools.csv" variant="secondary">
            Download the Template
          </LinkButton>
          <Label>{`Required on every row: ${SCHOOL_CSV_REQUIRED_COLUMNS.join(", ")}. Merit and need aid are required for D3.`}</Label>
        </Stack>
      </Section>

      <Section label="Import" role="accent" kind="school">
        <SchoolImportForm action={action} />
        <Notice tone="info" title="Head Coach and Email Stay Private">
          The coach columns go on your organization&apos;s notes for each school. Every other column is shared with every organization.
        </Notice>
      </Section>
    </Screen>
  );
}
