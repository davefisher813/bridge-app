# Decisions

## 2026-09 - Build generic from day one, not Bridge-first with a later extraction

**Decision:** The core product (recruiting, athletes, communication,
Doc AI) is built org-agnostic from the first commit. Board/governance
and donor/fundraising are the only Bridge-specific pieces, built as
toggleable modules, off by default.

**Reason:** Dave's own framing: "just imagine what a team... what
someone like me would need to run just like elite squad if it wasn't
bridge... I think pretty much the entire DNA of the app can be utilized
in that way." He wants the jump from Bridge to a second organization
(Elite Squad, then others) to be immediate once Bridge is right, not a
future rewrite project.

**Alternatives considered:** Build Bridge-specific first, extract a
generic core later (my initial instinct, framed as "avoid premature
abstraction"). Rejected because Dave explicitly weighed this trade-off
and chose generic-from-day-one, and because he is funding this
personally, separate from Bridge/BFFSA resources, which removes the
usual pressure to ship the one paying customer's exact shape first.

**Consequences:** Every schema table and every module needs an org
boundary considered up front, even when only one org uses a feature
today. Slightly more design work per feature; no rewrite when Elite
Squad onboards.

## 2026-09 - Multi-tenancy via a real membership table now, not deferred

**Decision:** `org_members` (a real many-to-many table with RLS) ships
in the first migration, not a single `owner_id` column deferred to a
membership table "later," which is the pattern JARVIS's own
architecture doc describes for itself.

**Reason:** JARVIS could defer that step because it started genuinely
single-user. This platform has two real organizations (Bridge, Elite
Squad) from day one, so the "later" that JARVIS's pattern defers to is
already now.

**Alternatives considered:** Copy JARVIS's exact deferred pattern for
consistency across Dave's codebases. Rejected: consistency with a
pattern designed for a different starting condition isn't worth
building a migration that would need to be redone almost immediately.

## 2026-09 - Framework/backend stack: mirror tucci-admin, not JARVIS or Bridge

**Decision:** Next.js 16 / React 19 / TypeScript / Tailwind / Supabase,
matching tucci-admin's dependency versions.

**Reason:** Dave chose this explicitly (AskUserQuestion: "Framework +
backend, like Tucci (recommended)"). tucci-admin is Dave's only current,
correctly-documented Next.js/Supabase repo; tucci-platform (an earlier
scaffold, last commit April 2026) is superseded by it.

**Alternatives considered:** JARVIS's stack (not directly transferable -
different app shape, offline-first, `item`-table entity model). Bridge's
own stack (single-file PWA, no build step - explicitly what Dave wants
to move away from).

## 2026-09 - Fit-scoring: a `veto` field replaces Bridge's tag-ordering combiner

See docs/ARCHITECTURE.md for the full design. Summary: every dimension
returns `{score, confidence, veto, reasons, warnings}`; a veto always
overrides a documented weighted blend, instead of Bridge's worst-of-two-
tags-then-five-sequential-override-layers approach.

**Reason:** This was the single feature Dave named as most frustrating
about Bridge: "it could provide so much value, and it just wouldn't
work cleanly."

**Consequences:** Every dimension file (`academic.ts`, `athletic.ts`,
`financial.ts`, `transfer.ts`) must decide, explicitly, whether a given
failure is a hard veto or a soft score penalty - there's no third option
to fall back on, which is intentional.

## 2026-09 - NCAA scholarship rules: corrected after user pushback

**Decision:** D3's scholarship ban is encoded as universal and
unrelated to the House v. NCAA settlement; the settlement's roster-
limit mechanic applies to D1 only; D2 is unaffected by either.

**Reason:** An earlier draft of this same session stated the House
settlement "eliminated sport-specific scholarship caps entirely,"
without scoping it to D1. Dave caught it: "Did you check the
scholarship thing for all divisions? I don't believe d3 can offer
scholarships." Re-verified via web search and corrected. See
docs/BUSINESS_RULES.md for the corrected rules and where each is
enforced.

**Consequences:** This is exactly the kind of fact that's cheap to get
wrong and expensive to get wrong silently in a recruiting tool families
rely on, which is why it's enforced as a law
(`src/laws/fitLaws.test.ts`) rather than left as a comment that could
drift.

## 2026-09 - Fixed a real RLS infinite-recursion bug found by testing as a non-superuser role

**Decision:** Added `_member_org_ids()`, a `SECURITY DEFINER` helper
function, and rewrote every org-scoped RLS policy (`athletes_by_org`,
`recruiting_targets_by_org`, `benchmark_sets_by_org`, `org_members_self`)
to call it instead of querying `org_members` directly.

**Reason:** `org_members`'s own policy has to query `org_members` to
decide who can see what. Any other policy that also queries
`org_members` directly, while `org_members` itself has an active RLS
policy, recurses: evaluating the outer policy evaluates `org_members`'s
policy, which queries `org_members` again, forever. Postgres reports
this as "infinite recursion detected in policy for relation
org_members." This was invisible in the original migration test
(`/tmp/smoke_test.sql`, superuser-only) because RLS is bypassed
unconditionally for superusers and table owners - the bug could not
have been caught that way no matter how many rows were inserted.
Building `scripts/run_rls_test.sh` (a genuine non-superuser role,
`NOBYPASSRLS`) surfaced it on the very first query.

**Alternatives considered:** Restructure the policies to avoid a
self-referencing subquery some other way (e.g., denormalizing org
membership onto a JWT claim, which is what Supabase's own docs suggest
for larger-scale deployments). Not pursued yet because a JWT-claims
approach ties this schema to actual Supabase auth-hook configuration,
which doesn't exist yet; the SECURITY DEFINER helper is the standard,
portable fix and doesn't foreclose moving to JWT claims later if
`org_members` lookups ever become a real performance bottleneck.

**Consequences:** Any future RLS policy that needs "which orgs does the
current user belong to" must call `_member_org_ids()`, never write
`select org_id from org_members where user_id = auth.uid()` inline
again - that's exactly the pattern that recursed. This should probably
become a law once `src/laws/` can usefully static-scan SQL.

## 2026-09 - Fixed a second real RLS bug: `orgs` had zero policies

**Decision:** Added `orgs_by_membership` (`select` only, via
`_member_org_ids()`) to `migrations/0001_core_schema.sql`.

**Reason:** `orgs` had `alter table orgs enable row level security`
with no `create policy` for it at all. In Postgres, RLS enabled plus
zero policies denies every row to every non-owner role for every
command - not "no extra restriction," but "nothing visible." A signed-
in member couldn't read their own org's name, `role_labels`,
`modules`, or `branding`. This was caught while building the
org-resolution page (a user's post-login redirect needs to read their
own org row to know where to send them), not by a dedicated test
written in advance - a reminder that `scripts/rls_test.sql` should grow
a case for every table as pages start actually reading it, not just the
tables that happened to get exercised first.

**Consequences:** Added the missing policy plus a regression assertion
to `scripts/rls_test.sql` (11/11 now pass). The general lesson: `alter
table ... enable row level security` with no policy is a silent
"nobody can read this" trap, not a safe default - worth treating every
new org-scoped table's policy as part of the same change that enables
RLS on it, never a follow-up.

## 2026-09 - Doc AI: port the categories/provenance/versioning design, fix a real double-penalty bug in the legibility downgrade

**Decision:** Rebuilt Bridge's Engine/EngineBridge document-extraction
pipeline (`src/lib/docai/`) as a faithful port of its categories
registry, confidence scoring, and versioning/reconciliation logic - this
part of Bridge was already coherent, config-driven design, unlike the
fit engine - with two changes: extraction output is now validated
against a Zod schema per category before anything downstream sees it
(Bridge trusted raw `JSON.parse` completely), and the pipeline is a
pure function returning a result instead of writing straight into a
global object, so persistence stays the caller's job where `org_id` and
RLS actually live.

**Reason:** Dave named Doc AI, alongside the recruiting engine, as one
of the two hardest-but-most-valuable pieces to get right.

**A bug found while porting, not before:** Bridge's EX-10 low-legibility
handling (bffsa-site/index.html ~2658-2664) caps the model's reported
confidence at 0.55 when a scan's legibility is below 0.6, then passes
that capped value into `effectiveConfidence()`, which multiplies by the
*same* legibility score again. Worked through the algebra:
`0.55 (cap) x <0.6 (legibility) x <=1.0 (role weight)` is always below
`CONFIDENCE_REVIEW_MIN` (0.40). So despite Bridge's own comment saying
this "routes to review queue," every low-legibility case actually fell
straight to reject - the review band was mathematically unreachable
whenever this branch fired. Fixed by making legibility suppress
confidence in exactly one place (`effectiveConfidence`'s multiplier);
the low-legibility branch now only adds a warning. Verified with a
regression test (`provenance.test.ts`, "a moderately low legibility
score can still land in the review band, not just reject") that fails
against the old double-penalty logic and passes against the fix.

**Alternatives considered:** Leave the bug in place for fidelity to
Bridge's shipped behavior. Rejected - matching a real bug isn't
faithfulness, and a rule this consequential (does a family's transcript
get auto-applied, sent to a human, or bounced back for a retake)
deserves to actually do what its own comment says it does.

**Consequences:** Any future change to confidence math must remember
legibility is applied once, in `effectiveConfidence`, not layered again
elsewhere - this should become a law once `src/laws/` has a reason to
static-check numeric logic like this instead of only strings/policies.

## 2026-09 - Add an eligibility dimension for the NCAA transfer portal

**Decision:** Support `transfer_4to4`, `transfer_juco`, and
`transfer_grad` recruit types alongside `hs`, with a fourth fit
dimension (`src/lib/fit/transfer.ts`) that Bridge never had.

**Reason:** Dave's explicit request: "this has to be set up for
transfer students as well. So research the transfer portal."

**Consequences:** Portal window dates must be modeled as data
(`transfer_windows` table), never hardcoded, since the NCAA changes
them most years by vote - this constraint shaped the whole dimension's
design (see docs/ARCHITECTURE.md and docs/BUSINESS_RULES.md).

## 2026-09 - Recruiting board: found and fixed a real schema gap, established the jsonb key-casing convention

**Decision:** Added `migrations/0002_athlete_intl_eligibility_fields.sql`
(five real columns on `athletes`: `is_international`, `toefl_score`,
`ielts_score`, `f1_visa_status`, `ncaa_eligibility_status`). Also
established that `schools.academics`/`financials`/`athletics`/
`conflicts` jsonb store camelCase keys matching `School` in
`src/lib/fit/types.ts` directly, validated by new Zod schemas in
`src/lib/fit/schema.ts` (`parseSchoolAcademics` etc., each `.catch()`-
guarded so one malformed field degrades to "not on file" instead of
throwing).

**Reason:** Building the recruiting board screen required a data
adapter (`src/lib/data/fitAdapters.ts`) converting raw Supabase rows
into the fit engine's plain types. `src/lib/fit/types.ts`'s `Athlete`
interface has declared `isInternational`, `toeflScore`, `ieltsScore`,
`f1VisaStatus`, and `ncaaEligibilityStatus` since the fit engine was
built, and `score.ts` already reads them (the international-athlete
TOEFL warning, the NCAA Eligibility Center warning) - but
`0001_core_schema.sql` never actually created columns for them. The
adapter had nowhere to read these from. Separately, `0001`'s own
inline comments showed snake_case example field names for the schools
jsonb columns (`gpa_min`, `avg_athletic_aid`, etc.) that never matched
`School`'s camelCase fields - nothing had been written to those
columns yet, so this was caught before it caused a real mismatch, not
after.

**Reason for real columns over jsonb:** These five fields are true for
every `recruit_type`, unlike the HS-vs-transfer fields that correctly
live in the type-varying `detail` jsonb. That's the same reasoning
`gpa`/`gpa_verified` already followed as real columns rather than
living in `detail`.

**Alternatives considered:** Silently drop these fields from `Athlete`
since nothing had wired them up yet. Rejected - `score.ts`'s
international-athlete and NCAA-eligibility warnings already depend on
them; removing the fields would mean quietly disabling functionality
the fit engine was built to have, not simplifying it.

**Consequences:** Reran `scripts/run_rls_test.sh` against both
migrations applied in sequence; all 11 assertions still pass. Any new
schools jsonb field must be added to both the relevant Zod schema in
`src/lib/fit/schema.ts` and `School`/`AthleteDetail` in
`src/lib/fit/types.ts` together, same discipline as `athletes.detail`
already required.

## 2026-09 - Visual previews before building a new screen

**Decision:** Publish a static HTML mockup via the Artifact tool for
any new screen before writing the real page, so Dave can react and
adjust before code exists. Roster and Board were built first and
previewed after, as a one-time retroactive catch-up (see the
`screen-preview.html` artifact); every screen after this point gets the
preview first.

**Reason:** Dave's explicit request: "I would like visual previews at
some point too so we can adjust before anything gets built." There is
also no deployed instance and no real Supabase project yet, so without
a preview Dave has no way to actually see a screen short of it already
being finished code.

**Consequences:** The mockup uses the real tokens from
`src/app/globals.css` and the real markup patterns from already-built
pages (phone-frame width, the same header/nav/row structure), not a
generic redesign, so what Dave reacts to is what will actually ship.
Adds one step to the build sequence for a new screen: mockup, feedback,
then real code - not a reason to skip building fast, just to sequence
it so feedback lands before the work, not after.
