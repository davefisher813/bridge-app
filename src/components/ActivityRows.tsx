import { longDate } from "@/lib/copy/dates";
import type { ActivityAction, ActivityRow, ActivitySubjectType } from "@/lib/data/activity";
import type { RowKind } from "@/components/RowGlyph";
import type { Role } from "@/components/statusHue";
import { Body, Card, Inline, Label, Row } from "@/components/kit";
import { RowGlyph } from "@/components/RowGlyph";

// The activity log as a list (migration 0044). One entry per row: the
// summary as the title, "who · when" under it, and a glyph for what
// kind of thing it was about. Admins only; the two screens that use it
// sit behind the staff guard and no family or member screen names the
// log (src/laws/activityLaws.test.ts).
//
// An entry with somewhere to go is a Row with an href. One that has
// nowhere (a removed athlete, an assignment, a View As) is a static
// Card, a sentence rather than a record, so the clickability audit
// does not count it as a dead row.

const GLYPH: Record<ActivitySubjectType, { kind: RowKind; role: Role }> = {
  athlete: { kind: "athlete", role: "people" },
  target: { kind: "target", role: "target" },
  assignment: { kind: "checklist", role: "contact" },
  document: { kind: "document", role: "place" },
  checkin: { kind: "check", role: "contact" },
  message: { kind: "message", role: "accent" },
  member: { kind: "people", role: "people" },
  view_as: { kind: "info", role: "neutral" },
};

// These leave nothing to open: the thing they were about is gone.
const GONE: ReadonlySet<ActivityAction> = new Set(["athlete_removed", "target_removed", "member_removed", "assignment_cancelled", "document_discarded"]);

// A meta line is a sentence, so it reads "5 minutes ago". Past a week
// the date itself is clearer than "40 days ago".
export function whenLabel(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 8) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return longDate(iso.slice(0, 10));
}

// Where an entry goes, or nothing. Everything about an athlete needs
// that athlete to still be on the roster (`live`), since a removed
// athlete's pages are gone.
function hrefFor(slug: string, r: ActivityRow, live: ReadonlySet<string> | undefined, profileLinks: boolean): string | undefined {
  if (GONE.has(r.action) || !r.athleteId || !live?.has(r.athleteId)) return undefined;
  const athlete = `/org/${slug}/roster/${r.athleteId}`;
  if (r.subjectType === "checkin") return `${athlete}/checkins`;
  if (r.subjectType === "message") return `${athlete}/messages`;
  return profileLinks ? athlete : undefined;
}

export function ActivityRows({
  slug,
  rows,
  liveAthletes,
  profileLinks = true,
  now,
}: {
  slug: string;
  rows: ActivityRow[];
  // The athletes in these rows that are still on the roster. Rows about
  // anyone else read as plain entries.
  liveAthletes?: ReadonlySet<string>;
  // False on an athlete's own log, where the profile is the page you
  // came from.
  profileLinks?: boolean;
  now?: number;
}) {
  return (
    <>
      {rows.map((r) => {
        const glyph = GLYPH[r.subjectType] ?? GLYPH.athlete;
        const meta = [r.actorName ?? "Someone", whenLabel(r.createdAt, now)].filter(Boolean).join(" · ");
        const href = hrefFor(slug, r, liveAthletes, profileLinks);
        if (href) return <Row key={r.id} href={href} kind={glyph.kind} role={glyph.role} title={r.summary} meta={meta} wrap />;
        return (
          <Card key={r.id} isStatic>
            <Inline align="start">
              <RowGlyph kind={glyph.kind} role={glyph.role} />
              <div className="min-w-0 flex-1">
                <Body weight="semibold">{r.summary}</Body>
                <Label>{meta}</Label>
              </div>
            </Inline>
          </Card>
        );
      })}
    </>
  );
}
