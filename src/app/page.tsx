import { redirect } from "next/navigation";
import Link from "next/link";
import { getOrgMemberships } from "@/lib/org/membership";
import { signout } from "@/lib/auth/actions";

// Post-login landing: a person can belong to more than one org (a coach
// at Elite Squad who also volunteers for Bridge), so this is where that
// gets resolved - straight through for exactly one org, a picker for
// more than one, same page can't guess for zero.
export default async function HomePage() {
  const memberships = await getOrgMemberships();

  if (memberships.length === 1) {
    redirect(`/org/${memberships[0]!.orgSlug}`);
  }

  if (memberships.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="w-full max-w-[380px] rounded-[18px] border border-line bg-paper p-6 text-center">
          <div className="text-[20px] font-extrabold text-ink">No organization access yet</div>
          <p className="mt-2 text-[14.5px] text-muted">Your account isn't a member of any organization. Ask your organization's owner to add you.</p>
          <form action={signout} className="mt-4">
            <button type="submit" className="text-[14.5px] font-semibold text-accent">
              Sign out
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-4 text-[17px] font-extrabold text-ink">Choose an organization</div>
        <div className="flex flex-col gap-2">
          {memberships.map((m) => (
            <Link
              key={m.orgId}
              href={`/org/${m.orgSlug}`}
              className="flex items-center justify-between rounded-[12px] border border-line bg-paper px-4 py-3 text-[16px] font-semibold text-ink hover:border-accent"
            >
              {m.orgName}
              <span className="text-[13px] font-medium text-muted">{m.role}</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
