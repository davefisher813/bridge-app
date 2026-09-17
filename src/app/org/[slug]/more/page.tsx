import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import Link from "next/link";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { signout } from "@/lib/auth/actions";
import { RailCard, SectionHeader } from "@/components/catalog";
import { labelForRole } from "@/lib/org/roleLabels";

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
            <RailCard role="place" kind="org">
              <div className="text-[15px] font-semibold text-ink">Documents</div>
              <div className="text-[13px] text-muted">Read a transcript or an offer letter into an athlete&apos;s record</div>
            </RailCard>
          </Link>
        )}
        {org.modules.donor_fundraising && (
          <Link href={`/org/${slug}/fundraising`} className="block">
            <RailCard role="committed" kind="money">
              <div className="text-[15px] font-semibold text-ink">Fundraising</div>
              <div className="text-[13px] text-muted">Donors, gifts, pledges and the year against budget</div>
            </RailCard>
          </Link>
        )}
        {org.modules.board_governance && (
          <Link href={`/org/${slug}/board-governance`} className="block">
            <RailCard role="people" kind="governance">
              <div className="text-[15px] font-semibold text-ink">Board</div>
              <div className="text-[13px] text-muted">Seats and give/get progress across every tier</div>
            </RailCard>
          </Link>
        )}
        <Link href={`/org/${slug}/grading-scales`} className="block">
          <RailCard role="contact" kind="scale">
            <div className="text-[15px] font-semibold text-ink">Grading scales</div>
            <div className="text-[13px] text-muted">How each school&apos;s numbers become letters</div>
          </RailCard>
        </Link>
        <Link href={`/org/${slug}/schools`} className="block">
          <RailCard role="place" kind="school">
            <div className="text-[15px] font-semibold text-ink">Schools</div>
            <div className="text-[13px] text-muted">The shared database, and who you are recruiting</div>
          </RailCard>
        </Link>
        <Link href={`/org/${slug}/approved-courses`} className="block">
          <RailCard role="visit" kind="checklist">
            <div className="text-[15px] font-semibold text-ink">Approved lists</div>
            <div className="text-[13px] text-muted">Which courses the NCAA counts at each school</div>
          </RailCard>
        </Link>
        <RailCard role="neutral" kind="settings">
          <div className="text-[15px] font-semibold text-ink">{user.full_name || user.email}</div>
          {/* The org's own word for the role, not the enum value.
              Bridge says Executive Director, Elite Squad says Coach, and
              the permission underneath is the same either way. */}
          <div className="text-[13px] text-muted">
            {labelForRole(org.roleLabels, user.role)} at {org.name}
          </div>
        </RailCard>
        <form action={signout}>
          <button type="submit" className="w-full rounded-[10px] bg-paper px-3.5 py-3 text-left text-[15px] font-semibold text-danger">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
