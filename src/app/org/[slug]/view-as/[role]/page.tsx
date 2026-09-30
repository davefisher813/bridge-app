import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { startViewAs } from "@/lib/actions/viewAs";
import { cleanTitle } from "@/lib/org/roleLabels";
import { Avatar, Button, EmptyState, Form, Notice, Row, Screen, Section } from "@/components/kit";

// The people of one access level, for View As (Stage 5 Phase 5). Each row
// has a View As button that starts the session and lands on that person's
// own home. Listed by name with their Title, or their email when no name
// is on file; an Athlete login also lists the athletes it sees. Admin
// only, and never yourself, and only people who are in this organization:
// the list is this org's members and nothing else, and the database
// refuses the rest.
const LEVELS: Record<string, { title: string; roles: string[]; empty: string; lede: string }> = {
  athlete: { title: "Athletes", roles: ["family"], empty: "No Athlete Logins Yet", lede: "Each sees only the athletes linked to them." },
  viewer: { title: "Viewers", roles: ["member"], empty: "No Viewers Yet", lede: "Each sees the program and the schools, read only." },
  admin: { title: "Admins", roles: ["owner", "staff"], empty: "No Other Admins", lede: "Each sees the organization the way that Admin does." },
};

interface MemberRow {
  user_id: string;
  role: string;
  title?: string | null;
  users: { email: string; full_name: string; last_sign_in_at: string | null } | { email: string; full_name: string; last_sign_in_at: string | null }[] | null;
}

interface GuardianRow {
  user_id: string;
  athletes: { name: string; deleted_at?: string | null } | { name: string; deleted_at?: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function ViewAsPeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; role: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { slug, role } = await params;
  const { error } = searchParams ? await searchParams : {};
  const level = LEVELS[role];
  if (!level) notFound();
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const me = await requireOwner(org.id);
  const back = { href: `/org/${slug}/view-as`, label: "View As" };

  if (me.viewingAs) {
    return (
      <Screen title={level.title} back={back}>
        <Notice tone="info" title="Return to Admin First">
          {`You are viewing as ${me.viewingAs.name}. Choose someone else after you return.`}
        </Notice>
      </Screen>
    );
  }

  const supabase = await createClient();
  const [{ data }, { data: links }] = await Promise.all([
    supabase.from("org_members").select("user_id, role, title, users(email, full_name, last_sign_in_at)").eq("org_id", org.id).in("role", level.roles),
    role === "athlete" ? supabase.from("athlete_guardians").select("user_id, athletes(name, deleted_at)").eq("org_id", org.id) : Promise.resolve({ data: [] }),
  ]);

  const athletesOf = new Map<string, string[]>();
  for (const g of (links ?? []) as GuardianRow[]) {
    const a = unwrap(g.athletes);
    if (!a || a.deleted_at) continue;
    athletesOf.set(g.user_id, [...(athletesOf.get(g.user_id) ?? []), a.name]);
  }

  const rows = ((data ?? []) as MemberRow[])
    .filter((r) => r.user_id !== me.id)
    .map((r) => {
      const u = unwrap(r.users);
      return { id: r.user_id, name: u?.full_name || u?.email || "Unknown", title: cleanTitle(r.title), signedIn: Boolean(u?.last_sign_in_at) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Screen title={level.title} back={back} lede={level.lede}>
      {error && <Notice tone="danger" title={error} />}
      <Section label="People" count={rows.length} role="people" kind="people">
        {rows.map((r) => {
          const athletes = athletesOf.get(r.id) ?? [];
          const meta = [r.title, role === "athlete" ? (athletes.length > 0 ? `Sees ${athletes.join(", ")}` : "No athlete linked") : null, r.signedIn ? null : "Invited"].filter(Boolean).join(" · ");
          return (
            <Row
              key={r.id}
              leading={<Avatar name={r.name} />}
              title={r.name}
              meta={meta || undefined}
              wrap
              trailingAction={
                <Form action={startViewAs.bind(null, slug, r.id)}>
                  <Button variant="secondary" inline>
                    View As
                  </Button>
                </Form>
              }
            />
          );
        })}
        {rows.length === 0 && (
          <EmptyState kind="people" title={level.empty}>
            Nobody in this organization has this access level.
          </EmptyState>
        )}
      </Section>
    </Screen>
  );
}
