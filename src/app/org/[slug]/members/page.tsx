import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner, type OrgRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { labelForRole } from "@/lib/org/roleLabels";
import { resendInviteForm } from "@/lib/actions/members";
import { Avatar, Button, Chip, EmptyState, Form, LinkButton, Notice, Row, Screen, Section, Stat, StatRow } from "@/components/kit";

interface MemberRow {
  user_id: string;
  role: string;
  created_at: string;
  users: { email: string; full_name: string; last_sign_in_at: string | null } | { email: string; full_name: string; last_sign_in_at: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Who can sign in to this org and what they can do. Owner only: the
// list is the one place a role can be changed, and a role is what the
// whole permission model hangs on.
export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { notice, error } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const me = await requireOwner(org.id);

  const supabase = await createClient();
  const { data } = await supabase
    .from("org_members")
    .select("user_id, role, created_at, users(email, full_name, last_sign_in_at)")
    .eq("org_id", org.id)
    .order("created_at", { ascending: true });

  const rows = ((data ?? []) as MemberRow[]).map((r) => ({ ...r, person: unwrap(r.users) }));
  // Somebody who has never signed in is invited, not yet in. The caller
  // is always in: they are looking at the screen.
  const people = rows.filter((r) => r.user_id === me.id || r.person?.last_sign_in_at);
  const invited = rows.filter((r) => r.user_id !== me.id && !r.person?.last_sign_in_at);
  const label = (role: string) => labelForRole(org.roleLabels, role as OrgRole);

  return (
    <Screen title="Members" back={{ href: `/org/${slug}/more`, label: "More" }} lede={`Who can sign in to ${org.name} and what they can do.`}>
      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}

      <StatRow>
        <Stat value={people.length} label="People" role="people" kind="people" />
        <Stat value={invited.length} label="Invited" role="time" kind="clock" />
      </StatRow>

      <Section label="People" count={people.length} role="people" kind="people">
        {people.map((r) => (
          <Row
            key={r.user_id}
            href={`/org/${slug}/members/${r.user_id}`}
            leading={<Avatar name={r.person?.full_name || r.person?.email || "?"} />}
            title={r.person?.full_name || r.person?.email || "Unknown"}
            meta={r.person?.email ?? ""}
            trailing={<Chip label={label(r.role)} kind="people" role={r.user_id === me.id ? "neutral" : "people"} />}
          />
        ))}
        {rows.length === 0 && (
          <EmptyState kind="people" title="Nobody Here Yet">
            Which cannot be right, since you are reading this.
          </EmptyState>
        )}
      </Section>

      {invited.length > 0 && (
        <Section label="Invited" count={invited.length} role="time" kind="clock">
          {invited.map((r) => (
            <Row
              key={r.user_id}
              kind="clock"
              role="time"
              title={r.person?.full_name || r.person?.email || "Unknown"}
              meta={`${label(r.role)} · invited ${shortDate(r.created_at)}`}
              trailing={
                <Form action={resendInviteForm.bind(null, slug, r.user_id)}>
                  <Button variant="quiet" inline>
                    Resend
                  </Button>
                </Form>
              }
            />
          ))}
        </Section>
      )}

      <LinkButton href={`/org/${slug}/members/new`}>Invite Someone</LinkButton>
    </Screen>
  );
}
