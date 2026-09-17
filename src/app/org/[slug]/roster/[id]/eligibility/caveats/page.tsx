// Every caveat on an eligibility verdict, in full, plus what to do about
// each kind.
//
// The verdict screen shows the first few warnings and a count. That is
// the right density there and it hides the thing this product exists to
// prevent: a verdict that looks settled and is actually resting on an
// assumed grading scale and a half-typed approved list. The count says
// "6 things to know". This page says which six, and which of them
// somebody can clear today.
//
// It reads from loadEligibility, the same loader the verdict uses, so a
// caveat cannot appear on one screen and not the other.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";
import { loadEligibility } from "@/lib/data/loadEligibility";

export const dynamic = "force-dynamic";

export default async function CaveatsPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const today = new Date().toISOString().slice(0, 10);
  const bundle = await loadEligibility(org.id, id, today);
  if (!bundle) notFound();

  const { view, athlete } = bundle;

  // Two sources, deliberately kept apart in the data and joined here.
  // An adapter warning is about what the app could not read (no scale on
  // file, an unmatched course); an eligibility warning is about the
  // athlete's standing itself. They read as one list to a coordinator and
  // they are cleared in completely different ways.
  const dataCaveats = view.adapterWarnings;
  const standingCaveats = view.eligibility.warnings;
  const total = dataCaveats.length + standingCaveats.length;

  return (
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link
          href={`/org/${slug}/roster/${id}/eligibility`}
          className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted"
        >
          &larr; NCAA eligibility
        </Link>
      </div>

      <h1 className="mb-1 text-[22px] font-extrabold leading-tight text-ink">Things to know</h1>
      <p className="mb-5 text-[13.5px] font-bold text-muted">
        {athlete.name} &middot; {total} {total === 1 ? "item" : "items"}
      </p>

      {total === 0 ? (
        <EmptyState icon={<RowGlyph kind="check" role="committed" className="h-7 w-7" />} title="Nothing outstanding">
          Every core course is matched to an approved list and every school has a grading scale on file. The verdict is built on real data
          rather than defaults.
        </EmptyState>
      ) : (
        <>
          {/* Data caveats first, because they are the ones somebody can
              clear. A coordinator who reads the standing caveats first
              takes the verdict as final and stops. */}
          {dataCaveats.length > 0 && (
            <>
              <div className="mb-2">
                <SectionHeader label="What the app could not read" count={dataCaveats.length} role="offer" kind="warning" />
              </div>
              <div className="flex flex-col gap-2">
                {dataCaveats.map((w, i) => (
                  <RailCard key={i} role="offer" kind="warning">
                    <div className="text-[13.5px] leading-relaxed text-ink">{w}</div>
                  </RailCard>
                ))}
              </div>
              <div className="mt-2">
                <RailCard role="contact" kind="info">
                  <div className="text-[13px] leading-relaxed text-ink">
                    These are gaps in what has been entered, not findings about the athlete. Each one is something the verdict is currently
                    guessing at, and each one can be closed.
                  </div>
                </RailCard>
              </div>
            </>
          )}

          {standingCaveats.length > 0 && (
            <>
              <div className="mb-2 mt-5">
                <SectionHeader label="About their standing" count={standingCaveats.length} role="contact" kind="checklist" />
              </div>
              <div className="flex flex-col gap-2">
                {standingCaveats.map((w, i) => (
                  <RailCard key={i} role="contact" kind="checklist">
                    <div className="text-[13.5px] leading-relaxed text-ink">{w}</div>
                  </RailCard>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Always rendered, even when nothing is fixable, because the
          transcript is the answer to "so what do I do with this" on
          every one of these screens. The two named actions appear above
          it when they apply: "enter a grading scale" is advice, "enter
          one for Cardinal Ridge" is a task. */}
      <div className="mb-2 mt-5">
        <SectionHeader label="What to do" role="accent" kind="info" />
      </div>
      <div className="flex flex-col gap-2">
        {view.schoolsMissingScale.length > 0 && (
          <Link href={`/org/${slug}/grading-scales/new`} className="block">
            <RailCard role="offer" kind="scale">
              <div className="text-[14.5px] font-bold leading-tight text-ink">Enter a grading scale</div>
              <div className="mt-0.5 text-[13px] leading-relaxed text-muted">
                {view.schoolsMissingScale.join(", ")}. Until then the core GPA assumes a ten-point scale, which is wrong at plenty of schools
                and wrong by enough to move a verdict.
              </div>
            </RailCard>
          </Link>
        )}
        {view.schoolsMissingApprovedList.length > 0 && (
          <Link href={`/org/${slug}/approved-courses/new`} className="block">
            <RailCard role="offer" kind="checklist">
              <div className="text-[14.5px] font-bold leading-tight text-ink">Enter an approved course list</div>
              <div className="mt-0.5 text-[13px] leading-relaxed text-muted">
                {view.schoolsMissingApprovedList.join(", ")}. Without one, no course can be confirmed as counting, so the core GPA is an
                estimate over everything on the transcript.
              </div>
            </RailCard>
          </Link>
        )}
        <Link href={`/org/${slug}/roster/${id}/transcript`} className="block">
          <RailCard role="contact" kind="course">
            <div className="text-[14.5px] font-bold leading-tight text-ink">See the transcript</div>
            <div className="mt-0.5 text-[13px] leading-relaxed text-muted">
              Every course the core GPA counted, and every one it did not.
            </div>
          </RailCard>
        </Link>
        {canEdit && (
          <Link href={`/org/${slug}/roster/${id}/eligibility/approvals`} className="block">
            <RailCard role="contact" kind="checklist">
              <div className="text-[14.5px] font-bold leading-tight text-ink">Check course approvals</div>
              <div className="mt-0.5 text-[13px] leading-relaxed text-muted">
                Settle the courses a list could not match on its own.
              </div>
            </RailCard>
          </Link>
        )}
      </div>

      {/* The line that belongs at the bottom of every eligibility screen
          and is easiest to forget on the one that lists the doubts. */}
      <p className="mt-5 text-[13px] leading-relaxed text-muted">
        A projection until every core credit is final. Confirm with the NCAA Eligibility Center before anyone signs anything.
      </p>
    </main>
  );
}
