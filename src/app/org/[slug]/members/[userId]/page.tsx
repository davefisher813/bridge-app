import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner, type OrgRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { labelForRole } from "@/lib/org/roleLabels";
import { ORG_ROLES } from "@/lib/validation/member";
import { changeMemberRoleForm, removeMemberForm } from "@/lib/actions/members";
import { Avatar, Button, Card, Form, Notice, Option, Prose, Row, Screen, Section, Stack } from "@/components/kit";

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
};

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
  const [{ data: row }, { data: ownerRows }] = await Promise.all([
    supabase
      .from("org_members")
      .select("user_id, role, created_at, users(email, full_name, last_sign_in_at)")
      .eq("org_id", org.id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("org_members").select("user_id").eq("org_id", org.id).eq("role", "owner"),
  ]);
  if (!row) notFound();

  const member = row as MemberRow;
  const person = unwrap(member.users);
  const name = person?.full_name || person?.email || "Unknown";
  const ownerCount = (ownerRows ?? []).length;
  const onlyOwner = member.role === "owner" && ownerCount === 1;
  const isMe = member.user_id === me.id;
  const ownerLabel = labelForRole(org.roleLabels, "owner");

  const joined = person?.last_sign_in_at ? `joined ${new Date(member.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "invited, not signed in yet";

  return (
    <Screen back={{ href: `/org/${slug}/members`, label: "Members" }}>
      <Row leading={<Avatar name={name} size="lg" />} title={`${name}${isMe ? " (you)" : ""}`} meta={`${person?.email ?? ""} · ${joined}`} emphasis="bold" />

      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}

      <Section label="Role" role="people" kind="people">
        <Form action={changeMemberRoleForm.bind(null, slug, member.user_id)}>
          <Stack gap={3}>
            {ORG_ROLES.map((role) => (
              <Option key={role} name="role" value={role} selected={role === member.role} title={labelForRole(org.roleLabels, role)} meta={ROLE_BLURB[role]} />
            ))}
          </Stack>
        </Form>
        {onlyOwner && <Prose>The organization&apos;s only {ownerLabel}. Make someone else one before changing this.</Prose>}
      </Section>

      <Section label="Access" role="danger" kind="blocked">
        {onlyOwner ? (
          <Card>
            <Prose>Cannot be removed while they are the only {ownerLabel}.</Prose>
          </Card>
        ) : (
          <Form action={removeMemberForm.bind(null, slug, member.user_id)}>
            <Button variant="destructive">Remove From {org.name}</Button>
          </Form>
        )}
        <Prose>Their account stays. They lose access to {org.name} only, and keep any other organization they belong to.</Prose>
      </Section>
    </Screen>
  );
}
