import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner, type OrgRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { cleanTitle, labelForRole, TITLE_MAX } from "@/lib/org/roleLabels";
import { ASSIGNABLE_ROLES } from "@/lib/validation/member";
import { RELATIONSHIPS, relationshipLabel } from "@/lib/copy/relationships";
import { assignAdvisorForm, changeMemberRoleForm, removeMemberForm, removeMemberPhotoForm, renameMemberForm, setMemberTitleForm, unassignAdvisorForm } from "@/lib/actions/members";
import { MemberPhotoForm } from "@/components/MemberPhotoForm";
import { photoUrl } from "@/lib/people/photo";
import { linkGuardian, unlinkGuardian, updateGuardianRelationship } from "@/lib/actions/guardians";
import { canAdvise as roleCanAdvise, loadAdvisorChoices } from "@/lib/org/advisors";
import { AdvisorSheet } from "@/components/AdvisorSheet";
import { Avatar, Body, Button, Card, CheckField, Chevron, ConfirmButton, EmptyState, Field, Form, Hidden, Label, Notice, Prose, Row, Screen, Section, SelectField, Stack } from "@/components/kit";

interface MemberRow {
  user_id: string;
  role: string;
  title?: string | null;
  photo_path?: string | null;
  created_at: string;
  users: { email: string; full_name: string; last_sign_in_at: string | null } | { email: string; full_name: string; last_sign_in_at: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// What each access level may do. staff is retired (migration 0041) and
// is never offered; a leftover row reads as Admin.
const ROLE_BLURB: Record<OrgRole, string> = {
  owner: "Everything, including members, schools and settings",
  staff: "Everything, including members, schools and settings",
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
  const [{ data: row }, { data: ownerRows }, { data: guardianRows }, { data: athleteRows }, advisors] = await Promise.all([
    supabase
      .from("org_members")
      .select("user_id, role, title, photo_path, created_at, users(email, full_name, last_sign_in_at)")
      .eq("org_id", org.id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("org_members").select("user_id").eq("org_id", org.id).eq("role", "owner"),
    supabase.from("athlete_guardians").select("athlete_id, relationship, athletes(name, deleted_at)").eq("org_id", org.id).eq("user_id", userId),
    supabase.from("athletes").select("id, name, advisor_id").eq("org_id", org.id).is("deleted_at", null).order("name", { ascending: true }),
    // The org's Admins, for the name behind "Advised by X now".
    loadAdvisorChoices(supabase, org.id),
  ]);
  if (!row) notFound();
  // A removed athlete's link stays on file but is not shown: the family
  // sees nothing of them, and their roster page is gone.
  const linked = ((guardianRows ?? []) as GuardianRow[]).filter((g) => !unwrap(g.athletes)?.deleted_at).map((g) => ({ id: g.athlete_id, relationship: g.relationship, name: unwrap(g.athletes)?.name ?? "Unknown athlete" }));
  const athletes = (athleteRows ?? []) as AthleteRow[];
  const staffName = new Map(advisors.map((a) => [a.id, a.name]));

  const member = row as MemberRow;
  const role = member.role as OrgRole;
  const person = unwrap(member.users);
  const name = person?.full_name || person?.email || "Unknown";
  const ownerCount = (ownerRows ?? []).length;
  const onlyOwner = role === "owner" && ownerCount === 1;
  const isMe = member.user_id === me.id;
  const ownerLabel = labelForRole("owner");
  const familyLabel = labelForRole("family");
  const title = cleanTitle(member.title);
  // A leftover staff row is an Admin in every way the screen shows.
  const level = role === "staff" ? "owner" : role;
  const here = `/org/${slug}/members/${member.user_id}`;
  const photo = photoUrl(slug, member.user_id, member.photo_path);

  const joined = person?.last_sign_in_at ? `joined ${new Date(member.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "invited, not signed in yet";

  const linkedIds = new Set(linked.map((a) => a.id));
  const linkable = athletes.filter((a) => !linkedIds.has(a.id));
  const advises = athletes.filter((a) => a.advisor_id === member.user_id);
  const assignable = athletes.filter((a) => a.advisor_id !== member.user_id);
  // The one rule (src/lib/org/advisors.ts): only an Admin advises.
  const canAdvise = roleCanAdvise(role);

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
      <Row leading={<Avatar name={name} size="lg" photo={photo} />} title={`${name}${isMe ? " (you)" : ""}`} meta={[title, labelForRole(role), person?.email, joined].filter(Boolean).join(" · ")} emphasis="bold" wrap />

      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}

      <Section label="Name" role="people" kind="people">
        <Form action={renameMemberForm.bind(null, slug, member.user_id)}>
          <Stack gap={3}>
            <Field name="fullName" label="Full Name" defaultValue={person?.full_name ?? ""} autoComplete="off" maxLength={120} />
            <Button variant="secondary">Save Name</Button>
          </Stack>
        </Form>
      </Section>

      <Section label="Photo" role="people" kind="people">
        <MemberPhotoForm slug={slug} orgId={org.id} userId={member.user_id} name={name} photo={photo} />
        {photo && (
          <Form action={removeMemberPhotoForm.bind(null, slug, member.user_id)}>
            <ConfirmButton title="Remove This Photo?" body="Their initials show instead. A new photo can be added any time." confirmLabel="Remove Photo">
              Remove Photo
            </ConfirmButton>
          </Form>
        )}
      </Section>

      <Section label="Title" role="people" kind="people">
        <Form action={setMemberTitleForm.bind(null, slug, member.user_id)}>
          <Stack gap={3}>
            <Field name="title" label="Title" defaultValue={title ?? ""} autoComplete="off" maxLength={TITLE_MAX} hint="Like Head Coach or Board Chair. Display only." />
            <Button variant="secondary">Save Title</Button>
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
                {ASSIGNABLE_ROLES.filter((r) => r !== "family").map((r) => (
                  <option key={r} value={r}>
                    {`${labelForRole(r)}: ${ROLE_BLURB[r]}`}
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
            {/* One role at a time, each change asked first (Dave's
                standing rule, 2026-10-06). The current one is shown, not
                offered; the others say what changes, including who loses
                their advisor. */}
            <Stack gap={3}>
              {ASSIGNABLE_ROLES.filter((r) => r !== "family").map((r) =>
                r === level ? (
                  <Card key={r} isStatic>
                    <Body weight="semibold">{`${labelForRole(r)} Now`}</Body>
                    <Label>{ROLE_BLURB[r]}</Label>
                  </Card>
                ) : (
                  <Form key={r} action={changeMemberRoleForm.bind(null, slug, member.user_id)}>
                    <Hidden name="role" value={r} />
                    <ConfirmButton
                      tone="change"
                      disabled={onlyOwner}
                      title={`Make ${name} ${/^[AEIOU]/i.test(labelForRole(r)) ? "an" : "a"} ${labelForRole(r)}?`}
                      body={`${ROLE_BLURB[r]}${!roleCanAdvise(r) && advises.length > 0 ? ` ${advises.length === 1 ? `${advises[0]!.name} loses their advisor.` : `${advises.length} athletes lose their advisor: ${advises.map((a) => a.name).join(", ")}.`}` : ""}`}
                      confirmLabel="Change Role"
                    >
                      {`Make Them ${labelForRole(r)}`}
                    </ConfirmButton>
                  </Form>
                ),
              )}
            </Stack>
            {onlyOwner && <Prose>The organization&apos;s only {ownerLabel}. Make someone else one before changing this.</Prose>}
            {!onlyOwner && athletes.length > 0 && (
              <Form action={changeMemberRoleForm.bind(null, slug, member.user_id)}>
                <Stack gap={3}>
                  <Hidden name="role" value="family" />
                  <SelectField id="family-athlete" name="athleteId" label={`Make Them ${familyLabel} Instead`} defaultValue="">
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
        <Section
          label="Athletes They Advise"
          count={advises.length}
          role="people"
          kind="athlete"
          action={
            assignable.length > 0 ? (
              // Stage 5, Phase 2: the same sheet as the athlete page, the
              // other way round. One athlete at a time, searchable; the
              // tick list below still takes several at once.
              <AdvisorSheet
                action={assignAdvisorForm.bind(null, slug, member.user_id)}
                field="athleteId"
                title={`Assign to ${name}`}
                trigger="Assign Athlete"
                searchLabel="Search Athletes"
                choices={assignable.map((a) => ({ id: a.id, title: a.name, meta: a.advisor_id ? `Advised by ${staffName.get(a.advisor_id) ?? "someone else"} now` : "No advisor" }))}
                empty="Every athlete here already has them as advisor."
                confirm={`Make ${name} the advisor for {choice}?`}
              />
            ) : undefined
          }
        >
          {advises.length === 0 && (
            <EmptyState kind="athlete" title="Nobody Yet">
              {/* One string, so the name never loses the spaces around it
                  (audit, issue #1). */}
              {assignable.length > 0 ? `Tick athletes below to make ${name} their advisor.` : undefined}
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
                <ConfirmButton tone="change" title={`Make ${name} Their Advisor?`} body="Each ticked athlete gets them as advisor. Anyone already advising a ticked athlete stops." confirmLabel="Assign">
                  Assign Ticked Athletes
                </ConfirmButton>
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
            <ConfirmButton title={`Remove ${name} from ${org.name}?`} body={`Their account stays. They lose access to this organization only.${advises.length > 0 ? ` ${advises.length === 1 ? `${advises[0]!.name} loses their advisor.` : `${advises.length} athletes lose their advisor.`}` : ""}`} confirmLabel="Remove">
              Remove From {org.name}
            </ConfirmButton>
          </Form>
        )}
        <Prose>They lose access to {org.name} only. Their account stays.</Prose>
      </Section>
    </Screen>
  );
}
