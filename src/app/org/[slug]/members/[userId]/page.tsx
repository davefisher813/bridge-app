import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner, type OrgRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { labelForRole } from "@/lib/org/roleLabels";
import { ORG_ROLES } from "@/lib/validation/member";
import { RELATIONSHIPS, relationshipLabel } from "@/lib/copy/relationships";
import { assignAdvisorForm, changeMemberRoleForm, removeMemberForm, renameMemberForm, unassignAdvisorForm } from "@/lib/actions/members";
import { linkGuardian, unlinkGuardian, updateGuardianRelationship } from "@/lib/actions/guardians";
import { Avatar, Button, Card, CheckField, Chevron, ConfirmButton, EmptyState, Field, Form, Hidden, Notice, Option, Prose, Row, Screen, Section, SelectField, Stack } from "@/components/kit";

interface MemberRow {
  user_id: string;
  role: string;
  created_at: string;
  users: { email: string; full_name: string; last_sign_in_at: string | null } | { email: string; full_name: string; last_sign_in_at: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// What each role may do, in the org's own words for the role.
const ROLE_BLURB: Record<OrgRole, string> = {
  owner: "Everything, plus members and schools",
  staff: "Adds and edits records",
  member: "Read only",
  family: "One athlete, read only",
};

interface GuardianRow {
  athlete_id: string;
  relationship: string | null;
  athletes: { name: string; deleted_at?: string | null } | { name: string; deleted_at?: string | null }[] | null;
}

interface AthleteRow {
  id: string;
  name: string;
  advisor_id: string | null;
}

// One person in the org, owner only. Everything about them can be fixed
// here without removing them: their name (audit crud F17), their role
// in place, family included (F23), which athletes a family login sees
// (F7, the member-page side), and which athletes a staff member advises
// (F18). Removing them is last, behind a confirm.
export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; userId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { slug, userId } = await params;
  const { notice, error } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const me = await requireOwner(org.id);

  const supabase = await createClient();
  const [{ data: row }, { data: ownerRows }, { data: guardianRows }, { data: athleteRows }, { data: staffRows }] = await Promise.all([
    supabase
      .from("org_members")
      .select("user_id, role, created_at, users(email, full_name, last_sign_in_at)")
      .eq("org_id", org.id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("org_members").select("user_id").eq("org_id", org.id).eq("role", "owner"),
    supabase.from("athlete_guardians").select("athlete_id, relationship, athletes(name, deleted_at)").eq("org_id", org.id).eq("user_id", userId),
    supabase.from("athletes").select("id, name, advisor_id").eq("org_id", org.id).is("deleted_at", null).order("name", { ascending: true }),
    supabase.from("org_members").select("user_id, users(email, full_name)").eq("org_id", org.id).in("role", ["owner", "staff"]),
  ]);
  if (!row) notFound();
  // A removed athlete's link stays on file but is not shown: the family
  // sees nothing of them, and their roster page is gone.
  const linked = ((guardianRows ?? []) as GuardianRow[]).filter((g) => !unwrap(g.athletes)?.deleted_at).map((g) => ({ id: g.athlete_id, relationship: g.relationship, name: unwrap(g.athletes)?.name ?? "Unknown athlete" }));
  const athletes = (athleteRows ?? []) as AthleteRow[];
  const staffName = new Map(
    ((staffRows ?? []) as { user_id: string; users: { email: string; full_name: string | null } | { email: string; full_name: string | null }[] | null }[]).map((s) => {
      const u = unwrap(s.users);
      return [s.user_id, u?.full_name || u?.email || "Someone"];
    }),
  );

  const member = row as MemberRow;
  const role = member.role as OrgRole;
  const person = unwrap(member.users);
  const name = person?.full_name || person?.email || "Unknown";
  const ownerCount = (ownerRows ?? []).length;
  const onlyOwner = role === "owner" && ownerCount === 1;
  const isMe = member.user_id === me.id;
  const ownerLabel = labelForRole(org.roleLabels, "owner");
  const familyLabel = labelForRole(org.roleLabels, "family");
  const here = `/org/${slug}/members/${member.user_id}`;

  const joined = person?.last_sign_in_at ? `joined ${new Date(member.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "invited, not signed in yet";

  const linkedIds = new Set(linked.map((a) => a.id));
  const linkable = athletes.filter((a) => !linkedIds.has(a.id));
  const advises = athletes.filter((a) => a.advisor_id === member.user_id);
  const assignable = athletes.filter((a) => a.advisor_id !== member.user_id);
  const canAdvise = role === "owner" || role === "staff";

  const athleteOptions = (list: AthleteRow[] | { id: string; name: string }[]) =>
    list.map((a) => (
      <option key={a.id} value={a.id}>
        {a.name}
      </option>
    ));
  const relationshipOptions = RELATIONSHIPS.map((r) => (
    <option key={r.value} value={r.value}>
      {r.label}
    </option>
  ));

  return (
    <Screen back={{ href: `/org/${slug}/members`, label: "Members" }}>
      <Row leading={<Avatar name={name} size="lg" />} title={`${name}${isMe ? " (you)" : ""}`} meta={`${person?.email ?? ""} · ${joined}`} emphasis="bold" wrap />

      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}

      <Section label="Name" role="people" kind="people">
        <Form action={renameMemberForm.bind(null, slug, member.user_id)}>
          <Stack gap={3}>
            <Field name="fullName" label="Full Name" defaultValue={person?.full_name ?? ""} autoComplete="off" maxLength={120} hint="Shown on every athlete they advise, and to athlete logins. Left blank, their email shows." />
            <Button variant="secondary">Save Name</Button>
          </Stack>
        </Form>
      </Section>

      {role === "family" && (
        <Section label="Sees" count={linked.length} role="people" kind="athlete">
          {linked.map((a) => (
            <Stack key={a.id} gap={2}>
              <Row href={`/org/${slug}/roster/${a.id}`} kind="athlete" role="people" title={a.name} meta={`${familyLabel} · ${relationshipLabel(a.relationship)}`} trailing={<Chevron />} />
              <Form action={updateGuardianRelationship.bind(null, slug, a.id, member.user_id)}>
                <Stack gap={3}>
                  <Hidden name="returnTo" value={here} />
                  <SelectField id={`relationship-${a.id}`} name="relationship" label="Who They Are" defaultValue={a.relationship ?? "parent"}>
                    {relationshipOptions}
                  </SelectField>
                  <Button variant="secondary">Save Relationship</Button>
                </Stack>
              </Form>
              <Form action={unlinkGuardian.bind(null, slug, a.id, member.user_id)}>
                <Hidden name="returnTo" value={here} />
                <ConfirmButton title={`Unlink ${a.name}?`} body={`${name} stops seeing ${a.name}. Their sign-in and any other athletes they see stay.`} confirmLabel="Unlink" inline>
                  Unlink
                </ConfirmButton>
              </Form>
            </Stack>
          ))}
          {linked.length === 0 && (
            <Card>
              <Prose>Linked to no athlete, so they see nothing. Link one below, or remove them.</Prose>
            </Card>
          )}
          {linkable.length > 0 && (
            <Form action={linkGuardian.bind(null, slug, member.user_id)}>
              <Stack gap={3}>
                <Hidden name="returnTo" value={here} />
                <SelectField id="link-athlete" name="athleteId" label="Link Another Athlete" defaultValue="" required>
                  <option value="" disabled>
                    Pick an Athlete
                  </option>
                  {athleteOptions(linkable)}
                </SelectField>
                <SelectField id="link-relationship" name="relationship" label="Who They Are" defaultValue="parent">
                  {relationshipOptions}
                </SelectField>
                <Button variant="secondary">Link Athlete</Button>
              </Stack>
            </Form>
          )}
        </Section>
      )}

      <Section label="Role" role="people" kind="people">
        {role === "family" ? (
          <Form action={changeMemberRoleForm.bind(null, slug, member.user_id)}>
            <Stack gap={3}>
              <Hidden name="confirmed" value="yes" />
              <SelectField name="role" label="Change Their Role" defaultValue="member">
                {ORG_ROLES.filter((r) => r !== "family").map((r) => (
                  <option key={r} value={r}>
                    {`${labelForRole(org.roleLabels, r)}: ${ROLE_BLURB[r]}`}
                  </option>
                ))}
              </SelectField>
              <ConfirmButton
                title={`Change ${name}'s Role?`}
                body={linked.length > 0 ? `They stop being linked to ${linked.map((a) => a.name).join(", ")} and see the organization through their new role instead.` : "They see the organization through their new role instead."}
                confirmLabel="Change Role"
              >
                Change Role
              </ConfirmButton>
            </Stack>
          </Form>
        ) : (
          <>
            <Form action={changeMemberRoleForm.bind(null, slug, member.user_id)}>
              <Stack gap={3}>
                {ORG_ROLES.filter((r) => r !== "family").map((r) => (
                  <Option key={r} name="role" value={r} selected={r === role} title={labelForRole(org.roleLabels, r)} meta={ROLE_BLURB[r]} />
                ))}
              </Stack>
            </Form>
            {onlyOwner && <Prose>The organization&apos;s only {ownerLabel}. Make someone else one before changing this.</Prose>}
            {!onlyOwner && athletes.length > 0 && (
              <Form action={changeMemberRoleForm.bind(null, slug, member.user_id)}>
                <Stack gap={3}>
                  <Hidden name="role" value="family" />
                  <SelectField id="family-athlete" name="athleteId" label={`Make Them ${familyLabel} Instead`} defaultValue="" hint="An athlete login sees one athlete and nothing else. Pick which.">
                    <option value="">Pick an Athlete</option>
                    {athleteOptions(athletes)}
                  </SelectField>
                  <SelectField id="family-relationship" name="relationship" label="Who They Are" defaultValue="parent">
                    {relationshipOptions}
                  </SelectField>
                  <ConfirmButton
                    title={`Make ${name} ${familyLabel}?`}
                    body={`They lose access to the rest of ${org.name}. Any athletes they advise lose their advisor, and a board seat linked to their sign-in is unlinked.`}
                    confirmLabel="Switch Role"
                  >
                    Switch to {familyLabel}
                  </ConfirmButton>
                </Stack>
              </Form>
            )}
          </>
        )}
      </Section>

