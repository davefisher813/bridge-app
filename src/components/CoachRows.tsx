import type { Coach } from "@/lib/data/coaches";
import { Row, Section, TextLink } from "@/components/kit";

// The school's coaches from the shared directory. Tapping one starts an
// email, or a call when no email is published.
//
// For an owner (`manageHref`, the school's page) the section carries an
// Edit that opens the school's coach list, where each coach is corrected
// or removed and a new one added (crud F2). A school with nobody listed
// shows no empty section; an owner gets one Add a Coach row instead, so
// the first coach has a way in. The directory is shared, so only an
// owner writes it.
export function CoachRows({ coaches, manageHref }: { coaches: Coach[]; manageHref?: string }) {
  if (coaches.length === 0) {
    if (!manageHref) return null;
    return <Row href={`${manageHref}/coaches/new`} kind="people" role="people" title="Add a Coach" meta="No coaches listed for this school yet. Every organization sees them." wrap />;
  }
  return (
    <Section label="Coaches" count={coaches.length} role="people" kind="people" action={manageHref ? <TextLink href={`${manageHref}/coaches`}>Edit</TextLink> : undefined}>
      {coaches.map((c) => (
        <Row
          key={c.id}
          href={c.email ? `mailto:${c.email}` : c.phone ? `tel:${c.phone.replace(/[^0-9+]/g, "")}` : undefined}
          kind="people"
          role="people"
          title={c.name}
          meta={[c.title, c.isRecruitingCoordinator ? "Recruiting coordinator" : null, c.email, c.phone].filter(Boolean).join(" · ") || undefined}
          wrap
        />
      ))}
    </Section>
  );
}
