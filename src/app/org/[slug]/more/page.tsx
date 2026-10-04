import { notFound } from "next/navigation";
import { getOrgBySlug, getOrgMemberships } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { signout } from "@/lib/auth/actions";
import { labelForRole } from "@/lib/org/roleLabels";
import { Button, ConfirmButton, Form, Label, Notice, Row, Screen, Section, Stack } from "@/components/kit";
import { PresetForm } from "@/components/PresetForm";
import { YourNameForm } from "@/components/YourNameForm";
import { DocaiBudgetForm } from "@/components/DocaiBudgetForm";
import { setDocaiBudget } from "@/lib/actions/docaiBudget";
import { isStubbedModel } from "@/lib/actions/documents";
import { createClient } from "@/lib/supabase/server";
import { dollars, loadMonthSpend } from "@/lib/data/docaiUsage";
import { recalculateAllMatches, setScoringPreset } from "@/lib/actions/matching";
import { DEFAULT_PRESET, PRESETS, type ScoringPreset } from "@/lib/fit/contract";

// Everything that isn't Today/Athletes/Board: the people, the program,
// the reference data, the matching blend, Bridge's modules, who you are,
// and the way out. Stage 5 Phase 3 made it the control center.
export default async function MorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ notice?: string; error?: string }> }) {
  const { slug } = await params;
  const { notice, error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);
  const preset = (org.scoringPreset ?? DEFAULT_PRESET) as ScoringPreset;
  const presetLabel = PRESETS[preset]?.label ?? PRESETS[DEFAULT_PRESET].label;

  // What reading documents has cost this month, against the cap. Staff
  // see the numbers; an owner sets the cap.
  const supabase = await createClient();
  const [spend, stubbed, memberships] = await Promise.all([loadMonthSpend(supabase, org.id), isStubbedModel(), getOrgMemberships()]);
  // create_org (migration 0040) refuses anyone who is staff, a member or
  // a family login anywhere, so an owner who is also one of those
  // somewhere else is not offered a door that would refuse them.
  const canStartOrg = user.role === "owner" && memberships.every((m) => m.role === "owner");

  return (
    <Screen title="More">
      {notice && (
        <Notice tone="success" title="Done">
          {notice}
        </Notice>
      )}
      {error && (
        <Notice tone="danger" title="Not Finished">
          {error}
        </Notice>
      )}
      {/* Six sections, Stage 5 Phase 3 (docs/PLAN_STAGE5.md): People,
          Program, Reference, Matching, Foundation, Organization. Foundation
          is Bridge's two modules and is left out entirely when neither is
          on (docs/STYLING_CATALOG.md: modules off are hidden from More).
          Assignments joined Program with Stage 5 Phase 4; View As joins
          Organization with the phase that builds it. A row before its
          page fails the links check. */}
      <Section label="People" role="people" kind="people">
        {user.role === "owner" && <Row href={`/org/${slug}/members`} kind="people" role="people" title="Members" wrap />}
        {canEdit && <Row href={`/org/${slug}/advisors`} kind="athlete" role="contact" title="Advisors" wrap />}
      </Section>

      <Section label="Program" role="contact" kind="checklist">
        {canEdit && <Row href={`/org/${slug}/assignments`} kind="checklist" role="contact" title="Assignments" wrap />}
        {canEdit && <Row href={`/org/${slug}/documents`} kind="document" role="place" title="Documents" wrap />}
      </Section>

      <Section label="Reference" role="place" kind="school">
        <Row href={`/org/${slug}/schools`} kind="school" role="place" title="Schools" wrap />
        <Row href={`/org/${slug}/grading-scales`} kind="scale" role="contact" title="Grading Scales" meta="How each school's numbers become letters" wrap />
        <Row href={`/org/${slug}/approved-courses`} kind="checklist" role="visit" title="Approved Lists" meta="Which courses the NCAA counts at each school" wrap />
        <Row href={`/org/${slug}/transfer-windows`} kind="clock" role="time" title="Transfer Windows" meta="When the portal opens and closes, by sport and division" wrap />
      </Section>

      {/* docs/MATCHING_CONTRACT.md section 3: the blend is a per-org
          preset, set by an owner. Recalculate All rescores everything in
          the org, which is how rows written before the store existed get
          a score. */}
      <Section label="Matching" role="place" kind="target">
        {user.role === "owner" ? (
          <Stack gap={4}>
            <PresetForm action={setScoringPreset.bind(null, slug)} current={preset} />
            <Form action={recalculateAllMatches.bind(null, slug)}>
              <Stack gap={2}>
                <ConfirmButton title="Recalculate Every Match?" body="Every athlete is rescored against every school with the numbers on file now. Nothing else changes." confirmLabel="Recalculate">
                  Recalculate All Matches
                </ConfirmButton>
              </Stack>
            </Form>
          </Stack>
        ) : (
          <Row kind="target" role="place" title="Scoring Preset" meta={`${presetLabel} · set by an Admin`} wrap />
        )}
      </Section>

      {(org.modules.donor_fundraising || org.modules.board_governance) && (
        <Section label="Foundation" role="committed" kind="money">
          {org.modules.donor_fundraising && <Row href={`/org/${slug}/fundraising`} kind="money" role="committed" title="Fundraising" wrap />}
          {org.modules.board_governance && <Row href={`/org/${slug}/board-governance`} kind="governance" role="people" title="Board" wrap />}
        </Section>
      )}

      <Section label="Organization" role="people" kind="people">
        {user.role === "owner" && <Row href={`/org/${slug}/settings`} kind="settings" role="people" title="Organization Settings" wrap />}
        {/* Who did what, org-wide (migration 0044). Admins only: the
            log is read by nobody else. */}
        {canEdit && <Row href={`/org/${slug}/activity`} kind="clock" role="time" title="Activity" wrap />}
        {/* What reading documents has cost this month, against the cap.
            Every Admin sees the number; an owner sets the cap. */}
        {canEdit && (
          <Row
            href={`/org/${slug}/doc-ai-spending`}
            kind="money"
            role={spend.exhausted ? "danger" : "contact"}
            title="Doc AI Spending"
            meta={
              stubbed
                ? "No AI model is connected yet, so reading is simulated and free."
                : `${dollars(spend.spentCents)} of ${dollars(spend.capCents)} this month · ${spend.calls} ${spend.calls === 1 ? "call" : "calls"}${spend.exhausted ? " · budget used up" : ""}`
            }
            wrap
          />
        )}
        {canEdit && (user.role === "owner" ? <DocaiBudgetForm action={setDocaiBudget.bind(null, slug)} currentCents={org.docaiBudgetCents} /> : <Label>{`Budget ${dollars(org.docaiBudgetCents)} a month · set by an Admin`}</Label>)}
        {canStartOrg && <Row href="/orgs/new" kind="org" role="place" title="Start Another Organization" wrap />}
        <Row kind="settings" role="people" title={user.full_name || user.email} meta={`${labelForRole(user.role)} at ${org.name}`} wrap />
        <YourNameForm slug={slug} returnTo={`/org/${slug}/more`} fullName={user.full_name} />
        <Form action={signout}>
          <Stack gap={2}>
            <Button variant="destructive">Sign Out</Button>
          </Stack>
        </Form>
      </Section>
    </Screen>
  );
}
