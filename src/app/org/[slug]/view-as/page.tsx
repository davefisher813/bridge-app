import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { VIEW_AS_MINUTES } from "@/lib/data/viewAs";
import { Chevron, Notice, Row, Screen, Section } from "@/components/kit";

// View As (Stage 5 Phase 5, Dave's approval 2026-09-27): an Admin sees
// exactly what an Athlete login, a Viewer or another Admin sees. Three
// rows, one per access level, each opening the people who have it; the
// person is picked on the next screen. Admin only. Read only, for at
// most 30 minutes, and nothing is saved while it lasts.
//
// Someone who is already viewing as another Admin lands here too (an
// Admin passes the Admin check), and is told to Return first rather than
// shown a list that would refuse them.
export default async function ViewAsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const me = await requireOwner(org.id);

  if (me.viewingAs) {
    return (
      <Screen title="View As" back={{ href: `/org/${slug}/more`, label: "More" }}>
        <Notice tone="info" title="Return to Admin First">
          {`You are viewing as ${me.viewingAs.name}. Choose someone else after you return.`}
        </Notice>
      </Screen>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.from("org_members").select("user_id, role").eq("org_id", org.id);
  const members = (data ?? []) as { user_id: string; role: string }[];
  const count = (roles: string[]) => members.filter((m) => roles.includes(m.role) && m.user_id !== me.id).length;
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

  return (
    <Screen title="View As" back={{ href: `/org/${slug}/more`, label: "More" }} lede={`See exactly what one person sees. Read only, for ${VIEW_AS_MINUTES} minutes at most.`}>
      {error && <Notice tone="danger" title={error} />}
      <Section label="Choose a Level" role="people" kind="people">
        <Row href={`/org/${slug}/view-as/athlete`} kind="athlete" role="contact" title="Athlete" meta={`${people(count(["family"]))} · Their own athletes and nothing else`} trailing={<Chevron />} wrap />
        <Row href={`/org/${slug}/view-as/viewer`} kind="people" role="people" title="Viewer" meta={`${people(count(["member"]))} · The program and the schools, read only`} trailing={<Chevron />} wrap />
        <Row href={`/org/${slug}/view-as/admin`} kind="settings" role="time" title="Admin" meta={`${people(count(["owner", "staff"]))} · The whole organization, as another Admin sees it`} trailing={<Chevron />} wrap />
      </Section>
    </Screen>
  );
}
