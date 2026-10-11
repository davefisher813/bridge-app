import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { orgEditsSharedDirectory, requireOwner } from "@/lib/auth/guard";
import { updateOrgSettings } from "@/lib/actions/org";
import { MODULE_LABEL, OPTIONAL_MODULES } from "@/lib/validation/org";
import { OrgSettingsForm } from "@/components/OrgSettingsForm";
import { createClient } from "@/lib/supabase/server";
import { loadMigrationHistory } from "@/lib/data/migrations";
import { APPLIED_LEDGER } from "@/lib/ops/appliedLedger";
import { migrationStatus, STATE_LABEL } from "@/lib/ops/migrationStatus";
import { Body, Card, Label, Notice, Screen, Section } from "@/components/kit";

// Organization Settings (audit wired F4). Admin only: the name on every
// screen and the optional modules. The org's own words for each role
// were removed on 2026-09-27: the access names are fixed (Admin, Viewer,
// Athlete) and a person's Title is set on their page under Members. The
// web address is shown, not edited, because every link and bookmark
// anybody has made points at it.
export default async function OrgSettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ notice?: string }> }) {
  const { slug } = await params;
  const { notice } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  // Who may change the shared school, coach and transfer-window directory
  // (migration 0040). Shown here so it is never a hidden setting; it is
  // read only because a change reaches every organization in the app,
  // not just this one.
  const editsDirectory = await orgEditsSharedDirectory(org.id);
  // Database Updates (live check, 2026-10-10): the repo's ledger of
  // migrations against the database's own history (migration 0057), so
  // an Admin can see a backend fix is really on. Read only.
  const status = migrationStatus(APPLIED_LEDGER, await loadMigrationHistory(await createClient()));
  const recent = status.lines.filter((l) => l.state !== "cut").slice(-5).reverse();
  const modules = OPTIONAL_MODULES.map((key) => ({ key, title: MODULE_LABEL[key].title, hint: MODULE_LABEL[key].hint, on: org.modules[key] }));

  return (
    <Screen title="Organization Settings" back={{ href: `/org/${slug}/more`, label: "More" }} lede={org.name}>
      {notice && <Notice tone="success" title={notice} />}
      <OrgSettingsForm action={updateOrgSettings.bind(null, slug)} name={org.name} modules={modules} />
      <Section label="Shared School Directory" role="place" kind="school">
        <Card isStatic>
          <Body weight="semibold">{editsDirectory ? "This Organization Can Edit It" : "Read Only Here"}</Body>
          <Label>Schools, college coaches and transfer windows are shared by every organization in the app, so this is set for the whole app, not from this screen.</Label>
        </Card>
      </Section>
      <Section label="Database Updates" count={status.applied} role="time" kind="check">
        <Card isStatic>
          <Body weight="semibold">
            {status.missing.length > 0 ? `${status.missing.length} Missing on the Database` : status.pending.length > 0 ? `${status.pending.length} Waiting to Be Applied` : "Up to Date"}
          </Body>
          <Label>
            {status.checked
              ? `${status.applied} of ${status.lines.filter((l) => l.state !== "cut").length} updates are on the database, checked against its own history just now.${status.latest ? ` The latest is ${status.latest.title}.` : ""}`
              : "The database's history could not be read just now, so this shows the repo's record only."}
          </Label>
        </Card>
        {[...status.missing, ...status.pending, ...recent.filter((l) => l.state !== "missing" && l.state !== "pending")].map((l) => (
          <Card key={l.file} isStatic>
            <Body weight="semibold">{l.title}</Body>
            <Label>{STATE_LABEL[l.state]}</Label>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
