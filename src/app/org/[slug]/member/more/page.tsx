import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/auth/guard";
import { signout } from "@/lib/auth/actions";
import { labelForRole, personLabel } from "@/lib/org/roleLabels";
import type { OrgRole } from "@/lib/auth/guard";
import { Avatar, Button, Chevron, EmptyState, Form, Row, Screen, Section, Stack } from "@/components/kit";

// More, for a member (Bridge: Board): who to ask (the org's owner and
// staff, with their emails; Dave's pick, 2026-09-21), who you are, and
// the way out. Nothing to set.

interface StaffRow {
  user_id: string;
  role: string;
  title?: string | null;
  users: { email: string; full_name: string | null } | { email: string; full_name: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function MemberMorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireMember(org.id);

  const supabase = await createClient();
  const { data: staffRows } = await supabase.from("org_members").select("user_id, role, title, users(email, full_name)").eq("org_id", org.id).in("role", ["owner", "staff"]).order("created_at", { ascending: true });
  const staff = ((staffRows ?? []) as StaffRow[])
    .map((r) => ({ id: r.user_id, role: r.role as OrgRole, title: r.title ?? null, person: unwrap(r.users) }))
    .filter((r) => r.person?.email);

  return (
    <Screen title="More">
      <Section label="Who to Ask" count={staff.length} role="people" kind="people">
        {staff.length === 0 ? (
          <EmptyState kind="people" title="Nobody Listed Yet" />
        ) : (
          staff.map((s) => (
            <Row
              key={s.id}
              href={`mailto:${s.person!.email}`}
              leading={<Avatar name={s.person!.full_name || s.person!.email} />}
              title={s.person!.full_name || s.person!.email}
              meta={`${personLabel(s)} · ${s.person!.email}`}
              trailing={<Chevron />}
              wrap
            />
          ))
        )}
      </Section>

      <Section label="You" role="people" kind="settings">
        <Row kind="settings" role="people" title={user.full_name || user.email} meta={`${labelForRole("member")} at ${org.name}`} wrap />
        <Form action={signout}>
          <Stack gap={2}>
            <Button variant="destructive">Sign Out</Button>
          </Stack>
        </Form>
      </Section>
    </Screen>
  );
}
