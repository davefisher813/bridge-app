import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { updateOrgSettings } from "@/lib/actions/org";
import { MODULE_LABEL, OPTIONAL_MODULES } from "@/lib/validation/org";
import { OrgSettingsForm } from "@/components/OrgSettingsForm";
import { Notice, Prose, Screen } from "@/components/kit";

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

  const modules = OPTIONAL_MODULES.map((key) => ({ key, title: MODULE_LABEL[key].title, hint: MODULE_LABEL[key].hint, on: org.modules[key] }));

  return (
    <Screen title="Organization Settings" back={{ href: `/org/${slug}/more`, label: "More" }} lede={org.name}>
      {notice && <Notice tone="success" title={notice} />}
      <OrgSettingsForm action={updateOrgSettings.bind(null, slug)} name={org.name} modules={modules} />
      <Prose>{`Web address: /org/${org.slug}. It stays the same so every saved link keeps working.`}</Prose>
    </Screen>
  );
}
