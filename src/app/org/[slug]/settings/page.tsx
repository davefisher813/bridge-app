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
import { Body, Card, ConfirmButton, Form, Hidden, Label, Notice, Row, Screen, Section } from "@/components/kit";
import { AdvisorSheet } from "@/components/AdvisorSheet";
import { loadAdvisorChoices } from "@/lib/org/advisors";
import { personLabel } from "@/lib/org/roleLabels";
import { loadDocApprovers } from "@/lib/data/docApprovers";
import { APPROVER_AREAS, AREA_COVERS, AREA_LABEL, isApproverArea } from "@/lib/documents/approvers";
import { setDocApprover } from "@/lib/actions/docApprovers";

// Organization Settings (audit wired F4). Admin only: the name on every
// screen and the optional modules. The org's own words for each role
// were removed on 2026-09-27: the access names are fixed (Admin, Viewer,
// Athlete) and a person's Title is set on their page under Members. The
// web address is shown, not edited, because every link and bookmark
// anybody has made points at it.
export default async function OrgSettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ notice?: string; error?: string; undo?: string; area?: string }> }) {
  const { slug } = await params;
  const { notice, error, undo, area: undoArea } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  // Document Approvers (migration 0067, Doc AI piece 7): who signs off
  // each area before a document is treated as final. Nobody Yet means
  // any Admin marks Ready with one tap. Each change confirms, naming the
  // person and the area, is logged, and offers Undo back to whoever held
  // it (Dave's standing rule, 2026-10-06).
  const supabase = await createClient();
  const [approvers, admins] = await Promise.all([loadDocApprovers(supabase, org.id), loadAdvisorChoices(supabase, org.id)]);
  const undoTo = undo === "none" || (undo && /^[0-9a-f-]{36}$/i.test(undo)) ? undo : null;
  const undoIn = isApproverArea(undoArea) && undoTo ? undoArea : null;

  // Who may change the shared school, coach and transfer-window directory
  // (migration 0040). Shown here so it is never a hidden setting; it is
  // read only because a change reaches every organization in the app,
  // not just this one.
  const editsDirectory = await orgEditsSharedDirectory(org.id);
  // Database Updates (live check, 2026-10-10): the repo's ledger of
  // migrations against the database's own history (migration 0057), so
  // an Admin can see a backend fix is really on. Read only.
  const status = migrationStatus(APPLIED_LEDGER, await loadMigrationHistory(supabase));
  const recent = status.lines.filter((l) => l.state !== "cut").slice(-5).reverse();
  const modules = OPTIONAL_MODULES.map((key) => ({ key, title: MODULE_LABEL[key].title, hint: MODULE_LABEL[key].hint, on: org.modules[key] }));

  return (
    <Screen title="Organization Settings" back={{ href: `/org/${slug}/more`, label: "More" }} lede={org.name}>
      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}
      {notice && undoIn && (
        <Form action={setDocApprover.bind(null, slug, undoIn)}>
          <Hidden name="approverId" value={undoTo === "none" ? "" : undoTo!} />
          <ConfirmButton tone="change" title="Undo the Approver Change?" body={undoTo === "none" ? `The ${AREA_LABEL[undoIn]} goes back to Nobody Yet, and any Admin marks ${AREA_COVERS[undoIn].toLowerCase()} Ready.` : `The ${AREA_LABEL[undoIn]} goes back to who held it before.`} confirmLabel="Undo">
            Undo
          </ConfirmButton>
        </Form>
      )}
      <OrgSettingsForm action={updateOrgSettings.bind(null, slug)} name={org.name} modules={modules} />
      <Section label="Document Approvers" role="people" kind="people">
        {APPROVER_AREAS.map((area) => {
          const held = approvers[area];
          return (
            <Row
              key={area}
              kind="check"
              role={held ? "committed" : "neutral"}
              title={AREA_LABEL[area]}
              meta={`${held ? held.name : "Nobody Yet"} · ${AREA_COVERS[area]}`}
              trailingAction={
                <AdvisorSheet
                  action={setDocApprover.bind(null, slug, area)}
                  field="approverId"
                  title={AREA_LABEL[area]}
                  trigger={held ? "Change" : "Assign"}
                  searchLabel="Search Admins"
                  currentId={held?.id ?? null}
                  clearLabel={held ? "Clear Approver" : undefined}
                  choices={admins.map((a) => ({ id: a.id, title: a.name, meta: `${personLabel(a)} · ${a.email}`, keywords: a.email }))}
                  empty="Nobody here can approve yet. Invite an Admin under Members."
                  confirm={`Make {choice} the ${AREA_LABEL[area]}? Only they will mark ${AREA_COVERS[area].toLowerCase()} Ready.${held ? ` ${held.name} stops approving them.` : ""}`}
                  clearConfirm={`Clear the ${AREA_LABEL[area]}? Nobody is named, and any Admin marks ${AREA_COVERS[area].toLowerCase()} Ready.`}
                />
              }
              wrap
            />
          );
        })}
        <Label>With nobody named, any Admin marks a document Ready with one tap. Once someone is named, only they mark that area&apos;s documents Ready.</Label>
      </Section>
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
