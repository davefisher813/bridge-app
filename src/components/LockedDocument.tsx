import { Body, Inline, Label, Screen, Section, Stack } from "@/components/kit";
import { LifecycleChip } from "@/components/LifecycleChip";
import { LOCKED_OPENERS, LOCKED_TITLE, type LockedDoc } from "@/lib/data/lockedDocuments";
import { isLifecycle, type Lifecycle } from "@/lib/vault/lifecycle";

// The page for a document this Admin cannot open (migration 0078, design
// A). It says what the database said and no more: the state and the date.
// The name, the type and the athlete were never sent, so each reads Hidden
// and there is no file, no download and nothing to change. Who can open
// the document is named by role, never by person. The facts are plain
// lines, not record rows: there is nowhere for them to go.
export function LockedDocumentScreen({ slug, doc }: { slug: string; doc: LockedDoc }) {
  const lifecycle = (isLifecycle(doc.lifecycle) ? doc.lifecycle : "needs_review") as Lifecycle;
  const added = new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <Screen title={LOCKED_TITLE} back={{ href: `/org/${slug}/documents`, label: "Documents" }} lede={`You cannot open this file. Only ${LOCKED_OPENERS} can.`}>
      <Section label="What You Can See" kind="lock" role="neutral">
        <Stack gap={3}>
          <Inline gap={3}>
            <Label>State</Label>
            <LifecycleChip lifecycle={lifecycle} />
          </Inline>
          <Inline gap={3}>
            <Label>Added</Label>
            <Body>{added}</Body>
          </Inline>
          <Inline gap={3}>
            <Label>Name</Label>
            <Body tone="muted">Hidden</Body>
          </Inline>
          <Inline gap={3}>
            <Label>Type</Label>
            <Body tone="muted">Hidden</Body>
          </Inline>
          <Inline gap={3}>
            <Label>Athlete</Label>
            <Body tone="muted">Hidden</Body>
          </Inline>
        </Stack>
      </Section>
    </Screen>
  );
}
