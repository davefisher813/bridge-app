import type { Coach } from "@/lib/data/coaches";
import { Row, Section } from "@/components/kit";

// The school's coaches from the shared directory. Tapping one starts an
// email, or a call when no email is published.
export function CoachRows({ coaches }: { coaches: Coach[] }) {
  if (coaches.length === 0) return null;
  return (
    <Section label="Coaches" count={coaches.length} role="people" kind="people">
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
