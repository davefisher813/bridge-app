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

// Everything that isn't Today/Athletes/Board: the modules, the reference
// data, who you are, and the way out.
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
      <Section label="Work" role="contact" kind="checklist">
        {canEdit && <Row href={`/org/${slug}/documents`} kind="document" role="place" title="Documents" meta="Read a transcript or an offer letter into an athlete's record" wrap />}
        {org.modules.donor_fundraising && <Row href={`/org/${slug}/fundraising`} kind="money" role="committed" title="Fundraising" meta="Donors, gifts, pledges and the year against budget" wrap />}
        {org.modules.board_governance && <Row href={`/org/${slug}/board-governance`} kind="governance" role="people" title="Board" meta="Seats and give/get progress across every tier" wrap />}
      </Section>

      <Section label="Reference" role="place" kind="school">
        <Row href={`/org/${slug}/schools`} kind="school" role="place" title="Schools" meta="The shared database, and who you are recruiting" wrap />
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
                <Label>Use this after a big import, or if a score looks stale.</Label>
              </Stack>
            </Form>
          </Stack>
        ) : (
          <Row kind="target" role="place" title="Scoring Preset" meta={`${presetLabel} · set by an Admin`} wrap />
        )}
      </Section>

      {canEdit && (
        <Section label="Document Reading" role="contact" kind="document">
          <Row
            href={`/org/${slug}/documents`}
            kind="money"
            role={spend.exhausted ? "danger" : "contact"}
            title="This Month"
            meta={
              stubbed
                ? "No AI model is connected yet, so reading is simulated and free."
                : `${dollars(spend.spentCents)} of ${dollars(spend.capCents)} · ${spend.calls} ${spend.calls === 1 ? "call" : "calls"}${spend.exhausted ? " · budget used up" : ""}`
            }
            wrap
          />
          {user.role === "owner" ? (
            <DocaiBudgetForm action={setDocaiBudget.bind(null, slug)} currentCents={org.docaiBudgetCents} />
          ) : (
            <Label>{`Budget ${dollars(org.docaiBudgetCents)} a month · set by an Admin`}</Label>
          )}
        </Section>
      )}

      <Section label="Organization" role="people" kind="people">
        {user.role === "owner" && <Row href={`/org/${slug}/members`} kind="people" role="people" title="Members" meta="Who can sign in, and what each person can do" wrap />}
        {user.role === "owner" && <Row href={`/org/${slug}/settings`} kind="settings" role="people" title="Organization Settings" meta="The name, what you call each role, and which modules are on" wrap />}
        {canStartOrg && <Row href="/orgs/new" kind="org" role="place" title="Start Another Organization" meta="A separate organization with its own people and records" wrap />}
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
