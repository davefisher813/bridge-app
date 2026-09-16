import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import Link from "next/link";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { signout } from "@/lib/auth/actions";
import { RailCard, SectionHeader } from "@/components/catalog";

// Placeholder catch-all for anything that isn't Today/Athletes/Board yet:
// account, org switching, settings. Real content per docs/ROADMAP.md;
// for now this is just where "Sign out" lives now that the top bar
// doesn't carry it.
export default async function MorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  return (
    <main className="px-4 pt-2">
      <div className="mb-3">
        <SectionHeader label="More" />
      </div>

      <div className="flex flex-col gap-2">
        {canEdit && (
          <Link href={`/org/${slug}/documents`} className="block">
            <RailCard role="place">
              <div className="text-[14px] font-semibold text-ink">Documents</div>
              <div className="text-[12px] text-muted">Read a transcript or an offer letter into an athlete&apos;s record</div>
            </RailCard>
          </Link>
        )}
        <Link href={`/org/${slug}/grading-scales`} className="block">
          <RailCard role="contact">
            <div className="text-[14px] font-semibold text-ink">Grading scales</div>
            <div className="text-[12px] text-muted">How each high school&apos;s numbers become letters for an NCAA core GPA</div>
          </RailCard>
        </Link>
        <RailCard role="neutral">
          <div className="text-[14px] font-semibold text-ink">{user.full_name || user.email}</div>
          <div className="text-[12px] text-muted">{org.name}</div>
        </RailCard>
        <form action={signout}>
          <button type="submit" className="w-full rounded-[10px] bg-paper px-3.5 py-3 text-left text-[14px] font-semibold text-danger">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
