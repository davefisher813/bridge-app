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

## 2026-09 - Accent red changed to Apple's system red

**Decision:** `--accent` in `src/app/globals.css` is now Apple's
`systemRed` - `#ff3b30` in light mode, `#ff453a` in dark mode - replacing
the original Bridge brand red `#c8180c`.

**Reason:** Dave created his own redesign mockup in ChatGPT and asked
to match its styling. Its red sampled from actual screenshot pixels as
`#fa123e`, noticeably pinker/brighter than the original Bridge red. Sent
Dave a side-by-side comparison artifact of the two; his answer was "I
like more of the bridge red but it's your call. Actually whatever Apple
uses. Let's just do that." Apple differentiates light/dark for
`systemRed`, so both values are applied the same way the existing
`[data-theme="dark"]` block already overrides other tokens, rather than
picking one flat value for both themes.

**Alternatives considered:** The redesign's own `#fa123e`. Not used -
superseded by Dave's explicit final call for Apple's red.

**Consequences:** Original Bridge brand red is no longer this app's
default accent (docs/DESIGN_SYSTEM.md updated). No law or test
hardcoded the old hex, so nothing else needed to change; `npm run
typecheck` still clean. bffsa-site's own red is unaffected - this only
changes the recruiting platform's shared default token, not
`orgs.branding` for any individual org.

## 2026-09 - Today dashboard rebuilt around org/recruiting management, not tasks/events

**Decision:** The home screen (`src/app/org/[slug]/page.tsx`, previously
just a redirect to roster) shows a pipeline snapshot, a "needs
follow-up" list, and "upcoming" visits/transfer-window dates - no
add-a-task or add-an-event widgets, even though Dave's ChatGPT redesign
had both on its home screen.

**Reason:** Dave's explicit correction after seeing the redesign's
home screen: "I don't know if add tasks and events should be there.
That's more for Jarvis purposes because it's a life management tool.
This is an organizational management and recruiting tool. So let's
make sure that's the central focus." The redesign's formatting and
component language carried over; its specific choice of home-screen
content did not.

**Alternatives considered:** Keep the redesign's task/event widgets and
just relabel them as recruiting-specific. Rejected - Dave's point was
about the pattern itself (JARVIS-shaped life management), not the
labels, and there's no task or event data model in this schema anyway.

**Consequences:** Every number on the Today screen is a real query
(athlete count, target-status counts, `updated_at`-sorted follow-ups,
`visit_date`/`transfer_windows`-sourced upcoming dates) - none are
placeholder stats, which meant adding `recruiting_targets.updated_at`
and `.visit_date` (migration `0003`) since neither existed. The
`donor_fundraising`-gated section renders as an honest "coming soon"
placeholder rather than inventing a dollar figure, since no fundraising
table exists yet.

## 2026-09 - Bottom tab bar replaces top nav; no standalone Tasks/Calendar tabs

**Decision:** `src/app/org/[slug]/layout.tsx`'s nav is now a bottom tab
bar - Today / Athletes / Board / More - replacing the old top-of-page
text links (Roster / Board). Tasks and Calendar, both present in Dave's
redesign's 5-tab nav, are not tabs here.

**Reason:** Matches the redesign's actual navigation pattern (bottom
tabs, not a top link row) while following the same "recruiting tool,
not life management" correction above - Tasks and Calendar aren't
built features in this schema at all, so tabs for them would either be
dead ends or invite building JARVIS-shaped scope creep into a different
product. Confirmed with Dave via multiple choice before building
(recommended option chosen: drop both).

**Alternatives considered:** A Calendar tab kept for visits/transfer
windows, since that data is real. Not chosen this round - Dave picked
the simpler 4-tab nav; revisit if a real calendar view is wanted later.

**Consequences:** Sign out moved off the top bar (no room / no reason
to keep it always visible) onto a new `more/page.tsx`, which is
otherwise a placeholder. `BottomTabBar.tsx` is a client component
(`usePathname` for the active-tab state) - the only client component
this app has needed so far.

