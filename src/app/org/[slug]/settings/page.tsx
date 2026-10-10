import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { orgEditsSharedDirectory, requireOwner } from "@/lib/auth/guard";
import { updateOrgSettings } from "@/lib/actions/org";
import { MODULE_LABEL, OPTIONAL_MODULES } from "@/lib/validation/org";
import { OrgSettingsForm } from "@/components/OrgSettingsForm";
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
    </Screen>
  );
}
