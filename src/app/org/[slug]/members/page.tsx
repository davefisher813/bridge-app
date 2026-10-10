import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { cleanTitle, labelForRole } from "@/lib/org/roleLabels";
import { resendInviteForm } from "@/lib/actions/members";
import { photoUrl } from "@/lib/people/photo";
import { Avatar, Body, Button, Card, EmptyState, Form, Label, LinkButton, Notice, Row, Screen, Section, Stack, Stat, StatRow, Chevron } from "@/components/kit";
import { ACCESS_GUIDE } from "@/lib/org/accessGuide";

interface MemberRow {
  photo_path?: string | null;
  user_id: string;
  role: string;
  title?: string | null;
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
    .select("user_id, role, title, photo_path, created_at, users(email, full_name, last_sign_in_at)")
    .eq("org_id", org.id)
    .order("created_at", { ascending: true });

  const rows = ((data ?? []) as MemberRow[]).map((r) => ({ ...r, person: unwrap(r.users) }));
  // Somebody who has never signed in is invited, not yet in. The caller
  // is always in: they are looking at the screen.
  const people = rows.filter((r) => r.user_id === me.id || r.person?.last_sign_in_at);
  const invited = rows.filter((r) => r.user_id !== me.id && !r.person?.last_sign_in_at);
  // Their Title, when an Admin has set one, then their access level:
  // this is the screen where access is managed, so it always shows.
  const label = (r: MemberRow) => [cleanTitle(r.title), labelForRole(r.role)].filter(Boolean).join(" · ");

  return (
    <Screen title="Members" back={{ href: `/org/${slug}/more`, label: "More" }}>
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
            leading={<Avatar name={r.person?.full_name || r.person?.email || "?"} photo={photoUrl(slug, r.user_id, r.photo_path)} />}
            title={`${r.person?.full_name || r.person?.email || "Unknown"}${r.user_id === me.id ? " (you)" : ""}`}
            meta={`${label(r)} · ${r.person?.email ?? ""}`}
            trailing={<Chevron />}
            wrap
          />
        ))}
        {rows.length === 0 && (
          <EmptyState kind="people" title="Nobody Here Yet" />
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
              meta={`${label(r)} · invited ${shortDate(r.created_at)}`}
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
      {/* What each access level sees, so an Admin knows before inviting
          (Alfred's audit, 2026-10-10). The same rules the database
          enforces; see src/lib/org/accessGuide.ts. */}
      <Section label="What Each Access Level Sees" role="people" kind="people">
        {ACCESS_GUIDE.map((g) => (
          <Card key={g.level} isStatic>
            <Stack gap={2}>
              <Body weight="bold">{g.level}</Body>
              {g.sees.map((line) => (
                <Label key={line}>{`Sees: ${line}.`}</Label>
              ))}
              {g.never.map((line) => (
                <Label key={line}>{`Never: ${line}.`}</Label>
              ))}
            </Stack>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