## 2026-09 - Journey stepper logic built and tested; not yet wired to a screen

**Decision:** `src/lib/journey.ts` (pure, tested) and
`src/components/JourneyStepper.tsx` (presentational) implement the
4-stage Profile/In Contact/Visits/Committed indicator from Dave's
redesign, deriving the athlete's furthest stage live from their
`recruiting_targets.status` values. Nothing renders it yet - there's no
athlete detail route for it to live on.

**Reason:** Dave's answer when asked how the stepper should work:
"Derive it automatically" - confirmed, not a new stored field. Building
the derivation logic and proving it with tests was in scope for this
pass; building the screen it belongs on was not, since that screen
also implies Contacts and a real Visits log (per the full-preview
mock's Colleges/Contacts/Visits tabs), and neither has a table yet.

**Alternatives considered:** Build a minimal athlete detail route just
to host the stepper, without the Contacts/Visits tabs. Deferred - would
ship a screen that looks more complete than it is; better to scope the
whole athlete-profile screen with Dave at once. See docs/ROADMAP.md.

**Consequences:** `deriveJourneyStage` treats "Not Interested" targets
as non-progress (excluded from the "furthest stage" calculation
entirely, so an athlete isn't credited with contact they explicitly
lost), and "Offer" is tier-equivalent to "Visit" since the stepper only
has 4 labeled stages, not 6. 7 unit tests cover both.

## 2026-09 - Inter self-hosted instead of next/font/google

**Decision:** The heavy-weight Inter typeface Dave chose for headlines
is loaded via `next/font/local` from a woff2 vendored into
`src/app/fonts/InterVariable.woff2` (sourced from the
`@fontsource-variable/inter` npm package), not `next/font/google`.

**Reason:** `next/font/google` fetches from `fonts.googleapis.com` at
build time; this sandbox's network policy blocks that domain outright
(`npm run build` failed with a fetch error until this changed). Rather
than leave a build that only works on an unrestricted network, self-
hosting removes the external dependency entirely - it also means no
runtime CDN dependency or extra DNS/TLS round-trip in production,
which is a real improvement independent of this sandbox's restrictions.

**Alternatives considered:** Leave `next/font/google` in place since it
would work fine on Vercel's actual network. Rejected - `npm run build`
is one of the commands CLAUDE.md requires actually running and passing
before calling something done; shipping code whose build only works
under different network conditions than the ones actually available to
verify it isn't verifying it.

**Consequences:** One vendored binary file in the repo (47KB). The
variable font covers weight 100-900 in a single file, so Tailwind's
`font-extrabold`/`font-black` utilities render real heavy weights
rather than faux-bolding a single static weight.

## 2026-09 - Target add/edit does not let staff create schools

**Decision:** The new "Add target" form (`board/new`) only lets staff
pick from schools that already exist in the `schools` table. It does
not offer a "create a new school" option, even though that's the
obvious dead end when the list is empty.

**Reason:** `migrations/0001_core_schema.sql` already has an explicit,
reasoned policy here: "Schools and transfer_windows are shared reference
data: readable by any signed-in member of any org, writable only via
the service role." Only a `schools_read` SELECT policy exists - no
INSERT/UPDATE policy - so any org's staff writing to shared reference
data that every other org also reads was a deliberate non-goal, not an
oversight like the missing athlete columns or the missing
`recruiting_targets` timestamp columns were. Building a workaround
around an existing, reasoned architectural boundary is a product
decision, not a technical one - not mine to make unilaterally.

**Alternatives considered:** Add an INSERT policy scoped to
`STAFF_ROLES` so any org's coordinator/owner could add a school.
Rejected for now - shared reference data one org's staff can freely
edit risks another org's data quality (a Bridge coordinator fat-
fingering a GPA minimum Elite Squad also reads), and there's no dedup
story (no unique constraint on school name) to prevent duplicate rows
either. Worth revisiting deliberately, not as a side effect of building
target-add.

