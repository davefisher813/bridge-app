import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { DEFAULT_ROLE_LABEL } from "@/lib/org/roleLabels";
import { updateOrgSettings } from "@/lib/actions/org";
import { LABELLED_ROLES, MODULE_LABEL, OPTIONAL_MODULES } from "@/lib/validation/org";
import { OrgSettingsForm } from "@/components/OrgSettingsForm";
import { Notice, Prose, Screen } from "@/components/kit";

// What each role may do, said beside the word the org picks for it.
const ROLE_HINT: Record<(typeof LABELLED_ROLES)[number], string> = {
  owner: "Everything, plus members, schools and these settings.",
  staff: "Adds and edits records.",
  member: "Reads summaries of the program, never the records behind them.",
  family: "Sees their own athlete only.",
};

// Organization Settings (audit wired F4). Owner only: the name on every
// screen, the org's words for each role, and the optional modules. The
// web address is shown, not edited, because every link and bookmark
// anybody has made points at it.
export default async function OrgSettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ notice?: string }> }) {
  const { slug } = await params;
  const { notice } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  const roles = LABELLED_ROLES.map((role) => ({ role, label: org.roleLabels[role] ?? "", fallback: DEFAULT_ROLE_LABEL[role], hint: ROLE_HINT[role] }));
  const modules = OPTIONAL_MODULES.map((key) => ({ key, title: MODULE_LABEL[key].title, hint: MODULE_LABEL[key].hint, on: org.modules[key] }));

  return (
    <Screen title="Organization Settings" back={{ href: `/org/${slug}/more`, label: "More" }} lede={org.name}>
      {notice && <Notice tone="success" title={notice} />}
      <OrgSettingsForm action={updateOrgSettings.bind(null, slug)} name={org.name} roles={roles} modules={modules} />
      <Prose>{`Web address: /org/${org.slug}. It stays the same so every saved link keeps working.`}</Prose>
    </Screen>
  );
}
