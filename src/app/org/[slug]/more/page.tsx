import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { signout } from "@/lib/auth/actions";

// Placeholder catch-all for anything that isn't Today/Athletes/Board yet:
// account, org switching, settings. Real content per docs/ROADMAP.md;
// for now this is just where "Sign out" lives now that the top bar
// doesn't carry it.
export default async function MorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);

  return (
    <main className="px-4 pt-2">
      <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.04em] text-muted">More</div>

      <div className="border-y border-line">
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-[14px] font-semibold text-ink">{user.full_name || user.email}</div>
            <div className="text-[12px] text-muted">{org.name}</div>
          </div>
        </div>
        <form action={signout}>
          <button type="submit" className="w-full py-3 text-left text-[14px] font-semibold text-danger">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