**Consequences:** An org with zero schools seeded sees an honest empty
state on `board/new` ("schools aren't editable from this screen... ask
Dave how school data should get in") instead of a form that looks
complete but has nothing to select. Getting real schools into the
system is now its own ROADMAP.md item, likely tied to Doc AI ingest
once that's ported, or a separate deliberate decision to open a
service-role-gated admin path.

## 2026-09 - Communication log wires real RecruitingSignals into the board

**Decision:** New `target_communications` table (migration `0004`):
call/text/email/visit/other, per target, logged from the target-edit
page. The board's `scoreFit()` call now passes real
`RecruitingSignals` built from this log
(`communicationsToSignals()`), instead of no signals at all.

**Reason:** `src/lib/fit/types.ts`'s `RecruitingSignals` and
`score.ts`'s handling of `commCount`/`visitCount` have existed since the
fit engine was first ported, but the board page never actually
constructed a `signals` object - every fit score on the board has been
computed as if no communication or visit had ever happened, silently.
`score.ts`'s own comment splits the two ("a visit is worth more than a
call"), so `kind = 'visit'` counts toward `visitCount` and everything
else toward `commCount`.

**Alternatives considered:** Derive `visitCount` from
`recruiting_targets.visit_date` (added in `0003`) instead of a separate
log. Rejected - `visit_date` is a single *scheduled* date for Today's
"Upcoming" section, not a count of visits that actually happened; conflating
the two would either undercount repeat visits or misrepresent a
scheduled-but-not-yet-happened visit as a completed one.

**Consequences:** Logging a communication also bumps the parent
target's `updated_at` - the same column added in `0003` for follow-up
staleness, now with a second real way to move besides the full edit
form. `offer` (the third `RecruitingSignals` field) is still not wired
to anything real; `recruiting_targets.status = 'Offer'` is a coarser
thing and wasn't substituted for it. 15/15 RLS assertions pass with the
new table, including its own cross-org isolation and insert-rejection
checks (`scripts/rls_test.sql`).

## 2026-09 - Real `offer` signal, independent of pipeline status

**Decision:** Two new columns on `recruiting_targets` (migration
`0005`): `offer_type` (enum: scholarship, written, verbal,
preferred_walk_on, admission_only, walk_on) and
`offer_scholarship_percent` (0-100, only meaningful when
`offer_type = 'scholarship'`). Set from the target add/edit form
(conditionally showing the percent field only for a scholarship offer,
same pattern as `AthleteForm`'s international-athlete toggle), and fed
into `RecruitingSignals.offer` on the board via
`fitAdapters.ts`'s `targetOfferToSignal()`.

**Reason:** This was the last of `RecruitingSignals`'s three fields
with nothing real behind it - `commCount`/`visitCount` were fixed by
the communication log above. `score.ts` treats a scholarship or
written offer very differently from a verbal or walk-on one, but
nothing captured which kind of offer existed, only the coarser
`recruiting_targets.status = 'Offer'` pipeline stage. Status and offer
are genuinely different things: a target can sit at status `Offer`
while a written offer is pending signature, and a committed athlete
(`status = 'Committed'`) still has an `offer_type` on file describing
what they committed to.

**Alternatives considered:** Deriving a synthetic offer signal from
`status = 'Offer'` alone (e.g. treating any target at that status as a
generic offer). Rejected - it would have thrown away exactly the
distinction `score.ts` needs (scholarship vs. verbal vs. walk-on) and
produced a plausible-looking but fake signal, the same mistake the
board's missing-signals gap was.

**Consequences:** `offerScholarshipPercent` is validated (via a Zod
`.refine()` in `src/lib/validation/target.ts`) to only apply when
`offerType === "scholarship"`, and the DB has its own `check`
constraint (0-100) as a second line of defense. 15/15 RLS assertions
still pass; no new assertions were needed since these are plain
columns on an already-tested table, not a new org-scoped relationship.
