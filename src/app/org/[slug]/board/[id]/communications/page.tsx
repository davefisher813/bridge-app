// The full contact log for one target.
//
// The target page shows the last few and a count. The count is the part
// that matters and the part you cannot act on: "9 communications" is a
// number, and "nothing since March, and the last three were all from us"
// is the thing a coordinator does something about.
//
// Visits are folded in with the emails and calls rather than kept on
// their own list. They are the same question from the coach's side, they
// are logged against the same target, and the only screen where they
// are separate is the one where they get forgotten.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { EmptyState, Label, LinkButton, Notice, Row, Screen, Section } from "@/components/kit";
import type { RowKind } from "@/components/RowGlyph";
import type { Role } from "@/components/statusHue";
import { loadTarget } from "@/lib/data/loadTarget";

export const dynamic = "force-dynamic";

// The target_communication_kind enum from migration 0004, and the
// target_visit_type enum from 0006. Both are closed sets in Postgres, so
// the fallbacks below are for a value added by a future migration and
// not yet listed here, never for a typo.
const KIND: Record<string, { label: string; kind: RowKind; role: Role }> = {
  call: { label: "Call", kind: "people", role: "contact" },
  text: { label: "Text", kind: "message", role: "contact" },
  email: { label: "Email", kind: "message", role: "contact" },
  // A communication row with kind='visit' predates the target_visits
  // table and is a bare log line with no type or impression. 0006 kept
  // them rather than migrating, so they are still here and still real.
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

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Whole days, floored. A gap is a rough measure by nature and rounding it
// up would let "27 days" print as a month.
function daysSince(iso: string, today: Date): number {
  return Math.floor((today.getTime() - new Date(iso).getTime()) / 86_400_000);
}

export default async function CommunicationsPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const bundle = await loadTarget(org.id, id);
  if (!bundle) notFound();

  type Entry = { at: string | null; label: string; detail: string | null; kind: RowKind; role: Role };

  const entries: Entry[] = [
    ...bundle.communications.map((c) => {
      const meta = KIND[c.kind] ?? KIND.other;
      return { at: c.occurred_on, label: meta.label, detail: c.notes, kind: meta.kind, role: meta.role };
    }),
    ...bundle.visits.map((v) => ({
      at: v.visit_date,
      label: VISIT_KIND[v.visit_type] ?? VISIT_KIND.other,
      detail: v.impression,
      kind: "visit" as RowKind,
      role: "visit" as Role,
    })),
  ];

  // Newest first, and anything with no date last rather than first. An
  // undated row sorting to the top would read as the most recent thing
  // that happened, which is the one thing it definitely is not.
  const dated = entries.filter((e): e is Entry & { at: string } => !!e.at).sort((a, b) => b.at.localeCompare(a.at));
  const undated = entries.filter((e) => !e.at);

  const today = new Date();
  const gap = dated.length > 0 ? daysSince(dated[0].at, today) : null;

  return (
    <Screen
      title={bundle.target.coachName ?? "Contact Log"}
      back={{ href: `/org/${slug}/board/${id}`, label: bundle.school.name }}
      lede={`${bundle.school.name} · ${bundle.athlete.name}`}
    >
      {/* The gap, said plainly, because it is the reason to open this
          screen. A count tells you how much has happened; the gap tells
          you whether anything is happening now. */}
      {gap !== null && (
        <Notice
          tone={gap > 60 ? "warning" : "info"}
          title={gap === 0 ? "Last contact today" : gap === 1 ? "Last contact yesterday" : `${gap} days since the last contact`}
        >
          {entries.length} {entries.length === 1 ? "entry" : "entries"} on file.
          {gap > 60 ? " A gap this long is usually worth a note rather than a wait." : ""}
        </Notice>
      )}

      <Section label="History" count={entries.length} role="people" kind="people">
        {entries.length === 0 ? (
          <EmptyState kind="message" title="Nothing Logged">
            Contact and a completed visit both move the fit score.
          </EmptyState>
        ) : (
          [...dated, ...undated].map((e, i) => (
            <Row
              key={i}
              kind={e.kind}
              role={e.role}
              title={e.label}
              meta={e.detail ?? undefined}
              trailing={<Label numeric>{e.at ? longDate(e.at) : "no date"}</Label>}
              wrap
            />
          ))
        )}
      </Section>

      {/* Both forms live on the edit screen, so this points there rather
          than inventing a route. A button that 404s is worse than one
          extra hop. */}
      {canEdit && <LinkButton href={`/org/${slug}/board/${id}/edit`}>Log a Contact or a Visit</LinkButton>}
    </Screen>
  );
}
