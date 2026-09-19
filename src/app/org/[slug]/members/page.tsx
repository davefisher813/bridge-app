import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner, type OrgRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { labelForRole } from "@/lib/org/roleLabels";
import { resendInviteForm } from "@/lib/actions/members";
import { Avatar, Chip, EmptyState, RailCard, SectionHeader, StatTile } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";

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
// whole permission model hangs on. Approved from the preview 2026-09-19.
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
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/more`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; More
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">Members</h1>
      <p className="mb-4 text-[13.5px] text-muted">Who can sign in to {org.name} and what they can do.</p>

      {(notice || error) && (
        <div className="mb-4">
          <RailCard role={error ? "danger" : "committed"} kind={error ? "warning" : "check"}>
            <div className="text-[14.5px] font-semibold text-ink">{error ?? notice}</div>
          </RailCard>
        </div>
      )}

      <div className="flex gap-2">
        <StatTile value={people.length} label="People" role="people" kind="people" />
        <StatTile value={invited.length} label="Invited" role="time" kind="clock" />
      </div>

      <div className="mb-2 mt-6">
        <SectionHeader label="People" count={people.length} role="people" kind="people" />
      </div>
      <div className="flex flex-col gap-2">
        {people.map((r) => (
          <Link key={r.user_id} href={`/org/${slug}/members/${r.user_id}`} className="block">
            <RailCard>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.person?.full_name || r.person?.email || "?"} />
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-semibold text-ink">{r.person?.full_name || r.person?.email || "Unknown"}</div>
                    <div className="truncate text-[13px] text-muted">{r.person?.email ?? ""}</div>
                  </div>
                </div>
                <Chip label={label(r.role)} kind="people" role={r.user_id === me.id ? "neutral" : "people"} />
              </div>
            </RailCard>
          </Link>
        ))}
      </div>

      {invited.length > 0 && (
        <>
          <div className="mb-2 mt-6">
            <SectionHeader label="Invited" count={invited.length} role="time" kind="clock" />
          </div>
          <div className="flex flex-col gap-2">
            {invited.map((r) => (
              <RailCard key={r.user_id} role="time" kind="clock">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/org/${slug}/members/${r.user_id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-semibold text-ink">{r.person?.full_name || r.person?.email || "Unknown"}</div>
                    <div className="truncate text-[13px] text-muted">
                      {label(r.role)} &middot; invited {shortDate(r.created_at)}
                    </div>
                  </Link>
                  <form action={resendInviteForm.bind(null, slug, r.user_id)}>
                    <button type="submit" className="-my-2 min-h-[44px] pl-2 text-[13px] font-bold text-accent">
                      Resend
                    </button>
                  </form>
                </div>
              </RailCard>
            ))}
          </div>
        </>
      )}

      {rows.length === 0 && (
        <EmptyState icon={<RowGlyph kind="people" role="neutral" className="h-7 w-7" />} title="Nobody here yet">
          Which cannot be right, since you are reading this.
        </EmptyState>
      )}

      <Link
        href={`/org/${slug}/members/new`}
        className="mt-6 block rounded-[8px] bg-solid-accent py-[13px] text-center text-[15px] font-extrabold tracking-[0.02em] text-solid-accent-on"
      >
        Invite Someone
      </Link>
    </main>
  );
}
