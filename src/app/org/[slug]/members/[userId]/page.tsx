import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner, type OrgRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { labelForRole } from "@/lib/org/roleLabels";
import { ORG_ROLES } from "@/lib/validation/member";
import { changeMemberRoleForm, removeMemberForm } from "@/lib/actions/members";
import { Avatar, RailCard, SectionHeader } from "@/components/catalog";

interface MemberRow {
  user_id: string;
  role: string;
  created_at: string;
  users: { email: string; full_name: string; last_sign_in_at: string | null } | { email: string; full_name: string; last_sign_in_at: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// What each role may do, in the org's own words for the role. The
// descriptions are the permission model in one line each; the labels
// are whatever this org calls the tier.
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

  const joined = person?.last_sign_in_at ? `joined ${new Date(member.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "invited, not signed in yet";

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/members`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Members
        </Link>
      </div>

      <RailCard>
        <div className="flex items-center gap-3">
          <Avatar name={name} />
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold text-ink">
              {name}
              {isMe ? " (you)" : ""}
            </div>
            <div className="truncate text-[13px] text-muted">
              {person?.email ?? ""} &middot; {joined}
            </div>
          </div>
        </div>
      </RailCard>

      {(notice || error) && (
        <div className="mt-3">
          <RailCard role={error ? "danger" : "committed"} kind={error ? "warning" : "check"}>
            <div className="text-[14.5px] font-semibold text-ink">{error ?? notice}</div>
          </RailCard>
        </div>
      )}

      <div className="mb-2 mt-6">
        <SectionHeader label="Role" role="people" kind="people" />
      </div>
      <form action={changeMemberRoleForm.bind(null, slug, member.user_id)} className="flex flex-col gap-2">
        {ORG_ROLES.map((role) => {
          const current = role === member.role;
          return (
            <button
              key={role}
              type="submit"
              name="role"
              value={role}
              disabled={current}
              className={`flex min-h-[44px] items-center justify-between gap-3 rounded-[10px] bg-paper px-3.5 py-3 text-left ${current ? "ring-2 ring-accent" : ""}`}
            >
              <span className="text-[16px] font-semibold text-ink">{labelForRole(org.roleLabels, role)}</span>
              <span className="text-[13px] text-muted">{ROLE_BLURB[role]}</span>
            </button>
          );
        })}
      </form>
      {onlyOwner && <p className="mt-2 text-[12.5px] text-muted">The organization&apos;s only {labelForRole(org.roleLabels, "owner")}. Make someone else one before changing this.</p>}

      <div className="mb-2 mt-6">
        <SectionHeader label="Access" role="danger" kind="blocked" />
      </div>
      {onlyOwner ? (
        <RailCard>
          <div className="text-[14.5px] text-muted">Cannot be removed while they are the only {labelForRole(org.roleLabels, "owner")}.</div>
        </RailCard>
      ) : (
        <form action={removeMemberForm.bind(null, slug, member.user_id)}>
          <button type="submit" className="w-full rounded-[10px] bg-paper px-3.5 py-3 text-left text-[15px] font-semibold text-danger">
            Remove From {org.name}
          </button>
        </form>
      )}
      <p className="mt-2 text-[12.5px] text-muted">Their account stays. They lose access to {org.name} only, and keep any other organization they belong to.</p>
    </main>
  );
}
