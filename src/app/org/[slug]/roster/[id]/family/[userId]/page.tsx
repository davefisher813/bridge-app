import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { linkGuardian, unlinkGuardian, updateGuardianRelationship } from "@/lib/actions/guardians";
import { RELATIONSHIPS, relationshipLabel } from "@/lib/copy/relationships";
import { Avatar, Button, Chevron, ConfirmButton, EmptyState, Form, Hidden, Notice, Row, Screen, Section, SelectField, TextLink } from "@/components/kit";

// One family login's link to one athlete (audit crud F7), opened from the
// Family section of the athlete page. Staff and owners fix who the person
// is to the athlete, unlink them from this athlete alone (their other
// children stay linked), or link them to another athlete in the org
// without a second invite. Removing the sign-in itself is an owner's job
// under Members, and an owner gets a link there.

interface LinkRow {
  athlete_id: string;
  relationship: string | null;
}

export default async function FamilyLinkPage({ params, searchParams }: { params: Promise<{ slug: string; id: string; userId: string }>; searchParams?: Promise<{ notice?: string; error?: string }> }) {
  const { slug, id, userId } = await params;
  const { notice, error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athlete }, { data: linkRows }, { data: person }, { data: athleteRows }] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
    supabase.from("athlete_guardians").select("athlete_id, relationship").eq("org_id", org.id).eq("user_id", userId),
    supabase.from("users").select("id, email, full_name").eq("id", userId).maybeSingle(),
    supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
  ]);
  if (!athlete) notFound();
  const links = (linkRows ?? []) as LinkRow[];
  const here = links.find((l) => l.athlete_id === id);
  if (!here || !person) notFound();

  const who = (person as { email: string; full_name: string | null }).full_name?.trim() || (person as { email: string }).email;
  const email = (person as { email: string }).email;
  const athletes = (athleteRows ?? []) as { id: string; name: string }[];
  const nameOf = new Map(athletes.map((a) => [a.id, a.name]));
  const others = links.filter((l) => l.athlete_id !== id && nameOf.has(l.athlete_id));
  const linkable = athletes.filter((a) => !links.some((l) => l.athlete_id === a.id));
  const self = `/org/${slug}/roster/${id}/family/${userId}`;

  return (
    <Screen
      title={who}
      back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }}
      lede={`${relationshipLabel(here.relationship)} of ${athlete.name} · ${email}`}
      action={user.role === "owner" ? <TextLink href={`/org/${slug}/members/${userId}`}>Member Page</TextLink> : undefined}
    >
      {notice && (
        <Notice tone="success" title="Done">
          {notice}
        </Notice>
      )}
      {error && (
        <Notice tone="danger" title="Not Saved">
          {error}
        </Notice>
      )}

      <Section label="Who They Are" role="people" kind="people">
        <Form action={updateGuardianRelationship.bind(null, slug, id, userId)}>
          <Hidden name="returnTo" value={self} />
          <SelectField name="relationship" label={`To ${athlete.name}`} defaultValue={here.relationship ?? "parent"}>
            {RELATIONSHIPS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </SelectField>
          <Button variant="secondary">Save</Button>
        </Form>
      </Section>

      <Section label="Also Sees" count={others.length} role="people" kind="people">
        {others.length === 0 ? (
          <EmptyState kind="people" title="Only This Athlete" />
        ) : (
          others.map((l) => (
            <Row
              key={l.athlete_id}
              href={`/org/${slug}/roster/${l.athlete_id}/family/${userId}`}
              leading={<Avatar name={nameOf.get(l.athlete_id) ?? "Athlete"} />}
              title={nameOf.get(l.athlete_id) ?? "Athlete"}
              meta={relationshipLabel(l.relationship)}
              trailing={<Chevron />}
            />
          ))
        )}
        {linkable.length > 0 && (
          <Form action={linkGuardian.bind(null, slug, userId)}>
            <Hidden name="returnTo" value={self} />
            <Hidden name="fromAthleteId" value={id} />
            <SelectField id="linkAthleteId" name="athleteId" label="Link Another Athlete" defaultValue="">
              <option value="">Pick an Athlete</option>
              {linkable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </SelectField>
            <SelectField id="linkRelationship" name="relationship" label="Who They Are to Them" defaultValue={here.relationship ?? "parent"}>
              {RELATIONSHIPS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </SelectField>
            <Button variant="secondary">Link Athlete</Button>
          </Form>
        )}
      </Section>

      <Form action={unlinkGuardian.bind(null, slug, id, userId)}>
        <Hidden name="returnTo" value={`/org/${slug}/roster/${id}`} />
        <ConfirmButton title={`Unlink from ${athlete.name}?`} body={`${who} stops seeing ${athlete.name}. Their sign-in and any other athletes they see stay as they are.`} confirmLabel="Unlink">
          {`Unlink from ${athlete.name}`}
        </ConfirmButton>
      </Form>
    </Screen>
  );
}
