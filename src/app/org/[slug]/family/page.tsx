import { notFound, redirect } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { loadFamilyAthletes, requireFamily } from "@/lib/data/family";
import { Chevron, EmptyState, Prose, Row, Screen } from "@/components/kit";

// Home for a family login. One athlete: straight to them, nothing to
// explain (Dave's pick, 2026-09-21). More than one: pick which. None:
// the invite was made without a link, which staff fix by re-inviting.
export default async function FamilyHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const athletes = await loadFamilyAthletes(org.id, user.id);

  if (athletes.length === 1) redirect(`/org/${slug}/family/${athletes[0]!.id}`);

  return (
    <Screen title="Your Athletes">
      {athletes.length === 0 ? (
        <EmptyState kind="athlete" title="Nothing Linked Yet">
          Ask {org.name} to send the invitation again.
        </EmptyState>
      ) : (
        athletes.map((a) => (
          <Row
            key={a.id}
            href={`/org/${slug}/family/${a.id}`}
            kind="athlete"
            role="people"
            title={a.name}
            meta={`${a.sport}${a.position ? ` · ${a.position}` : ""}`}
            trailing={<Chevron />}
          />
        ))
      )}
      <Prose>Each record is read only here. To change anything on it, ask {org.name}.</Prose>
    </Screen>
  );
}