      {canAdvise && (
        <Section label="Athletes They Advise" count={advises.length} role="people" kind="athlete">
          {advises.length === 0 && (
            <EmptyState kind="athlete" title="Nobody Yet">
              Tick athletes below to make {name} their advisor.
            </EmptyState>
          )}
          {advises.map((a) => (
            <Stack key={a.id} gap={2}>
              <Row href={`/org/${slug}/roster/${a.id}`} kind="athlete" role="people" title={a.name} trailing={<Chevron />} />
              <Form action={unassignAdvisorForm.bind(null, slug, member.user_id, a.id)}>
                <ConfirmButton title={`Remove ${a.name}?`} body={`${name} stops advising ${a.name}, who is left with no advisor until someone picks one.`} confirmLabel="Remove" inline>
                  Remove
                </ConfirmButton>
              </Form>
            </Stack>
          ))}
          {assignable.length > 0 && (
            <Form action={assignAdvisorForm.bind(null, slug, member.user_id)}>
              <Stack gap={3}>
                {assignable.map((a) => (
                  <CheckField
                    key={a.id}
                    id={`advise-${a.id}`}
                    name="athleteId"
                    value={a.id}
                    label={a.name}
                    hint={a.advisor_id ? `Advised by ${staffName.get(a.advisor_id) ?? "someone else"} now` : "No advisor"}
                  />
                ))}
                <Button variant="secondary">Assign Ticked Athletes</Button>
              </Stack>
            </Form>
          )}
        </Section>
      )}

      <Section label="Access" role="danger" kind="blocked">
        {onlyOwner ? (
          <Card>
            <Prose>Cannot be removed while they are the only {ownerLabel}.</Prose>
          </Card>
        ) : (
          <Form action={removeMemberForm.bind(null, slug, member.user_id)}>
            <ConfirmButton title={`Remove ${name} from ${org.name}?`} body="Their account stays. They lose access to this organization only." confirmLabel="Remove">
              Remove From {org.name}
            </ConfirmButton>
          </Form>
        )}
        <Prose>They lose access to {org.name} only. Their account stays.</Prose>
      </Section>
    </Screen>
  );
}
