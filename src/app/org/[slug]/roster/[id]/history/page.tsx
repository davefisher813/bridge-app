import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import { statusRole, stageKind, type Role } from "@/components/statusHue";
import type { RowKind } from "@/components/RowGlyph";
import { EmptyState, Label, LinkButton, Row, Screen, Section } from "@/components/kit";

// Every school an athlete was ever in touch with, open or closed, with
// each message, visit and offer under it. The profile keeps only what
// is live; this is the record, and it stays readable after recruiting
// ends. Dave, 2026-09-26.
//
// Staff only in Stage 1: target_communications has no family read
// policy (migrations 0010 and 0023), so the family reads its own
// Colleges screen instead.

const GROUP_ORDER = ["Committed", "Target", "In Contact", "Visit", "Offer", "Not Interested"] as const;

const KIND: Record<string, { label: string; kind: RowKind; role: Role }> = {
  call: { label: "Call", kind: "people", role: "contact" },
  text: { label: "Text", kind: "message", role: "contact" },
  email: { label: "Email", kind: "message", role: "contact" },
  visit: { label: "Visit (logged)", kind: "visit", role: "visit" },
  other: { label: "Contact", kind: "message", role: "contact" },
};

const VISIT_KIND: Record<string, string> = {
  official: "Official visit",
  unofficial: "Unofficial visit",
  junior_day: "Junior day",
  camp: "Camp",
  other: "Visit",
};

interface SchoolRow {
  id: string;
  name: string;
  division: string | null;
}

interface TargetRow {
  id: string;
  status: string;
  closed_from: string | null;
  coach_name: string | null;
  offer_type: string | null;
  offer_scholarship_percent: number | null;
  notes: string | null;
  updated_at: string | null;
  created_at: string | null;
  schools: SchoolRow | SchoolRow[] | null;
}

interface CommunicationRow {
  id: string;
  target_id: string;
  kind: string;
  occurred_on: string | null;
  notes: string | null;
}

interface VisitRow {
  id: string;
  target_id: string;
  visit_type: string;
  visit_date: string | null;
  impression: string | null;
  next_step: string | null;
}

interface Entry {
  key: string;
  at: string | null;
  label: string;
  detail: string | null;
  kind: RowKind;
  role: Role;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function groupRank(status: string): number {
  const i = (GROUP_ORDER as readonly string[]).indexOf(status);
  return i === -1 ? GROUP_ORDER.length - 1 : i;
}

function lastLine(notes: string | null): string | null {
  const lines = (notes ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

function standingMeta(t: TargetRow, school: SchoolRow | null): string {
  const parts: string[] = [];
  if (school?.division) parts.push(school.division);
  if (t.offer_type) parts.push(`${t.offer_type} offer${t.offer_scholarship_percent ? ` (${t.offer_scholarship_percent}%)` : ""}`);
  if (t.status === "Not Interested") {
    if (t.closed_from) parts.push(`Closed by the close-out, was ${t.closed_from}`);
    const note = lastLine(t.notes);
    if (note) parts.push(note);
  } else if (t.coach_name) {
    parts.push(t.coach_name);
  }
  return parts.join(" · ");
}

export default async function RecruitingHistoryPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: athlete }, { data: targetRows }] = await Promise.all([
    supabase.from("athletes").select("id, name, status").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
    supabase
      .from("recruiting_targets")
      .select("id, status, closed_from, coach_name, offer_type, offer_scholarship_percent, notes, updated_at, created_at, schools(id, name, division)")
      .eq("athlete_id", id)
      .eq("org_id", org.id),
  ]);
  if (!athlete) notFound();

  const targets = ((targetRows ?? []) as TargetRow[])
    .map((t) => ({ ...t, school: unwrap(t.schools) }))
    .sort((a, b) => groupRank(a.status) - groupRank(b.status) || (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""));
  const targetIds = targets.map((t) => t.id);

  const [{ data: commRows }, { data: visitRows }] = targetIds.length
    ? await Promise.all([
        supabase.from("target_communications").select("id, target_id, kind, occurred_on, notes").in("target_id", targetIds).eq("org_id", org.id),
        supabase.from("target_visits").select("id, target_id, visit_type, visit_date, impression, next_step").in("target_id", targetIds).eq("org_id", org.id),
      ])
    : [{ data: [] }, { data: [] }];

  const entriesByTarget = new Map<string, Entry[]>();
  const push = (targetId: string, e: Entry) => entriesByTarget.set(targetId, [...(entriesByTarget.get(targetId) ?? []), e]);
  for (const c of (commRows ?? []) as CommunicationRow[]) {
    const meta = KIND[c.kind] ?? KIND.other;
    push(c.target_id, { key: `c-${c.id}`, at: c.occurred_on, label: meta.label, detail: c.notes, kind: meta.kind, role: meta.role });
  }
  for (const v of (visitRows ?? []) as VisitRow[]) {
    const detail = [v.impression, v.next_step ? `Next: ${v.next_step}` : null].filter(Boolean).join(" · ") || null;
    push(v.target_id, { key: `v-${v.id}`, at: v.visit_date, label: VISIT_KIND[v.visit_type] ?? VISIT_KIND.other, detail, kind: "visit", role: "visit" });
  }

  const ordered = (entries: Entry[]): Entry[] => {
    const dated = entries.filter((e): e is Entry & { at: string } => !!e.at).sort((a, b) => b.at.localeCompare(a.at));
    return [...dated, ...entries.filter((e) => !e.at)];
  };

  const profile = `/org/${slug}/roster/${id}`;

  return (
    <Screen title="Recruiting History" back={{ href: profile, label: athlete.name }} lede={`${targets.length} ${targets.length === 1 ? "school" : "schools"}, open or closed, with every message, visit and offer.`}>
      {targets.length === 0 ? (
        <EmptyState kind="school" title="No Recruiting History Yet" action={canEdit ? <LinkButton href={`/org/${slug}/schools`}>Open Schools</LinkButton> : undefined}>
          {canEdit ? "Nothing has been logged against a school for this athlete." : "Schools show up here once an Admin logs one."}
        </EmptyState>
      ) : (
        targets.map((t) => {
          const entries = ordered(entriesByTarget.get(t.id) ?? []);
          return (
            <Section key={t.id} label={t.school?.name ?? "Unknown School"} count={entries.length} role={statusRole(t.status)} kind={stageKind(t.status)}>
              <Row href={`/org/${slug}/board/${t.id}`} kind="school" role={statusRole(t.status)} title="Where Things Stand" meta={standingMeta(t, t.school)} trailing={<StatusPill status={t.status} />} wrap />
              {entries.map((e) => (
                <Row
                  key={e.key}
                  href={`/org/${slug}/board/${t.id}/communications`}
                  kind={e.kind}
                  role={e.role}
                  title={e.label}
                  meta={e.detail ?? undefined}
                  trailing={<Label numeric>{e.at ? longDate(e.at) : "no date"}</Label>}
                  wrap
                />
              ))}
            </Section>
          );
        })
      )}
    </Screen>
  );
}
