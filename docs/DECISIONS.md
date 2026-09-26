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

## 2026-09 - Athlete profile screen: real Contacts and Visits tables, visitCount re-sourced

**Decision:** Two new tables (migration `0006`): `contacts`
(athlete-scoped: name, role enum, optional linked `school_id`, email,
phone, notes) and `target_visits` (target-scoped: visit type enum,
date, impression, next step, notes). New screen at
`src/app/org/[slug]/roster/[id]` shows both plus the athlete's
recruiting targets and `JourneyStepper` (built earlier, unused until
now). `RecruitingSignals.visitCount` is now sourced from
`target_visits` (`fitAdapters.ts`'s `visitsToVisitCount`) instead of
counting `target_communications kind='visit'` rows;
`communicationsToSignals` now folds every communication-log row,
'visit' kind included, into `commCount`.

**Reason:** Dave approved the full build (Contacts + Visits tabs) from
the ChatGPT full-preview mock. That mock's Contacts tab is a real
person directory (name, role, email, phone) shared across an athlete's
targets, not the single free-text `recruiting_targets.coach_name`
field. Its Visits tab is a richer per-visit record (official/unofficial/
junior day/camp, impression, next step) than a bare `kind='visit'` log
entry ever captured. Re-sourcing `visitCount` from the new table
avoids two different definitions of "a visit happened" feeding the fit
score depending on which surface logged it.

**Alternatives considered:** Keep `visitCount` derived from
`target_communications kind='visit'` and add the richer fields there
instead of a new table. Rejected - `target_communications` is a flat
log (kind/date/notes) shared across five very different kinds of
contact; bolting visit-specific columns (impression, next step) onto
every row regardless of kind would leave them null for four out of
five kinds and blur the table's purpose. A dedicated table matches how
`target_visits` and `target_communications` are actually used
downstream (`fitAdapters.ts`, the two different forms on the target
edit page).

**Consequences:** No real production data exists yet (repo not on
GitHub, no live Supabase project), so this re-sourcing has no migration
cost - if it did, any historical `kind='visit'` rows would need
backfilling into `target_visits` to avoid silently changing past fit
scores. The 'visit' option stays in `target_communications_kind`'s enum
and `CommunicationForm`'s picker (harmless, just no longer counted
separately) rather than forcing an enum-recreation migration for a
cosmetic cleanup. 21/21 RLS assertions pass with `contacts` and
`target_visits` added, including their own cross-org isolation and
insert-rejection checks.

## 2026-09 - Schools admin form: owner-gated, through the service-role client

**Decision:** `src/app/org/[slug]/schools/new`, gated by `requireOwner()`
(not `requireRole(..., STAFF_ROLES)` - Dave's ask was specifically
"owners"), writes through `createAdminClient()`
(`src/lib/supabase/admin.ts`, previously written but never called).
Linked from the target-add form's header and its "no schools yet"
empty state, for owners only.

**Reason:** `schools` has no INSERT policy for any authenticated role
by design (migration `0001`'s comment) - it's shared reference data
across every org, and letting RLS authorize writes to it would mean
authorizing every org's owners to write rows every other org also
reads, which RLS's per-row `org_id` model can't express (there's no
`org_id` column on `schools` to scope against). The authorization has
to happen in the app layer instead: `requireOwner()` is the actual
gate, and the write goes through the service-role client specifically
because no RLS policy would allow it otherwise. Dave asked for this
alongside a future Doc AI-ingest path for schools, not instead of it -
both are legitimate ways to add a school, this is just the one that
doesn't need Doc AI ingest to exist first.

**Alternatives considered:** Add a real INSERT policy scoped somehow
(e.g. any `owner`-role member of any org can insert). Rejected - this
would make the authorization rule itself part of the schema, so
tightening it later (e.g. requiring admin review before a new school
goes live platform-wide) becomes a migration instead of an app-layer
change, and `_member_org_ids()`-style policies are already the thing
this repo works hard to keep simple.

**Consequences:** No duplicate-school prevention was added (no unique
constraint, no dedup check in the action) - same open item flagged in
the original target-add decision, still worth revisiting deliberately
rather than as a side effect of this. Added an explicit RLS assertion
proving an ordinary authenticated user's direct insert into `schools`
is still rejected, so this door staying "owner-gated app code, not an
RLS policy" is actually verified, not just asserted in a comment.
22/22 RLS assertions pass.

## 2026-09 - Doc AI file ingest: trust the browser for EXIF, not a hand-rolled parser

**Decision:** `src/lib/docai/ingest.ts` sniffs a file's real type from
its magic bytes (`magicBytes.ts`, pure/unit-tested), then for
JPEG/PNG/GIF/WEBP decodes it via `createImageBitmap(blob, {
imageOrientation: "from-image" })` and re-encodes through canvas, with
no manual EXIF parsing or rotation logic anywhere. HEIC is detected but
not decoded (an honest `fallbackReason`, not a silent failure); PDFs
pass through as base64; oversized files (> 4MB) are rejected before any
decode work.

**Reason:** the first implementation ported Bridge's approach more
literally - hand-parse the JPEG's EXIF orientation tag, request
`createImageBitmap(blob, { imageOrientation: "none" })` to get
unrotated pixels, then apply the rotation manually via a canvas
transform. Built the standalone Playwright harness
(`scripts/docai_ingest_browsertest.mjs`, real headless Chromium, not a
mock) specifically to verify this against actual images before calling
it done, per CLAUDE.md's "porting it now and claiming it was tested
would be dishonest." The harness caught a real bug on the first run (13
of 17 checks passing, not 17): this sandbox's Chromium auto-rotates on
`createImageBitmap` regardless of the `"none"` option for a
Blob-sourced JPEG - the option is simply not honored here for that
input type. The manual rotation code was therefore rotating an
already-correctly-rotated image a second time, which for a 4x2
orientation-6 JPEG produced wrong final dimensions. (A second, separate
bug was also caught by hand before running the harness: the manual
transform was being called with the post-swap canvas dimensions instead
of the pre-swap source dimensions, which the standard rotation-matrix
recipe requires the other way round.)

**Alternatives considered:** Keep the manual EXIF/rotation code and
special-case around the browser's auto-rotation (detect it, then skip
the manual step when it would happen). Rejected - it would mean
carrying dead code whose only job is to run in browsers where the
auto-rotation behavior differs, which is more surface area for exactly
the kind of bug this one already was, for zero behavioral gain over
just trusting the browser's native (spec-default) handling.

**Consequences:** `src/lib/docai/exif.ts` and its test file were
deleted entirely - there is no EXIF-parsing code left in the repo.
`normalizeImage()` is simpler and shorter than the original port. If a
future browser or environment doesn't auto-rotate on decode, this
would need revisiting, but `{ imageOrientation: "from-image" }` is the
spec default precisely so that a compliant browser always handles it
consistently. Re-ran the harness after the fix: 18/18 assertions pass
(the count includes the size-guard, unknown-bytes, and
magic-byte-beats-extension checks, none of which existed in the first
13/17 run).

---

## 2026-09 - Styling catalog locked by selection, not by another revision round

**Decision:** Stopped iterating on a single guessed visual direction and
built a component-level catalog instead: fourteen component categories,
each with three to five real rendered options, published as an
interactive artifact where Dave taps the one he wants. His fourteen
selections are now docs/STYLING_CATALOG.md, locked, and the checkable
rules are enforced by `src/laws/stylingLaws.test.ts`.

The picks: P1 solid pills, H1 dot-and-dotted-rule section headers, B1
solid square icon badges with one hue per field type, C2 solid cards
with a colored left rail, S2 solid numeric score pill, AV1 gradient
avatars, BT3 rounded-rectangle buttons, ST1 tinted stat tiles, TB1 solid
pill behind the active tab icon, J1 connected-dot stepper, F3 filled
borderless inputs, G3 tinted pill group tabs, E1 icon-plus-text empty
states, T3 solid pill toasts.

**Reason:** Two full-app preview revisions were both rejected on look
("This does not look like it referenced the Jarvis styling catalog at
all", then "Better but"). Each revision was a guess at one direction,
and a rejected guess teaches almost nothing about which direction was
wanted. Dave's own instruction was to stop and build the catalog first:
"we are going to need to create a styling catalog contract like we do
with Jarvis before we move forward." Showing options side by side on
identical sample content turns a taste question into a selection, which
is both faster and produces a contract as a byproduct.

**Alternatives considered:** A third revision mirroring the JARVIS
screenshots more literally. Rejected for the reason above, and because
it would still have left no written contract, so the fourth screen built
months from now would drift again. Also considered presenting the
options as three fixed packages (A/B/C); rejected after Dave asked for
a "FULL design catalog", and component-level picking turned out to
matter, since his final set mixes boldly (solid pills) and quietly
(tinted stat tiles and group tabs) in a way no single package offered.

**Consequences:** Three new color tokens were needed, since B1 requires
one hue per metadata field type and the existing five could not cover it
without reusing status colors as field types. They are named for their
role (`time`, `people`, `place`), not their hue, so a screen cannot
quietly start using the due-date amber for something unrelated.

More significant: solid fills forced a foreground problem into the open.
White on `--accent` (Apple systemRed) is 3.4:1 and fails WCAG AA, and
pills render at 11px bold, which is below the large-text threshold, so
the exemption does not apply. Every fill therefore ships as a
contrast-checked pair, `--solid-X` with `--solid-X-on`, and
`--solid-accent` is a deeper red than `--accent` rather than the same
value. `--accent` keeps its job (borders, underlines, text on dark) and
the new token takes the filled-background job. All seven pairs clear
4.5:1; the ratios are recorded in the catalog.

The catalog also overrides one inherited JARVIS structural rule: C2
(solid card, colored rail) replaces "chassis, not a card pile" for this
app's rows. That was Dave's call, made with both rendered in front of
him, and docs/DESIGN_SYSTEM.md now says so rather than contradicting it.

Only the tokens, `StatusPill` and the laws were converted in this pass.
The remaining screens still render pre-catalog treatments and get
converted screen by screen; the catalog's closing section lists exactly
which.


---

## 2026-09 - The palette is Apple's, and red stopped being a status

**Decision:** The app's palette is Apple's published iOS system colors,
verbatim, declared once as `--ios-*` primitives. What those colors mean
is a separate, generated tier. Red is reserved for the primary action and
pink for destructive ones; it is no longer a pipeline stage. The five
stages read as one progression (gray, blue, mint, orange, green) with
Committed green. The fit score renders as a tint rather than a solid.
Approved by Dave, 2026-09-15.

**Reason:** Dave rejected the previous color usage, naming the purple
(the old indigo `--info` carrying "In Contact") and adding "we could do
better overall." He then supplied a set of colors from a tool he already
uses. Sampling that screenshot gave approximations, but its indigo landed
on systemIndigo almost exactly, which identified the set as Apple's
system colors, so the values used are Apple's published ones rather than
JPEG samples of them.

Three problems were visible once the assignment was looked at rather than
the palette. Red was both the brand action color and the Committed stage,
so the Add button never stood out and the best outcome in the pipeline
looked like a button. Green meant both "Active" and "Offer". And the five
stages had no visual progression, so a board read as five unrelated
labels rather than as distance travelled.

**Alternatives considered:** Swapping the indigo for another hue and
leaving the assignment alone. Rejected: the purple was the symptom, and
the same collisions would have survived the swap. Four assignment options
were built and shown (progression, health-signal, near-monochrome, and a
no-blue variant); Dave instead supplied the palette and delegated the
assignment, so one proposal was built rather than four.

**Consequences:** The token tier is generated by `scripts/gen_tokens.py`
from a role map, emitting 42 contrast-checked pairs (worst case 4.52:1).
Changing what a status means is now a one-line edit there rather than a
contrast audit by hand.

Pair direction follows Apple's own convention rather than pure math:
white on red, pink, blue and indigo with the fill darkened until white
clears, dark text on yellow, orange, green, mint and teal with the fill
left at its exact Apple value. An earlier pass inverted this for mint and
produced a dark teal with no mint left in it, which is why the rule is
written down rather than left to the solver.

One law was retired: the old neutral fill sat at 1.87:1 against the page
and needed a hairline border to read as a shape. Apple's systemGray
clears 3:1, so the special case became a general law that every fill
reads as a shape.

The preview generator now parses the color maps out of
`src/components/statusHue.ts` rather than holding its own copy. The copy
drifted three times during this change alone, each time showing a color
the app does not use. A preview that disagrees with the app is worse than
no preview.

---

## 2026-09 - Doc AI gets a front end, on a stub model rather than no model

**Decision:** Built the upload, review-queue and apply screens on a stub
`ModelCaller` (`src/lib/docai/stubCaller.ts`) instead of waiting for an
Anthropic API key. Category detection is both automatic and overridable,
per Dave. Persistence is a new `documents` table (migration `0007`).

**Reason:** The extraction pipeline had been built, tested and wired to
nothing for several sessions, blocked behind a key that does not exist
yet. The pipeline already takes its model caller by injection precisely
so it can run without one, so the screens, the table, the routing and the
review flow can all be built and used now, and the only thing that
changes when a key arrives is which caller is passed in.

The stub is not a fake pretending to be real. It derives a deterministic
result from the file's own name and size, so one upload always behaves
the same way, and **every screen that displays a stubbed result says
"Simulated reading" out loud**. Shipping something that looked like it
had read a transcript when it had not would be the worst possible version
of this feature.

**Alternatives considered:** Writing the real Anthropic caller blind and
marking it untested. Rejected: it could not be run, so claiming it worked
would be a guess, and a wrong guess would surface as a production bug the
first time a key was added rather than here. Also considered leaving the
pipeline unwired until a key existed, which is what had already happened
for several sessions.

**Consequences:** `detectCategory()` is new in `pipeline.ts`. The triage
prompt already returned `detectedType` regardless of the category it was
told to expect, so detection costs one triage call and no new prompt. It
returns null rather than guessing on an ID document or an unreadable
page: guessing would send the wrong extraction prompt at it and produce
confident nonsense.

Ingestion runs in the browser and the pipeline runs on the server. That
split is forced: `ingest.ts` needs File, FileReader, createImageBitmap
and canvas, which is why it was verified with Playwright rather than
vitest in the first place.

The first version of the stub could not produce an auto-apply at all. Its
best case was 0.99 model confidence against 0.88 legibility, which is
0.83 effective once the coordinator weight applies, just under the 0.85
threshold in `provenance.ts`. The Applied screen was unreachable and the
stub looked fine in isolation. It is now banded once per file so triage
and extraction agree, and `stubCaller.test.ts` asserts the pipeline
actually reaches all three routes rather than only the easy one.

One law was added while doing this, for a rule that already existed and
had nothing enforcing it: the fit engine and Doc AI must not import
Next, Supabase, components, or read the environment. The stub was written
with a `process.env` check in it and that was caught by hand. It is now
caught by `src/laws/laws.test.ts`.

---

## 2026-09-16 - Grading scales: an org-scoped table, plus a labelled default

**Decision:** Two changes that together unblock the NCAA core GPA for
real athletes.

First, a new `org_grading_scales` table (migration `0009`), org-scoped
with ordinary RLS, writable by staff through the normal client. The
shared `high_school_grading_scales` table is unchanged and still
service-role only. Precedence, resolved in
`src/lib/fit/ncaa/gradingScale.ts`: a verified shared row wins, an org's
own entry is next, an assumed default is last, and the eligibility screen
says which one produced the number.

Second, when no table exists at all, numeric grades convert on the common
ten-point scale rather than being dropped. Dave's call: "we need a
default if the school isnt on file its not that big of a deal."

**Reason:** Migration 0008 locked the shared table behind the service
role because a wrong conversion table silently rewrites every eligibility
verdict for every athlete at that school, in every org. That was right
for shared data and wrong as a final answer, because it left the flagship
feature unusable: Dave's real transcripts print numbers, so no Bridge
athlete could be scored and there was no way to supply the missing table.

The objection was entirely about blast radius, and an org-scoped table
has the blast radius of one org. That is the same blast radius as an
athlete's GPA or a course grade that staff already type in, so ordinary
RLS is the boundary and staff is the right role. No owner gate and no
service role, unlike `createSchool`.

**Consequences:** The engine no longer refuses to produce a number, which
was a deliberate property before this. That trade is only honest while
the assumption travels with the number, so it does, in four places: the
GPA carries an adapter warning naming the school, the verdict screen
shows a "How the grades were converted" attribution per school, the
missing-scale note links straight to the entry form, and an assumed
conversion never earns the weighted-grade bonus. Three laws in
`src/laws/ncaaLaws.test.ts` hold those conditions, each proven to fail
against code without them.

Two real defects fell out of the work:

- `gradingScaleProblem()` rejected every band wider than 40 points,
  which is every complete grading table there is, because an F band runs
  0 to 64. The Doc AI path would therefore have refused any transcript
  legend that printed an F row and reported that the table "was not
  saved" without anyone understanding why. The span check now skips the
  lowest band, which is open-ended by nature.
- That check lived inside `src/lib/actions/documents.ts`, so only the
  Doc AI path could reach it and it could not run in the test bench. It
  moved to `src/lib/fit/ncaa/gradingScale.ts` and both paths import the
  one copy. It also gained an ordering check: a table whose A band sits
  below its C band passed every previous check and produced a core GPA
  that looked perfectly ordinary.

This also closes the "weighted bonus is unreachable" gap recorded in
ROADMAP.md. `reports_weighted_grades` had defaulted false with nothing
ever setting it, so every AP athlete got an understated core GPA and a
warning about their school not being on record that nobody had been
asked about. The entry form asks both conditions and the real bonus
amount, because the NCAA's 1.00 is a cap and not the value.

---

## 2026-09-16 - RLS enforces the role, and the server checks the bytes

**Decision:** Migration `0010` replaces every `for all` org-scoped policy
with a read policy keyed off membership and three write policies keyed
off a new `_staff_org_ids()` helper. `src/lib/docai/acceptance.ts`
re-validates every uploaded file on the server before anything is
written.

**Reason:** Both were real holes, both found by the adversarial audit and
recorded rather than fixed at the time.

The anon key ships to the browser, so a user with role `member` could
open a console and write to any org-scoped table in their own org
through PostgREST with their own token: change a GPA, delete a target,
rewrite a grading scale. `requireRole(..., STAFF_ROLES)` guards the
server actions, but a server action is not the only way in.

Separately, the size cap, format sniffing and HEIC refusal all lived in
`ingest.ts`, which runs in the browser. A direct call to `processDocument`
skipped all three.

**Consequences:** The policy loop in `0010` is written as a `do` block
over an explicit table list rather than 36 hand-typed statements,
because the failure being guarded against is one table quietly not
getting the same treatment as the others.

`benchmark_sets` was the one table that could not go through the loop,
and it turned out to hide a second bug: its policy was
`for all using (org_id is null or org_id in (...))`, which made the
shared null-org benchmark row, the one every organization reads,
writable by any member of any org.

The test suite is the other half of this. Every assertion in
`scripts/rls_test.sql` ran as an owner, which is precisely why the
missing role check survived a test suite that otherwise proved
cross-org isolation properly. It now seeds a third user who is a
`member` of Bridge and `staff` of Elite Squad at the same time, which
also proves the role check is scoped per org rather than global: a
helper that forgot its org filter would pass every other assertion in
the file. 55 assertions, up from 35, and reverting the policy to the
old shape fails it.

`MAX_INGEST_BYTES` moved from `ingest.ts` to a new `limits.ts`. It had
to, because the server could not import the browser-only module to
reach it, which is part of why the server had no size check at all. Two
copies of a size cap is how they end up different, and the server's
being the larger of the two is the failure mode, so a law now checks
there is only one.

The acceptance check compares the decoded byte length, never
`originalSize`, which is the client's own claim about a file. It also
refuses a PDF sent as an image and an image sent as a PDF, because that
mismatch makes the pipeline send the wrong content block type and fails
downstream in a way nobody can diagnose from the error.

---

## 2026-09-16 - Discarding a document undoes it, and says what it could not undo

**Decision:** An apply records what it changed on
`documents.applied_changes` (migration `0011`), and `discardDocument`
reverses it: course rows removed, the athlete's previous GPA, verified
flag and date of birth restored, and a shared grading scale deleted if
this document is the only reason it exists. The plain-language account of
what happened is stored in `documents.undo_note` and shown on the screen.

**Reason:** Discarding set a status and left everything in place, with no
path anywhere in the app to remove it. A transcript applied to the wrong
athlete stayed on that athlete's record permanently, indistinguishable
from data somebody had typed in, while the screen said it had been
discarded. That is worse than not being able to discard at all.

The Discard button also only appeared on `pending` documents, so an
applied one could not be undone even in principle. It now appears on
applied documents and says "Undo and discard".

**Consequences:** The undo is deliberately conditional. Each field is
restored only when its current value still matches what the document
wrote, because somebody may have corrected the GPA by hand afterwards,
and reverting their correction to a number from before the document
existed would be the worse mistake. That comparison is the subtle part:
`numeric(3,2)` comes back from Supabase as a string, so `===` would have
refused every GPA undo and the feature would have silently done nothing.
The rule lives in `src/lib/data/undoPlan.ts` rather than in the server
action, because a `"use server"` module can export nothing but async
actions and therefore cannot be unit tested.

Three things an undo honestly cannot do, all of which it says out loud
rather than papering over:

- Course rows from an earlier transcript for the same school were
  already deleted when this document superseded them. They are gone. The
  count is recorded at apply time so the undo can report it.
- A field changed since the apply is left as it is.
- A grading scale somebody has confirmed since is kept. The shared table
  is read by every org, and removing a row another organization may now
  rely on is not this document's call once somebody has vouched for it.

A document applied before this existed has no record to work from. Its
course rows are still removed, because they carry `document_id` and are
found by query, but the undo says plainly that any GPA or date of birth
it wrote is still there.

---

## 2026-09-16 - A course carries its own school

**Decision:** `courses[].school` added to the transcript extraction
schema and prompt, null when the row does not say. The write resolves
per course, falling back to the transcript header, and supersedes once
per distinct school in the batch.

**Reason:** `athlete_courses.school_name` and `buildEligibilityView` had
supported two schools since the core-GPA work, but the extractor could
not express it, so every course from one document took that document's
single header school. A transfer student's transcript legitimately
covers two schools that convert numeric grades differently: an 85 is a C
at one and a B at the other. Half the transcript converted through the
wrong table, and the error is invisible, because the resulting GPA looks
perfectly ordinary either way.

**Consequences:** A second bug was sitting behind the first. The course
write deleted existing rows for the header school only, so as soon as a
document could name two, the second school's existing rows would have
survived alongside the new ones and every credit at that school would
have doubled. That delete now runs once per distinct school in the
batch, which also feeds the undo's superseded count correctly.

The stub caller produces a transfer transcript above a seed threshold,
so the path is reachable without an API key, the same way the three
eligibility outcomes already were. Not on every seed, or every stubbed
athlete would look like a transfer student.

---

## 2026-09-16 - Fundraising, modelled on what Bridge already tracks

**Decision:** Migration `0012` adds donors, gifts, pledges, campaigns,
grants and a per-category budget. The rollup is pure and testable
(`src/lib/fundraising/rollup.ts`). Screens live under
`/org/[slug]/fundraising`, gated on `orgs.modules.donor_fundraising` in
both the pages and the server actions.

**Reason:** Today's "Program overview" had been a coming-soon
placeholder with no table behind it since the redesign. The model is not
invented: Dave's existing BFFSA platform app already tracks donors, a
transaction ledger and a P&L with five revenue categories against a
full-year budget, so this uses the same five categories with the same
labels and a report out of this system reconciles against the one his
board already sees.

**Alternatives considered:** Copying that app's shape exactly. Rejected
in three specific places, each for a reason.

**Consequences:**

- `total`, `last` and `init` are not columns on the donor. They are
  derived from the gift rows. A stored lifetime total drifts the first
  time a gift is corrected or removed and nobody fixes it by hand, and a
  wrong donor total nobody can explain is worse than a sum.
- A pledge is its own table rather than a gift with a flag, so no query
  summing donations can accidentally include money that has not arrived.
  Dave asked for pledges explicitly.
- Grants are a table, not only a revenue category. Dave: "We don't have
  grants yet but build it for when we do." Most of a grant's life is
  dates that matter before any money exists. Awarded money still arrives
  as an ordinary gift in the `grant` category, linked back, so nothing
  is counted twice.

Four rules are enforced as laws, each proven to fail against code
without it, because each is a way a board report goes quietly wrong
rather than visibly wrong:

1. A pledge is never inside a total, only beside it. Overstating the
   year is the most damaging thing this feature could do, because nobody
   questions a number that is too good.
2. An in-kind gift is support and never cash. A donated case of food in
   the cash figure tells a treasurer there is money to spend that does
   not exist. An in-kind gift with no description of what was given is
   refused, because that is the first thing an auditor asks about.
3. Money is integer cents everywhere. Postgres returns numeric as a
   string, forms return strings, and JSON returns numbers; all three
   convert once, in `toCents`. A long enough donation list summed as
   dollars drifts by a cent.
4. The module gate is checked in the actions, not only on the screens. A
   server action is a public endpoint, and a page that never renders for
   Elite Squad is not the same thing as an endpoint they cannot call.

The unique index on `(org_id, external_ref)` is what stops a replayed
Stripe webhook booking the same donation twice, which would be wrong in
the direction nobody questions. Bridge takes donations through Stripe
payment links today, so that path is real and not hypothetical.

---

## 2026-09-16 - Two orgs on one database, and what that found

**Decision:** `scripts/seed_two_orgs.sql` stands up Bridge and Elite
Squad as real organizations on one database and asserts the claims the
architecture has been making since day one. `scripts/run_two_org_test.sh`
applies every migration in order and runs it.

**Reason:** Multi-tenancy has been a rule in CLAUDE.md, a column on every
table and a policy on every table, all on the strength of an intention.
Nothing had ever run two actual organizations side by side. The point of
doing it now rather than later is that there is still nothing to migrate
when it turns out to be wrong.

**Consequences:** The seed asserts that the two orgs differ in exactly
three jsonb columns and nowhere else. If anything but `role_labels`,
`modules` and `branding` has to differ for both to work, the claim is
not true, and the test says so.

It found one real gap immediately. `orgs.role_labels` has existed since
migration `0001` and was never read anywhere: `getOrgBySlug` did not even
select the column. The whole reason `org_role` is generic
(owner | staff | member) is that what a person is CALLED is org config,
Bridge saying Executive Director and Coordinator while Elite Squad says
Owner and Coach. Every screen was showing the enum value or nothing.
`src/lib/org/roleLabels.ts` parses it the same way `modules` is parsed,
and three laws now hold it: the query selects the column, at least one
screen renders the label, and no screen prints a raw role value as if it
were a title.

The seed contains no real athlete, donor or member data. Every name in
it is invented, because real student and donor records do not belong in
a repo.

What this does not yet prove: signing in as a member of each org and
using the app. That needs a Supabase project, which does not exist.

---

## 2026-09-16 - Board governance, and what "give/get" actually requires

**Decision:** Migration `0013` adds `boards` and `board_members`, and
adds a `solicited_by` column to both `gifts` and `pledges`. The give/get
rollup is pure and tested (`src/lib/governance/giveGet.ts`). Four screens
under `/org/[slug]/board-governance`, gated on
`orgs.modules.board_governance` in the pages and in the actions.

**Reason:** The last module still gated off with nothing behind it, and
Bridge is actively restructuring its board. The structure is not
invented: it comes from Bridge's own governance document, which sets five
tiers with an amount each (Executive $10K, General $5K, Sport $5K,
Development $1K, Junior $500) and says a sport board starts at three
seats and can grow to five with a Sport Director, a Board Chair and a
Recruiting Lead.

**Consequences:** The phrase is "give/get" and both halves count. A
member meets their commitment by giving the money themselves or by
bringing it in from somebody else. That is a schema requirement, not a
display choice: without a column recording who brought a gift in, the
app can only ever report personal giving. Most board software gets this
wrong, and the effect is that every member who is good at fundraising
looks like they are behind.

Four rules are held as laws, each proven to fail against code without
it:

1. Money brought in counts. Dropping the "get" half is the default
   failure mode of this whole feature.
2. A gift somebody both made and is credited with soliciting counts
   once, or a $10,000 commitment clears on $5,000.
3. A pledge sits beside progress and never inside it, and an in-kind
   gift does not discharge a cash commitment. Both carried over from the
   fundraising rollup, which this module reuses rather than duplicating.
4. Only an active seat carries a commitment. A prospect has not joined
   and an emeritus member is not on the hook, so counting either makes
   the board look further behind than it is, which is the mirror of
   overstating and just as wrong.

A seat's commitment is copied from the board rather than referenced, so
changing a tier's amount later does not silently rewrite what a sitting
member agreed to. A founding member on a reduced commitment is a real
thing, and the alternative is somebody keeping a spreadsheet.

The tier amounts and seat ranges ship as defaults to edit, stored per
board. Bridge's numbers are Bridge's; another organization with a board
sets its own and no code changes.

## 2026-09-16 - A partial approved-course list may confirm a course but never exclude one

**Decision.** `ncaa_approved_course_lists` and `org_approved_course_lists`
each carry an `is_complete` flag, and
`src/lib/fit/ncaa/approvedCourses.ts` treats a list marked partial as
able to answer only "yes". A course absent from a partial list stays
unchecked. A course absent from a complete list is excluded from the
core GPA.

**Reason.** Absence is only evidence when the list is exhaustive. The
Eligibility Center's published list for a school is exhaustive; a list
somebody typed from the three courses in front of them is not. Without
the distinction, a half-entered list silently drops real core courses
out of an athlete's average and tells them they are short on credits
they actually earned. That failure is invisible: the GPA still renders,
and it renders as confidently as a correct one.

**Alternatives considered.** Treating every list as complete, which is
simpler and wrong in exactly the direction that costs an athlete a
season. Treating every list as partial, which makes the feature
pointless, since excluding off-list courses is the entire mechanism by
which a transcript average becomes a core GPA.

**Consequences.** `approvedListProblem()` refuses to accept fewer than
eight courses as a complete list, because a handful of rows is never a
high school's whole catalog. Entry screens have to ask which kind of
list is being entered, and say what the answer costs. Two laws in
`src/laws/ncaaLaws.test.ts` hold the line, both proven to fail on a
planted violation.

## 2026-09-16 - An ambiguous course title is never resolved by guessing

**Decision.** When a transcript title matches two or more entries on a
school's approved list equally well, `matchCourseTitle()` returns
`ambiguous` and the course stays unchecked. It never picks one.

**Reason.** Picking an entry picks its subject area and its credit cap
too, and both feed the per-subject minimums the engine checks. A wrong
pick does not shade a number, it can report a subject minimum as met
when it is not. "Biology" against a list carrying both "AP Biology"
(science) and "Biology Honors" (other academic) is a real shape, not a
contrived one.

**Consequences.** The screen distinguishes ambiguous from unchecked even
though the engine treats both the same, because they need different
actions from a human: one needs a list, the other needs somebody to say
which course it was. The abbreviation table in `approvedCourses.ts` is
kept deliberately short for the same reason: every entry in it is a
chance to collapse two different courses into one.

## 2026-09-17 - The type glyph replaces the coloured left rail

**Decision.** C2's 5px coloured left border becomes a leading type glyph
in the same colour. `RailCard` takes an optional `kind`; with one it
renders the glyph, without one it still renders the stripe. Drawings live
in `src/components/rowIcons.json`, read by the component and by every
generator.

**Reason.** Dave, 2026-09-16, after clicking through the prototype:
"let's use icons like Jarvis does to identify categories instead of the
color highlight." The stripe could only ever say status. Every row in a
list wore one, so eight rows read as eight coloured stripes with no
indication of what any of them was. The glyph carries the kind and keeps
the status in its colour, so a row answers both before it is read.

**Alternatives considered.** JARVIS's tiled form (`RowIcon`, a glyph on a
tinted square). Rejected for the same reason JARVIS keeps it off list
surfaces: a filled tile on every row is heavier than the stripe it was
meant to lighten. It remains the right treatment for stat and banner
surfaces here too.

**Consequences.** The stripe is retained deliberately for rows that are
prose rather than records, because a type mark on a paragraph labels the
wrong thing. Two laws hold the single icon set. A third law checks every
role has a foreground colour class, after the first pass of this shipped
with orange and mint glyphs rendering black: the Tailwind classes had
never been generated, and the markup looked perfectly correct. The
prototype walkthrough now asserts computed colour, not class names.

## 2026-09-17 - Detail gets its own page rather than grey under every row

**Decision.** Explanatory text comes off the working screens and onto
pages built for it. The eligibility screen's stack of caveats collapses
to one row that opens a "Things to know" page carrying all of them in
full. A "How this works" page under More explains core GPA, approved
lists, grading scales, fit scoring, pledges and give/get at length.

**Reason.** Dave, 2026-09-16: "if we don't have to use subtext in
certain spots or can tighten it up, that would be great. Could also have
a page that's very informative where it doesn't matter." The caveats are
all real and none can be dropped, so the choice was never whether to say
them but where. Five stacked paragraphs were the lower half of the
eligibility screen and pushed the core-course breakdown below the fold.

**Consequences.** A screen may now assume its explanation exists
somewhere reachable, which is what lets a row carry a fact instead of a
justification. The caveats page also carries the actions the caveats
imply (enter a grading scale, enter an approved list), so reading them
leads somewhere.

## 2026-09-17 - An audit that renders every screen, not just the ones somebody walks

**Decision.** `scripts/audit_prototype.mjs` renders all 103 prototype
screens in both themes and both organizations (412 renders) and inspects
what the browser computed: every token utility resolves to a real value,
every glyph has a drawing, no sideways scroll at phone width, body text
clears WCAG AA against the surface it actually sits on, every tappable
row is at least 44px, nothing throws, nothing renders empty. It runs as
the last step of `scripts/build_previews.sh`.

**Reason.** `verify_prototype.mjs` walks the paths a person takes and
asserts behaviour, which is the right tool for "does the app do the right
thing" and the wrong one for "does it look right where nobody looked."
The type glyphs shipped rendering black because `text-ios-orange` was in
the class list and absent from the stylesheet. No assertion about markup
would have caught it, and no walkthrough visits every screen in both
themes.

**Consequences.** The first run found three real defects, all invisible
to the existing tests and all now laws:

- `text-solid-accent` used as a text colour in 16 places. A solid fill
  exists to be painted behind its paired `-on` foreground; used as text
  it bypasses the pairing and read 4.65:1 on white and 3.74:1 on the dark
  card, so it passed in light and failed in dark. Replaced with
  `text-tint-accent-on`, which is the themed, paired, legible foreground
  for that hue (6.87 and 6.24).
- `--muted` at #6b7280 cleared AA on `--paper` (4.83:1) and missed it on
  `--bg` (4.40:1). Muted text on the page background is most of the app:
  every section header, every back link, every date. Darkened to
  #646e7a, which clears both.
- The back link was 15px tall on all 23 screens that have one, and it is
  the control people use most. Stage chips were 17px, inline actions
  18px, rows 43px. All now clear Apple's 44px minimum.

The audit exits non-zero on any finding, so the preview build fails
rather than publishing a screen nobody can read.

## 2026-09-17 - Every grading scale in the product was being ignored

**Found** while wiring the approved-course screens, not by a test.

The eligibility page queried only `high_school_grading_scales`, never the
org-scoped table migration 0009 added, and cast the result to
`GradingScaleRow` without an `origin`. No such column exists: the app
derives that label. So every row arrived with `origin: undefined`,
`resolveScale()` matched none of its three cases and returned null, and
every school on every athlete fell through to the assumed ten-point
default. Both halves of the feature were inert, and the screen reported
the resulting number the same way it reports a real one.

**Fix, in three places.** The page queries both tables and maps each row
explicitly with its origin, so a missing field is now a type error rather
than a silent undefined; the `as GradingScaleRow[]` cast that hid it is
gone. `resolveScale()` falls back to the first candidate rather than
returning null, because a real table with an unrecognised label is still
a real table and dropping it substitutes a guess. The adapter labels such
a row "org" rather than "verified", so it is used but never presented as
confirmed and never earns the weighted bonus.

**Consequences.** Two laws in `src/laws/ncaaLaws.test.ts`, both proven to
fail on a planted violation: a real scale is never silently replaced by
the assumed default, and the eligibility screen reads the org's own
scales. The general lesson is about the cast: `as` on a query result
turns a missing column into undefined at runtime and silence at compile
time, which is exactly the shape of this bug.

## 2026-09-17 - Paste is the primary way a course list gets entered

**Decision.** The approved-list entry screen leads with a paste box, not
a row builder. `parseApprovedListPaste()` splits the pasted table, works
out which cell is the title and which is the NCAA category, and returns
per-row problems. Adding a row by hand is the fallback.

**Reason.** A high school's approved list is eighty to a hundred courses.
Entering that through a form with a subject dropdown per row is an
afternoon on a phone, and an afternoon is the same as never: the feature
would ship and go unused. The list is already a table on the Eligibility
Center's page, so selecting it and pasting it is ten seconds.

**Consequences.** The parser refuses to guess a subject, the same way
`matchCourseTitle()` refuses to pick between two candidates, because the
subject decides which per-subject minimum a course counts toward. Rows
needing a decision sort to the top of the review list and the save button
stays disabled until none are left. One real parser bug was caught by its
own tests: stripping digits before matching a category turned "English 9"
into "english", so the title was consumed as the subject and the course
imported with no title. A cell containing a digit is now never a
category.

## 2026-09-17 - Laws about the app as a whole, not about one function

**Decision.** `src/laws/dataLaws.test.ts` checks properties that are only
visible across the whole codebase at once: no table is written and never
read, no query takes its table name from a variable, and a file that
computes with a shared reference table also reads the org-scoped half of
the pair. The RLS coverage check lives in `scripts/rls_test.sql` instead,
where it asks the real database which tables carry `org_id` and which of
those are unguarded.

**Reason.** The grading-scale bug was correct on both ends and broken in
the middle: the entry screen wrote, the index listed, the eligibility
page never read. Every unit test passed because each half is right on its
own. Nothing that looks at one function can see it.

**Alternatives considered.** Checking RLS coverage by regex over the
migration SQL. It cannot work: the fundraising and governance policies
are created in a DO loop with `format()`, so the policy names never
appear as literals. The first version of this law reported eight false
failures before it moved to Postgres.

**Consequences.** Two allowlists, `NOT_APP_TABLES` and
`DYNAMIC_ALLOWED`, each entry carrying a reason, so adding to one is a
decision rather than a way to quiet the check. The dynamic-table rule
also drove a real change: the approved-list detail page picked its table
with a variable, which would have hidden that table from the orphan
check, and it now uses two literal branches.

Applying the laws immediately surfaced a second defect. Doc AI saves a
grading table it read off a transcript into the SHARED table with
`verified_at` null, so "shared" and "confirmed with the school" are
different claims. The eligibility page was labelling every shared row
verified, which let a scale OCR'd from a parent's phone photo outrank a
table a coordinator typed off the school's printed legend. Precedence is
now: confirmed shared, then the org's own entry, then unconfirmed shared,
then the assumed default.

## 2026-09-17 - One loader for every screen that needs a core GPA

**Decision.** `src/lib/data/loadEligibility.ts` owns the query behind the
eligibility verdict, the transcript and the per-course approval check:
the athlete, the courses, both grading-scale tables with their origin
labels, both approved-list tables, the division, and the built view. The
eligibility page no longer carries it inline.

**Reason.** Three screens want the same thing. Left inline on one page,
the second screen's obvious move is a second copy, and a second copy that
reads one grading-scale table instead of two is exactly the bug that sat
in that file for a release. `pickDivision` was already a second copy of
the engine's normalizer once, and had drifted.

**Consequences.** The laws that check both scale tables are read, and
that a confirmed shared scale is told from an unconfirmed one, now point
at the loader rather than the page. Both were re-proven to fail on a
planted violation at the new location.

`CoreCourse` gained an optional `term`, carried through from the
transcript and used in no calculation. Without it the only key back to
the transcript row is the title, and both halves of a year-long course
answer to that, so the transcript screen would show one half's grade
against both rows.

## 2026-09-17: pills lose their colour fills; one type scale step up; icons redrawn

**Decision.** Three changes Dave asked for in one pass, after clicking
through the prototype on his phone.

1. No pill, chip, badge, group tab or card carries a `bg-tint-*`,
   `bg-solid-*` or `border-l-[5px]` fill. The 5px rail went in the same
   pass, an hour later, when Dave looked at the roster and said "there's
   color right here": it was the last coloured block left, and on that
   row it was the third thing on one line saying status, after the avatar
   and the stage pill. `RAIL` is deleted from `statusHue.ts` rather than
   left unused. Each is a glyph in the role's hue plus a plain
   label, which is the anatomy the type glyph already used. `Chip` in
   `src/components/catalog.tsx` is the single implementation.
2. Every `text-[Npx]` moved up one step of the scale, in a single pass.
   Body copy 12.5 to 13.5, the smallest label 10.5 to 11.5, titles 20 to
   22. The table is in docs/STYLING_CATALOG.md.
3. `src/components/rowIcons.json` redrawn: 2.0 stroke at 20px instead of
   1.75 at 18px, everything inside a 20x20 safe area, no feature under 2
   units, `visit` and `pledge` given marks that mean what they say, and a
   new `stage_*` set for the recruiting stages.

**Reason.** Dave: "let's make sure there's no color highlights on the
pills like in pic two, we said we were going with icons, make sure it's
consistent throughout. Also let's improve the quality of the icons. Font
size in the app is a little small as well."

The inconsistency was real and was ours. The type glyph landed on
September 16 and the pills kept their fills, so a roster row carried a
bare coloured mark at one end and a filled coloured block at the other,
both saying status.

**Consequences.**

- `TEXT_ON` is a new map in `statusHue.ts` and the reason it exists is
  worth keeping in mind: dropping the fill moves the colour onto the
  mark, and `FG` (the raw iOS hue) is fine as a 2px stroke and 2.02:1 as
  text. The first build of the bare coloured score number produced
  twenty-six AA failures. A glyph takes `FG`; a word or a number takes
  `TEXT_ON`.
- Five laws in `src/laws/stylingLaws.test.ts` hold the line: no fill in a
  `rounded-full` class string, no `${TINT[...]}` interpolated into one,
  no text size in the same class string as an `FG` lookup, no
  `border-l-[5px]` or `border-l-ios-*` anywhere, and no `RAIL` map to
  rebuild one from. All five were planted, watched to fail, and reverted.
  The rail law immediately found six hand-written rails outside
  `RailCard` that nobody had been looking at.
- Selectable controls (subject picker, stage picker, Doc AI categories)
  show "chosen" with a ring rather than a fill. A control has to show
  state; it does not have to show it with a coloured block.
- Buttons keep their solid fills. Reserving red for the primary action is
  older than any of this, and an action that does not look like a button
  is not a styling problem.
- The prototype had a hand-written copy of `STATUS_ROLE` that predated
  the generator parsing it, missing three of the eight statuses. Deleted
  in this pass; the generator now parses `STATUS_ROLE`, `STAGE_KIND`,
  `TEXT_ON` and `FG` out of the component, like the rest.

**Alternative considered.** Keeping the fill on the stage pill alone, on
the grounds that a stage is the one status worth shouting. Rejected: that
is exactly the "it is different here" reasoning that produced the
inconsistency in the first place, and the stage is now the most legible
mark on the row anyway, since it is the only one with both a shape and a
hue.

## 2026-09-17: org_members stays service-role only, and the RLS suite checks policy SHAPE

**Decision.** `scripts/rls_test.sql` gained a structural check: every table
carrying `org_id` must have a SELECT policy, an INSERT policy, and no
`for all` policy. `org_members` is the one exemption, with its reason in
the script.

**Reason.** The suite had 69 hand-written assertions and one structural
one ("has RLS and at least one policy"). "At least one policy" is weaker
than it sounds in two directions, and both have already happened in this
repo:

- Too few. A table with only a SELECT policy is readable and writable by
  nobody. A feature built on one saves nothing and reports no error,
  which is the shape of the grading-scale bug that produced
  `src/laws/dataLaws.test.ts`.
- Too many. A single `for all` policy satisfies "has a policy" and lets
  any MEMBER write, which is exactly what migration 0010 was written to
  undo. Nothing had stopped one coming back since.

Running it immediately found `org_members` with a SELECT policy and
nothing else.

**That one is deliberate, and now says so.** Membership is what grants
access to everything else, and the row carries its own `role` column. An
INSERT policy keyed off `_staff_org_ids()` would let any staff member
write themselves a second row as owner of their own org. There is no
invitation flow yet; when there is, it belongs behind the service role or
a SECURITY DEFINER function that cannot be handed a role, not behind an
ordinary policy.

**Consequences.**

- The check covers tables that do not exist yet, which is the point. A
  planted `plant_notes` table with a read policy and nothing else was
  caught by name; no hand-written assertion could have, because no
  hand-written assertion exists for a table nobody has written.
- Three assertions written in the same pass, about the shared NCAA
  approved-list table being readable by all and writable by none, were
  deleted rather than kept: lines 387 to 400 already covered exactly that
  and the plants proved it. Two checks that pass for the same reason are
  one check and a maintenance cost.
- All fourteen migrations apply cleanly to a real Postgres 16 and the
  whole suite passes, which is also the first time `0013` and `0014` have
  been run end to end in this session rather than trusted.

## 2026-09-17: a law that compares every select against the schema

**Decision.** `src/laws/schemaLaws.test.ts` parses the column list out of
every `create table` and `alter table ... add column` in `migrations/`,
parses every `.from("t").select("...")` in `src/`, and fails if a query
names a column the schema does not have. Embedded tables and
`alias:column` are both checked.

**Reason.** The same mistake happened twice in one afternoon, in both
directions: `loadTarget.ts` selected `coach_email`, which does not exist,
and the donor page put `board_id` in a cast and not in the select. A
column name is a string, and a string is invisible to TypeScript. The
schema is also a string, in a .sql file, so this is the only place the
two can be compared.

**It found a live bug on its first run.** `target_communications` has
`occurred_on` and `target_visits` has `visit_date`; both the target page
and `loadTarget.ts` were asking for `occurred_at`, which neither table
has. PostgREST would have errored on every load of the target page and
the whole contact log. The target page has been wrong since it was
written; `loadTarget.ts` inherited it by copy an hour after.

**Consequences.**

- Three plants, all caught: the real `occurred_at`, the same column
  hidden behind an `at:occurred_at` alias, and a `jersey_number` inside
  an `athletes(...)` embed.
- It deliberately does not validate the whole PostgREST select grammar.
  It checks plain columns, embeds and aliases, and skips what it cannot
  parse confidently rather than guessing. A law that reports a false
  failure earns an allowlist entry within a week and stops meaning
  anything.
- A sanity assertion guards the parser itself: the schema must have more
  than fifteen tables and the app more than forty queries, and
  `recruiting_targets` must have `coach_name` and not `coach_email`. A
  broken regex would otherwise show up as zero problems and zero work.
- No select in the app is built by interpolation, which is a third
  assertion. A runtime-built column list is invisible to this check for
  the same reason a runtime-built table name is invisible to
  `dataLaws.test.ts`.

**The bug this did not catch and nothing yet does:** the pages are all
`force-dynamic` server components, so nothing in the repo ever executes
one. `npm run build` type-checks them and never runs them. A real
rendering harness against a seeded database is the next honest gap.

## 2026-09-17: every page is executed by a test, against a fake client

**Decision.** `src/laws/pageRender.test.ts` calls every page function
directly, renders the element tree it returns to a string, and asserts on
the output. `src/testing/fakeSupabase.ts` stands in for the client and
`src/testing/fixture.ts` is the invented dataset. 33 routes, plus the
awkward-row, module-gate, signed-out and member-role cases.

**Reason.** Nothing in the repo had ever executed a page. Every one is a
`force-dynamic` server component, so `npm run build` type-checks them and
stops. The click-through prototype is a second implementation of the same
screens sharing the engine modules and none of the page code, so it
proves nothing about them.

That left a class of bug with no check anywhere: a field read off a null
row, an embed mapped as an array when PostgREST returned an object, a `!`
on something genuinely absent. None of it is visible to tsc through an
`as` cast, and each one is a blank screen.

**How it works.** The pages are async functions returning ordinary JSX,
so awaiting the function is enough and React never has to resolve an
async component. `notFound()` and `redirect()` throw sentinels, as Next
does, so a page that bails is asserted on rather than counted as a pass.

**Consequences.**

- The fake reproduces PostgREST's embed shape rather than always
  returning an array: many-to-one arrives as an object, one-to-many as an
  array. Always returning an array is precisely the assumption the
  `unwrap()` helpers in three files exist to survive, so a fake that did
  that would hide the bug it is meant to catch.
- It throws on any builder method it does not implement rather than
  returning an empty result. An empty result would render a blank page
  and pass.
- The fixture is deliberately awkward: an athlete with no GPA, a target
  with no coach, a gift with no donor, a donor on no board, a seat with
  no donor record, a course at a school with no grading scale, a failed
  document. A fixture where every row is complete tests only the happy
  path, which is not where a page throws.
- A separate assertion checks the hand-written page list against the
  filesystem, because a list written by hand rots the moment somebody
  adds a route. A planted `plantscreen/page.tsx` was caught by name. The
  list stays hand-written rather than globbed: a glob would let a new
  page join without anybody deciding what its arguments are.
- Writing the fixture found one bug in the fixture itself, which is
  worth recording because it is the kind of thing a reader will hit:
  `route` and `status` are separate enums in 0007, and putting the route
  value "review" into `status` made the queue render nothing.

**Three plants, and two of them failed the first time.** A field read off
a possibly-null row passed, because the fixture had no donor without a
board seat. An embed treated as an array passed, because the assertion
checked only the page title and the row degraded to "Unknown athlete"
rather than throwing. Both were gaps in the harness, not in the code, and
both are fixed: the fixture gained the missing row and the assertion now
checks the row rather than the heading. A plant that does not fail is the
only way to find out that a test was never testing anything.

## 2026-09-18: the server actions are executed by a test, and vitest went to 5

**Decision.** `src/laws/actionRun.test.ts` runs the server actions against
the same fake client the page harness uses, now extended to record every
write. The fifteen form screens joined the render harness at the same
time, and nothing in `src/app` is exempt from it any more.

**Reason.** The actions were the largest untested surface in the repo.
What was tested is the pure validation module each one calls, which is
the easy half. The untested half is the glue, and the glue is where the
dangerous mistakes live: the authorization check, the org stamp on the
row, the cross-org guard on a foreign key, the error branch.

A missing `org_id` on an insert is not a crash. It is a row in the wrong
org that reads back as missing data weeks later, and nothing in the type
system has an opinion about it.

**Six laws, each planted and watched to fail:** a created row carries its
org; a member cannot write; a module-gated action checks the gate; a
foreign key from another org is refused; an update is scoped to the org
and not just the id; the error branch reports rather than redirecting.
Plus one on `revalidatePath`, because forgetting it produces the most
confusing bug a form can have: it saved, and the screen says it did not.

**One test was passing for the wrong reason and the plant is what found
it.** The cross-org guard test used `"foreign-athlete"` as an id. The
form parser rejects a malformed UUID before the guard is ever reached, so
removing the guard entirely did not fail the test. It uses real UUIDs
now, and asserts the guard's own message rather than merely that some
error came back.

**The fake gained a `boards` embed** because a form screen asked for one
and the fake threw by name rather than returning an empty object. That is
the behaviour it was built for, working.

**vitest 2 to 5.** `npm audit` reported 5 vulnerabilities including one
critical, all in vite and vitest, both dev-only and never shipped. The
fix needed a major bump. All 585 tests, the build, the RLS suite and the
prototype audit pass on the new version unchanged. `npm audit` now
reports zero.

**Consequence worth noting.** The render harness has no exemptions left.
The forms were excluded on the grounds that "a render proves nothing
about a form that has to be posted", which was true of the posting and
false of everything else: a form that throws while listing the athletes
to choose from never gets as far as being posted.

## 2026-09-19: membership helpers move to an unexposed schema

**Decision.** `_member_org_ids()` and `_staff_org_ids()` move from
`public` to a new `private` schema (migration 0015), and every policy is
rewritten to call them there.

**Reason.** PostgREST publishes every function in an exposed schema as an
RPC endpoint. In `public`, both helpers were callable over HTTP at
`/rest/v1/rpc/_member_org_ids` by anon and by any signed-in user, and
both are SECURITY DEFINER. Found by Supabase's own security advisor the
first time the migrations were applied to a real project, which is a
class of finding local Postgres cannot produce because there is no
PostgREST in front of it.

**Alternative considered and rejected.** Revoking EXECUTE. A policy's
USING clause is evaluated as the querying role, so a role without EXECUTE
cannot be checked against a policy that calls the function: every
org-scoped read would fail with a permission error instead of returning
no rows. Verified rather than assumed.

**Consequences.** The 78 affected policies are rewritten programmatically
from the catalog rather than from a hand-written list, because they were
written across three migrations in three shapes and a hand list silently
misses one. The migration raises if it rewrites fewer than 40.
`scripts/rls_test.sql` now asserts no `%_org_ids` function remains in
`public` and no policy references one; skipping 0015 makes it fail.

**What this says about the verification stack.** Six layers of local
checking could not have found this. A real project is now the seventh.

## 2026-09-19: the first real deployment, and what it found

**Decision.** The code lives at `github.com/davefisher813/bridge-app`
on `main`, production is the Vercel project `commit-app`, and Vercel
Authentication is off. dave@bffsa.org signs in with a password set
directly in the database, because the sign-in screen was email and
password while every document said magic link.

**Reason.** The GitHub integration available to the session could push
to `bridge-app` and could not create a repository, so the existing empty
repo was used with the real history force-pushed over its one README
commit. Renaming a repo later is one field with redirects, and Vercel
tracks the repo by id, so the name did not need deciding to ship.

**Consequences.** An audit of the whole app against the live project
followed and produced the four changes below in one sitting. The
handoff document written for a session on Dave's machine was deleted;
docs/SETUP_CHECKLIST.md now carries the three dashboard settings only
Dave can set.

## 2026-09-19: every foreign key is indexed, and auth is evaluated once

**Decision.** Migration 0016 indexes the nineteen foreign keys Supabase's
performance advisor listed as uncovered, most of them `org_id`, and
rewrites the seven policies that called `auth.uid()` or `auth.role()`
bare to call them in a subselect. A schema law now fails if any column
declared with `references` is not the leading column of an index.

**Reason.** Every page filters by `org_id` and every RLS policy checks
it; with no index that is a sequential scan per query and another per
policy evaluation. Bare `auth.uid()` in a policy is re-evaluated per
row. Neither shows on two orgs and zero athletes, which is exactly why
it needed a law rather than a memory.

## 2026-09-19: documents go through Storage, never through the action body

**Decision.** The browser uploads each file to a private `documents`
bucket under `<org id>/<request id>/<n>-<name>` and hands the server
action a `StoredRecord` (an `IngestedRecord` with the bytes replaced by
the path). The action reads the bytes back with the caller's own client
and runs the same acceptance checks on what arrived. The row records
`storage_paths`. A law forbids any exported action from accepting an
`IngestedRecord` or a `base64` field.

**Reason.** Next caps a server action's request body at 1MB. The app's
own document limit is 4MB, and base64 adds a third. Every real scanned
transcript would have failed on the way in, and the harness could not
see it because the fake client never crosses HTTP. The original file was
also discarded after extraction, which is the one thing a coordinator
wants back the day an extraction is questioned.

**Alternative considered and rejected.** Raising `bodySizeLimit`. It
moves the ceiling rather than removing it, still discards the original,
and still routes megabytes through a serverless function invocation.

**Consequences.** The bucket's policies key off the first path segment
the way every table policy keys off `org_id`, and the RLS suite gained a
storage stub so they are exercised as a non-superuser: staff write inside
their org, members read, nobody else sees anything. The fake client
gained `storage.from().download()` and `.upload()`.

## 2026-09-19: profile rows follow auth.users

**Decision.** A trigger on `auth.users` (insert, and update of email)
creates and maintains the matching `public.users` row, reading a name
from `raw_user_meta_data.full_name`. Existing auth rows were backfilled.

**Reason.** `public.users` was a mirror nothing wrote to. The one row in
it was typed by hand. Any account created by an invitation or the
dashboard would have had no profile row, `org_members`' foreign key
would have refused it, and `getCurrentUser()` would have shown a blank
name.

## 2026-09-19: membership is written by the service role, behind requireOwner

**Decision.** `inviteMember`, `changeMemberRole` and `removeMember` are
owner-only server actions that write `org_members` through the admin
client. An org can never be left without an owner: the only owner
cannot be demoted or removed, including by themselves. Without the
service role key each action returns a message saying so. An existing
account is added directly; a new address gets Supabase's invitation
email. Magic link is the default way in for everyone invited;
`sendMagicLink` runs with account creation off so the form never
creates a user and never confirms which addresses exist. `/auth/callback`
accepts both a `token_hash` and a PKCE `code`, and only ever lands on a
path of this site.

**Reason.** `org_members` deliberately has no write policy (2026-09-17):
a row there grants everything and carries its own role. The gate is the
owner check in the action and the hand is the service role, which is the
shape that entry already prescribed. Token hash over PKCE because a link
tapped in Mail on an iPhone opens Safari, not the installed app that
asked for it, and PKCE needs them to be the same browser.

**Consequences.** The screens (members list, invite, the magic link
sign-in form) are drawn in a preview and wait on Dave, per the
visual-preview rule. The password stays as a fallback for the one
account that has one. Three Supabase dashboard settings are owed by
Dave and listed in docs/SETUP_CHECKLIST.md.

## 2026-09-19: the screens around the pages, and icons from the tokens

**Decision.** `error.tsx`, `not-found.tsx` and `loading.tsx` exist at the
root and inside the org chrome. The root layout exports viewport and
Apple web app metadata; `manifest.ts`, `icon.tsx` and `apple-icon.tsx`
are generated at build. The few server files that need a literal colour
read it out of `globals.css` through `src/lib/theme/cssTokens.ts` rather
than repeating the hex.

**Reason.** A thrown error was Next's white default and a slow query a
blank screen, which on a phone reads as the app having died. Add to Home
Screen with no manifest or icon installs a generic Safari tile. The
no-raw-hex law exists so a colour has one source; reading the stylesheet
keeps it that way for the two places CSS variables cannot reach.

## 2026-09-19: previews carry options, not one direction

**Decision.** Every screen preview from now on is a small catalog:
where a real choice exists (a layout, a control, a wording), the artifact
shows two or three rendered options and Dave selects inside the page.
Written into CLAUDE.md under the preview rule.

**Reason.** The members preview showed one direction with a list of
"decisions baked in". Dave approved it and corrected the format in the
same breath: "Always send previews I can select w options." The catalog
rule already said this for the styling contract; it now applies to every
preview.

**Consequences.** The members screens, invite, one-person view and the
magic link sign-in were built as approved. Two things the preview could
not show were decided in code and are worth knowing: "invited" means the
person has never signed in, read off a mirror of `auth.users.last_sign_in_at`
kept by the profile trigger (migration 0018); and members of an org can
now read each other's profile rows, which the list needs and which
`users_self` alone forbade.

## 2026-09-19: the clean slate

**Decision.** Every screen is rebuilt on a strict kit
(`src/components/kit/`) with the scale Dave selected in the audit
artifact: four text sizes (13/16/20/28), one spacing step (12/16/24),
one radius (12px), paper surfaces with no border, filled 16px inputs, a
fixed tab bar, and a theme that follows the phone. Sign-in leads with
email and password on one screen; the magic link sits behind a link.
`tailwind.config.ts` replaces the theme rather than extending it, so a
class outside the scale does not exist. Five laws in
`src/laws/kitLaws.test.ts` keep a page from styling anything itself.
The engine, the schema, the actions and the tests are untouched. The
catalog of 2026-09-15 and `src/components/catalog.tsx` are gone.

**Reason.** Dave, after a day on the deployed app: "The app is extremely
buggy. Screens slide all over the place, typing is glitchy, cursors are
no good, visuals are not uniform, borders and spacing clearly have not
been established... I want to work from a super clean slate this time."
The audit found the causes rather than the symptoms: 15px inputs make
Safari zoom on focus and not always zoom back (the "glitchy typing"), a
sticky tab bar rides Safari's own bar (the "sliding"), and fourteen text
sizes, seven radii and seventeen paddings across 53 screens with no
shared field or row component (the "not uniform"). A styling contract
that pages were trusted to follow had not held; a kit that pages cannot
step outside of is the version that does.

**Alternatives.** Fix the three iOS bugs and leave the screens. That
would have cleared the symptoms he named and left the cause, and he
asked for the slate. Add a kit alongside the catalog and migrate
screen by screen. That leaves two vocabularies in the app for months,
which is the drift this exists to end.

**Consequences.** Two kit choices were forced by the audit rather than
picked: text links, quiet and destructive buttons and field errors use
the AA-safe `text-tint-*-on` tokens because the raw accent is 3.23:1 on
the light page, and the avatar is one flat indigo because white on the
old blue-to-indigo gradient was 3.65:1 at its blue corner. The stat
tile has no sub-line and a row has two lines, so a few captions moved
into the meta line or a note beside it. Dave does his page-by-page
audit against the deployed result, not against the artifact.

## 2026-09-19: the preview is the app, rendered

**Decision.** `scripts/build_previews.sh` no longer runs six hand-written
Python generators and a 2,700 line prototype. The preview is every page
in `src/testing/pages.ts`, the list the render law executes, rendered
by the page code on the fixture with the app's compiled stylesheet into
one tappable file (`scripts/preview/build_app_preview.ts`).
`scripts/audit_preview.mjs` inspects what a browser computed on every
screen in both themes. The test bench stays: it runs the shipped engine
modules, which no render can.

**Reason.** The generators were a second implementation of every screen.
They drifted from the app three times in one sitting even after they
were taught to parse the colour maps, because the markup itself was
still a copy, and rebuilding 8,000 lines of copies onto the new kit
would have produced a fourth drift by the first edit. A preview that IS
the app cannot disagree with it.

**Consequences.** The preview shows fixture data and does not post
forms. What the prototype could do that this cannot, change an input
and watch a number move, the bench does with the real modules. A screen
that only renders in a state the fixture does not carry needs a fixture
row, which is the same thing the render law already requires.

## 2026-09-20: a save lands on the record, and the app runs beside its database

**Decision.** Creating an athlete, target, donor, campaign or board opens
the record that was just made; editing one returns to it; recording a
gift or a pledge lands on that list. Every insert selects its new id
back for this. Vercel functions run in `pdx1`, the region Supabase's
`us-west-2` database lives in (`vercel.json`). `createClient`,
`getOrgBySlug` and the auth check are wrapped in React `cache()` so the
layout, the page and its loaders share one client and one lookup per
request. `overflow-wrap: anywhere` on the body lets a word wider than
the phone wrap. The audit now checks every link against the routes the
app has, every form for an action and a submit, and every element at
390 and 375 wide for text painting past its box.

**Reason.** Dave, on the deployed app: screens take forever to load,
text bleeds out of the screen, buttons and back links do not land where
they should. The load time was five serial round trips from Virginia to
Oregon before a page read a row of its own: the layout's org lookup,
the page's repeat of it, the auth call, the membership row, then data.
The bleed was an invited person's address as a row title, and a stat
row three tiles wide at 375. A form that sent someone back to a list
made them find what they had just typed.

**Consequences.** The fixture carries an invited member with no name
and a long address so the spill check has something to catch, and the
planted-bug run proved it does. The kit's `Stat` has 12px sides. The
catalog Dave selects from (published the same day) decides the rest of
the flow rules: delete confirmation, the back arrow, module-off rows.

## 2026-09-20: the kit catalog, twenty-five picks

**Decision.** Dave went through the kit catalog artifact (twenty-five
decisions, each rendered two or three ways with the app's stylesheet)
and picked. Eleven change the app: hairline borders on every paper
surface, dark paper lifted to #202024, the first fact of a meta line in
ink, outlined secondary and destructive buttons, a 44px accent disc for
the add action in a header, the next action inside an empty state, no
explanatory sentence under a screen title (a factual line stays),
field examples as hints below instead of placeholders, a confirm sheet
before a delete, stat labels in sentence case, and a 672px column on a
laptop. Fourteen confirm what the app already did. The full table is in
docs/STYLING_CATALOG.md.

**Reason.** "There's still no borders on the pages... it just looks
very elementary." A catalog of rendered options is how this project
decides looks (CLAUDE.md), and the picks were read back from the
artifact's store rather than typed.

**Consequences.** The first round of picks never reached the store
because the page wrote with update() to a document that did not exist;
the page now writes with set() and pushes phone-saved picks up on open.
The pill law exempts the kit's AddButton by its 44px size. Explanatory
ledes were removed from the pages rather than hidden, so the strings
are gone.

## 2026-09-20: the app itself is what gets looked at, not a render of it

**Decision.** `FIXTURE_MODE=1` builds the real Next app with exactly two
modules swapped, `@/lib/supabase/server` and `@/lib/supabase/middleware`,
for the fixture (`src/testing/fixtureServer.ts`, `fixtureMiddleware.ts`)
via `next.config.ts` aliases. `scripts/live/drive.mjs` then opens every
route in `src/testing/pages.ts` in Chromium at 320, 375 and 390 wide,
light and dark, and measures: page scroll width, every element's right
edge, text wider than its box, and any word whose client rects sit on
two lines. The preview embeds Inter as a data URI and its audit now runs
at 320 and checks for broken words too.

**Reason.** Dave, on his phone: "shit is literally off the fucking
screens", after a review that had found nothing. The preview was the
real page code but not the real font: it fell back to the system face,
which is narrower on the machine the audit runs on, so an overflow Inter
causes never showed. And the fixture was short: the real Bridge org name
is 38 characters and Dave's one athlete is a transfer, neither of which
the fixture had.

**Consequences.** The fixture carries the long org name and a transfer
athlete shaped like Dave's, with four page entries for them. The kit
changed where the check bit: a row's trailing slot is capped at half the
row and may wrap (a nowrap "Awaiting decision" had squeezed a title to
one pixel), a stat tile keeps its figure on one line and the row wraps
instead (a 96px basis), a row's meta clamps to two lines instead of one,
and the journey stepper runs to the panel's edges. Vercel never sets
`FIXTURE_MODE`. WebKit cannot be installed here, so iOS-only control
rendering stays unverified.

## 2026-09-20: the org's mark, and the app is Bridge's until it has a name

**Decision.** `orgs.branding.logo` (a path under /public or an https
URL to a white shape on a transparent PNG) is the org's mark. The kit's
`OrgMark` draws it: inverted to ink in the light theme, white in the
dark one, so one file serves both. It sits beside the org name in the
chrome and on the org chooser. The sign-in screen and the app icons
carry Bridge's mark and lockup outright, because the app already calls
itself BFFSA; when the platform has a name of its own, `login/page.tsx`
and `icon.tsx` are the two places that change.

**Reason.** "Put our logo." Dave sent the mark and the lockup as white
on black JPEGs; they were cut to transparent PNGs in a browser canvas
(`public/logos/`). The column already existed since 0001 for exactly
this; migration 0019 is the first row to use it.

**Consequences.** The body pads by the top safe-area inset (the same
change fixed the org name sitting behind the iPhone status bar in the
installed app). Elite Squad has no mark on file and shows its name
alone. The preview inlines the PNGs so the one file still carries them.
Same day, Dave: "use the word mark for the logo and words, get rid of
that default title," then "make it small in the upper right hand
corner across from good morning, put it there on all pages."
`orgs.branding.lockup` is the wordmark; migration 0020 sets Bridge's.
It sits small and out of the flow in the top right corner of every org
screen, so the screen title shares its line rather than sitting under
it, and the org name survives for screen readers only. `Screen` keeps
that corner clear: the title reserves it, and a header action (the add
disc, an Edit link) drops below the mark instead of colliding with it.

## 2026-09-20: no viewport-fit=cover

**Decision.** The viewport drops `viewport-fit=cover`. iOS lays the
installed app out below the status bar and fills that strip with
`themeColor` instead. The body keeps `padding-top:
env(safe-area-inset-top)` as a guard, which now measures zero here.

**Reason.** Dave's screenshot: the screen title and the wordmark sat on
top of the clock and the signal icons in the home-screen app. With
cover, iOS draws the page under the status bar, and with the status bar
style left at `default` it reports a zero safe-area inset, so the
padding that was supposed to clear it measured nothing. The other way
out, `black-translucent`, forces white status bar text, which is
unreadable on the light theme.

**Consequences.** `env(safe-area-inset-bottom)` is zero too, so
`pb-safe` and `pb-bar` now pad by the tab bar's height alone; iOS keeps
the viewport clear of the home indicator itself. Nothing in the layout
changes in a browser.

## 2026-09-20: matching and metrics, forty picks

**Decision.** Dave went through the Matching and Metrics catalog and
answered all forty decisions. docs/MATCHING_CONTRACT.md is the result.
The shape: a dated metrics log with sources that set confidence, staff
grades on the 20 to 80 scale blended into the athletic score by position
group, matches stored per athlete and school and recomputed only when an
input changes, a Program Tier on the school, a family budget and net
cost driving a money-first default preset, an athlete goal that shifts
the blend, positional need per org, offers and visits shown but never
scored, CSV import into a shared school table with a private per-org
overlay.

**Reason.** "I don't see the school matching feature or anywhere to log
metrics. It was the most important function in the app." Neither had
been built; the engine was ported without the screens that feed it or
run it. And the old site's version "drained API usage like crazy, data
never stored, we had to always rerun the matches", which is why storage
and no outside calls are hard rules in the contract.

**Consequences.** Three numbers in the contract are interpretations of
his words rather than picks (the preset weights, the goal shift, the
grade blend) and are marked as such; all of them live in
`src/lib/fit/contract.ts`. Matching lands in phases: data model and
engine first, the metrics log, then matching screens, then the CSV
import, each behind the laws and the preview.

## 2026-09-20: grey only where it means something

**Decision.** After the matching screens shipped Dave said "let's make
sure all the visual rules stay intact and let's keep all grey subject to
need only and minimal." The grey roles (target, neutral, low) are now
reserved for a status: the Target stage, a seat status with no colour,
a low score, an empty state, a section whose point is absence (Not
Counted, Not Carrying a Commitment). Every other section and row takes
the role for what it is. A neutral stat prints in ink.

**Reason.** The new screens had leaned on role="target" for anything
about matching, and on the neutral default for reference and settings
rows, so the Matches section, the Ranked list, the preset and the
positions of need all read grey next to a board where grey means "not
in contact yet".

**Consequences.** A law in `src/laws/kitLaws.test.ts` lists the four
literal grey roles that remain, each with its reason, and fails on any
new one. docs/STYLING_CATALOG.md carries the rule.


## 2026-09-21: the family role is a fourth tier, not a narrower member

**Decision.** A student or parent signs in as `family`, a new value of
`org_role`, and is linked to the athletes they may see through
`athlete_guardians` (one row per person per athlete). The RLS helper
every read policy hangs on, `private._member_org_ids()`, excludes the
family role from here on; athlete-keyed tables get an `or athlete_id in
family athletes` clause instead. A family member writes nothing. A role
is never changed to or from family through the members screen: it is a
remove and a fresh invite, which carries the athlete.

**Reason.** Dave, in the matching catalog: "Of course the students see
this. They need the same access to their own personal data." A member
reads the whole org, so narrowing that role would have meant a
per-table exception list that grows with every new table and fails
open when someone forgets one. Excluding the role from the shared
helper fails closed: a table added tomorrow with the standard
`_read` policy shows a family nothing until somebody decides it should.

**Alternatives.** An `athlete_id` column on `org_members` (one athlete
per login, no siblings, no second parent). A separate `families` table
with its own sign-in (a second auth model to secure). Both rejected.

**Consequences.** Migrations 0022 (the enum value alone, because
Postgres cannot use a new enum value in the transaction that added it)
and 0023. A trigger keeps a guardian row inside one org. The RLS suite
seeds a family member and asserts what they see and cannot see, and
fails when the exclusion is removed. The screens wait on the Family
Access catalog.

## 2026-09-21: what a family sees, twelve picks

**Decision.** From the Family Access catalog, tapped by Dave: the
athlete and each parent get their own login (never a shared household
login); one login can be linked to more than one athlete; the athlete's
page is home, with a picker only when there is more than one; three
tabs, Athlete, Colleges, More; every match shows score, tag, the four
dimensions and every reason; Colleges shows each school's status and
score plus visits, and never staff calls, notes or the coach's contact;
their own documents are listed read only, no upload; a family edits
nothing, not even the goal and budget; More lists the owner and staff
with emails; the role is called Family; staff invite a family from the
athlete's page. His answers to the two questions: nothing on the org
side is ever visible to a family, and the athlete gets access first,
then a parent or legal guardian.

**Reason.** "Of course the students see this. They need the same access
to their own personal data." Read only follows his earlier pick that
metrics are logged by staff only; the same line holds for the rest of
the record. Calls and notes stay with staff because they are written
for staff; visits are shown because the family is usually the one
driving.

**Consequences.** The family screens live under `/org/[slug]/family`
with their own tab bar; the athlete screens both roles share (the
eligibility set, the transcript, the metrics log) are the roster's
pages served under `/family`, building every link from
`athleteHome()`. Migration 0024 opens the two reads the picks needed.
The render law proves the boundary from the app side, the RLS suite
from the database side. Invite Family on the athlete's page is the one
pick not yet built; the invite is under Members with an athlete picker
until it is.

## 2026-09-21: the mark alone in the corner, and the screen starts under it

**Decision.** The top right corner carries the org's mark
(`orgs.branding.logo`) only, never the lockup, and every screen with no
back link starts one working step below it: the title, the add disc,
an Edit link, all on their own line under the mark. A screen with a
back link keeps the back link level with the mark, since it is small,
and the title follows as before.

**Reason.** Dave, from his phone on Today and Athletes: "Just the logo
in the corner no word mark and drop all content under it down. It's
way too cluttered at the top." The lockup beside a 28px title was two
wordmarks fighting on one line.

**Consequences.** `Chrome` renders `logo` and ignores `lockup`; the
lockup stays on the org record and on the sign-in screen. `Screen`
drops the corner reservation (`pr-20`) and the action's drop
(`mt-6`) and adds `mt-12` above the title block when there is no back
link. This replaces the 2026-09-20 "across from good morning"
arrangement.

## 2026-09-21: no pink, the danger hue is the red

**Decision.** The danger axis (destructive buttons, the Conflict tag,
the failed document, form errors) takes the same red as the primary
action. systemPink leaves the palette in use.

**Reason.** Dave, on the More screen: "Get rid of the pink and use the
red we selected." The pink Recalculate and Sign Out beside a red Add
disc read as two brands.

**Consequences.** `scripts/gen_tokens.py` maps danger to red; the
generated pairs in globals.css and the two `--danger` aliases follow;
the status glyph and dot for danger are systemRed. Nothing else names
pink. A destructive button stays outlined, not filled, which is the
remaining difference from Add.

## 2026-09-21: Doc AI reads for real, with a ledger and a cap

**Decision.** The real `ModelCaller` lives at
`src/lib/ai/anthropicCaller.ts`, on the official Anthropic SDK, outside
`src/lib/docai`. Triage runs on Haiku 4.5 and extraction on Opus 5.
Every call's tokens and list-price cost land in `docai_usage`; each org
carries a monthly cap in cents (`orgs.docai_budget_cents`, $20 by
default), set by an owner under More, and an upload is refused before
it starts once the calendar month's ledger reaches the cap. The action
chooses the real caller when `ANTHROPIC_API_KEY` is set and the stub
otherwise.

**Reason.** Bridge's original Doc AI "drained API usage like crazy" and
kept its budget in one browser's localStorage. A server-side ledger per
org is the multi-tenant answer, and a cap that stops the upload before
the model is called is the only cap that actually bounds the bill.
Keeping the SDK out of `src/lib/docai` preserves the walled module: the
pipeline still runs in the test bench and under vitest with a scripted
model.

**Alternatives.** An SDK call inside the pipeline (rejected: breaks the
wall). A daily cap like the original (rejected: a month is what the
bill is). Streaming responses (unneeded: a few thousand tokens of JSON).
The `fallbacks` beta for refusals (left off: a refused transcript should
surface as a failed document for a person to look at, not be retried on
another model unseen).

**Consequences.** Migration 0025. `max_tokens` is floored at 16,000 so
thinking on the current models never truncates the JSON. The caller's
unit tests run on a fake client; the action laws prove the ledger row,
the cap, the month boundary and the zero-means-off rule on the fixture.
Dave owes the key on Vercel; until then reading stays simulated and
labelled.

## 2026-09-21: the review of the day's work, and what it changed

**Decision.** An independent review of everything shipped today (the
family role and its screens, the corner, the red, the real Doc AI
caller) found nine things; six were bugs and were fixed the same hour,
with a law or an RLS assertion for each.

- A family link now dies with the membership (migration 0026: the
  helper joins org_members), and removing a member deletes their links.
  Before, a removed parent's account could still read the athlete
  through the API.
- Staff rows open to a family per org, as (org, person) pairs, never by
  a person's role in some other org.
- A family member can be invited for a second athlete: the link is
  added rather than the email refused. A parent with two kids was the
  case the fixture named and the invite could not produce.
- A ledger write that fails now fails the reading: the document is
  filed as failed with the reason, rather than the spend vanishing and
  the cap never filling.
- Cost is priced on the model that was asked for, with dated snapshot
  ids matched by prefix, so a Sonnet or Haiku call is never charged at
  the Opus rate.
- The month's spend is read with a date filter through the index the
  migration created, not the whole ledger summed in JavaScript.

Also: the budget is whole dollars only, a discarded document reads
"Set aside by staff" to a family, `Chrome` no longer carries a lockup it
does not render, and the two pages that read a document declare a
300-second function limit so a real model call is not cut off by the
platform default.

**Reason.** Dave: "fully proof your work." A same-day review by a
reader who did not write the code is the cheapest proof there is.

**Consequences.** Migration 0026 applied to the live project. The RLS
suite is at 125 assertions.

## 2026-09-21: every document type applies, and an award letter is the financial truth

**Decision.** Test scores, offer letters, award letters and
recommendation letters apply to the record, not only transcripts. An
award letter's net cost replaces the financial estimate for that
athlete at that school; a loan never reduces net cost. A letter naming
a school not on file applies nothing rather than guessing a school. A
FAFSA or EFC report is kept on file and changes nothing.

**Reason.** Four of the five document types extracted and stopped: the
reading was done and nothing on the record moved, which is the half of
Doc AI that Dave would actually notice. Money is "arguably the biggest
driving factor" (Dave, matching catalog), and a school's own award
letter is the best number there is for it.

**Alternatives.** Storing the award on the athlete (rejected: it is
about one school). Matching schools loosely by first word (rejected:
"State" would land on the wrong campus). Applying offers without a
matching school row by creating one (rejected: schools are shared
reference data, entered on purpose).

**Consequences.** `src/lib/data/applyExtraction.ts`, migration 0027,
`KnownAid` on `scoreFit`, the contract's financial section extended,
the bench checks it, and `applied_changes` carries the target, the
detail fields and the contact so discard can put each back.

## 2026-09-21: the athlete form follows the sport

**Decision.** Sport is a picker of the sports the engine knows
(Baseball, Softball, Basketball, Soccer, Football, Volleyball,
Lacrosse; a record with any other word keeps it as its own option).
The IQ grade is named for the sport (Soccer IQ, Basketball IQ) and
"Game IQ" for a sport the engine does not know. The position hint lists
that sport's positions. One `normalizeSport()` in the contract serves
the form, the metrics list and the athletic score.

**Reason.** Dave, from the Add Athlete screen: "I selected soccer and
it has baseball stuff." The label was a constant and the sport was a
free text field with a baseball example.

**Consequences.** `SPORTS`, `sportSpec()`, `gradeLabel()` and
`normalizeSport()` in `src/lib/fit/contract.ts`; the metrics and
position group lookups normalize through it, so "Boys Soccer" and
"Soccer" score the same. A law covers the label, the spellings and
that a soccer athlete is never asked for a fastball.

## 2026-09-21: metrics while the profile is built, and metrics reports read by Doc AI

**Decision.** The Add Athlete form carries a First Metrics section:
the sport's metrics (the position's first), one measured-on date, one
source, each number saved as a dated entry in the log at the same time
as the athlete. Doc AI gains a sixth document type, Metrics Report: a
showcase profile, an event results sheet or a dashboard screenshot is
read into the same log with the date and the source the report names.
Both write exactly the rows the Metrics screen logs by hand.

**Reason.** Dave: "when building the athlete's profile, I should be
able to log metrics. As of now I can only add them after the profile
is built. Make sure doc AI is wired to add metrics properly and
seamlessly when someone uploads them." The log was the right store
(catalog pick, 2026-09-20); it just had one door.

**Alternatives.** A metrics column on the athlete (rejected: the log is
what makes "best verified, else most recent" possible). Reading video
(still not built; the film type now points at the metrics report).

**Consequences.** `parseFirstMetrics()` in the athlete validation, the
create action logs then rescores; `metricsReportSchema`, a prompt that
lists the engine's own keys and units, a stub case, and
`applyMetricsReport()` with the ids recorded for discard. A metric key
the engine does not know is refused at extraction and dropped on apply.

## 2026-09-21: Doc AI hardened against errors and misreads

**Decision.** The document pipeline is strict about meaning and
lenient about shape, checks what a schema cannot after validation,
shows every doubt on the document, and makes every state change
happen once. Specifically: a lenient value layer under every schema
field; a plausibility pass (metric ranges, test ranges, dates) that
drops the unusable and holds the doubtful; a What It Flagged section
on the document screen; the name on the page outranking a pinned
athlete; one triage on the detect path and a stop on a failed model
call; claims on apply and discard; a crash guard around the reading;
transcript applies rescoring matches; the stub returning every
category's real shape.

**Reason.** Dave: "deep deep dive into the logic and functionality of
the doc ai. Make it bulletproof from errors and bugs and misreads."
The audit found that four of six stub payloads failed their own
schemas, a quoted number or a slashed date lost a whole transcript,
the detect path paid for triage twice, a triage call failure was
swallowed and followed by a paid extraction, warnings were stored and
never shown, a pinned upload auto-applied another student's transcript
onto the pinned athlete, two taps on Apply logged every metric twice,
a throw mid-reading left a row at processing forever, and a
transcript's GPA change never rescored the matches.

**Alternatives.** Coercing every string to a number (rejected: a
course grade of "85" must stay a string). Refusing the whole document
on one implausible metric (rejected: the rest of the sheet is fine and
the human sees what was dropped). Correcting a slipped decimal point
automatically (rejected: the fix is a human reading the page, not the
engine guessing which digit moved).

**Consequences.** `src/lib/docai/lenient.ts`, `plausibility.ts`, a
walked-brace `parseModelJson`, `EXTRACTION_RULES` on every prompt,
`temperature: 0` on the real caller, and the fake Supabase client now
updates rows in place so a conditional claim can be tested. 52 new
tests across the lenient layer, the pipeline guards, the stub and the
document actions.

## 2026-09-21: Doc AI, the second pass

**Decision.** Walk every scenario from the phone to the row and close
each gap: camera photos (HEIC not listed so iOS converts, photos scaled
to 2000px, a 10MB cap on both sides), the same file twice (a content
hash on the document, refused unless the first copy was discarded),
what the API's errors mean (translated to what to do, with a per-call
timeout inside the function's limit), a reading killed mid-way (shown
as stuck after ten minutes, discardable), a college or middle school
transcript (kept by its level), a metric from the wrong sport (left
out and named), a wrapped model answer, per-year award amounts, one
best value per metric, and instructions printed on a page treated as
content.

**Reason.** Dave: "think through every scenario and bulletproof it as
best as you can." Two of these would have hit him on day one: every
camera photo from an iPhone was refused because the uploader asked for
HEIC, and a four page scanner PDF did not fit the old cap.

**Alternatives.** Decoding HEIC on the server (rejected: iOS converts
for free when not asked for HEIC, and no decoder is wired). Reading
the whole multi-student sheet (deferred: it is a real Elite Squad
scenario, but a feature, not a hardening).

**Consequences.** Migration 0029, `MAX_IMAGE_EDGE`, `explainApiError`,
`documentState.ts`, a `level` on the transcript schema, and 14 more
tests. The ingest browser test still passes 18/18 in real Chromium.

## 2026-09-21: an Academics First preset

**Decision.** A fourth scoring preset, Academics First, weighted 50 /
30 / 20 (academic / athletic / financial), the mirror of Baseball
First. Migration 0030 widens the check constraint. Money First stays
the default.

**Reason.** Dave, looking at the preset picker on More: "This should
have academics first as well." The matching contract is locked to his
picks, and this is one of his picks, added to the table there.

**Consequences.** `PRESETS` in `src/lib/fit/contract.ts`, the table in
docs/MATCHING_CONTRACT.md, and a law that each named preset leads with
what it is named for and that the presets the app offers are the ones
the database accepts.

## 2026-09-21: the third preset is labelled Sport First

**Decision.** The preset stored as `baseball_first` is labelled Sport
First everywhere a person sees it. The key does not change.

**Reason.** Bridge is baseball; the platform is not. A soccer org's
More screen offering "Baseball First" is wrong on its face. Dave's pick
from three (Sport First, follow the org's sport, keep it).

**Alternatives.** Following the org's sport (rejected for now: an org
does not carry one sport, its athletes do). Renaming the key
(rejected: a data migration for a label).

## 2026-09-21: what a board member sees, ten picks

**Decision.** From the Board Access catalog, tapped by Dave: home is
the program first, then their seat; the tabs are Home, Program, Giving
and More, and an org without the fundraising module drops Giving;
athletes appear as names with a stage (Committed, Offers, Targeting)
and never a grade, a score or a record to open; each athlete's schools
appear with their stage and never the calls, notes, visits or the
coach's contact; fundraising is the year against budget and the
campaigns, never a donor's name; their own seat shows the whole
give/get account with every gift credited to it; the rest of the board
appears as a total without names; a member changes nothing; More lists
who to ask and the way out. His answers: nothing is missing from what
they must never see, and all four board members and their friends and
family try it first.

**Reason.** "Did you set this up for student and board access /
versions?" The honest answer was that a Board login saw everything
staff saw, and Dave picked a version built for them. The privacy
picks (no grades, no donor names, no notes) are the ones that decided
the database side: a member's own token could read every row, so the
screens alone would not have kept the promise.

**Alternatives.** Keeping the read-only staff view and verifying it
(offered, not picked). Reading only summaries in the app while leaving
the rows readable (rejected: the anon key ships to the browser).
Computing give/get in SQL (rejected: two implementations of one number;
the function ships the rows with names stripped and the app's own
arithmetic runs on them).

**Consequences.** Migration 0031 (applied live): `_member_org_ids()`
is owner and staff only, `_observer_org_ids()` and
`_observer_staff_rows()` for members, and three SECURITY DEFINER
functions. Five screens under `/member`, `requireMember()`, a member
tab bar, `src/lib/data/member.ts`, `SeatCard`, a fake `rpc()` mirrored
in `fakeRpc.ts`, the fixture chair's seat linked to the member login,
five page entries and a render law for the boundary. The recruiting
board is labelled Targets everywhere a person sees it (Dave: "board
isn't a great name. Most won't get what that means"); the route stays
/board.

## 2026-09-22: staff may invite a family, and only a family

**Decision.** `inviteMember` is behind `requireRole(STAFF_ROLES)`
rather than `requireOwner()`, and refuses any role but `family` unless
the caller is an owner. Invite Family lives on the athlete's page with
the athlete pinned, asks the relationship (parent, guardian, the
athlete themselves, other), and returns to the athlete rather than to
Members.

**Reason.** Dave picked the athlete's page as the place to invite a
family from, and a coordinator adding a parent is the everyday case;
routing it through an owner makes the owner a bottleneck on the one
invite that happens most. Who somebody is to the athlete is worth
recording at the moment it is known.

**Alternatives.** Keeping the owner gate and putting a link on the
athlete's page that lands on the Members form (rejected: the athlete
would have to be picked again, and the owner is still the bottleneck).
A separate action for family invites (rejected: two implementations of
one flow; the role check is one line).

**Consequences.** `relationship` on `athlete_guardians` is written
where it was always null. `returnTo` is read from the form and refused
unless it starts with this org's path, so the redirect cannot be
pointed off the app. Three action laws: staff may invite a family and
the relationship lands, staff may not invite staff, a foreign return
path is ignored.

## 2026-09-22: a board seat points at one sign-in, linked by staff

**Decision.** A seat's page links or unlinks a sign-in.
`board_members.user_id` may only name an owner, staff or member of the
same org (never a family login), and one sign-in holds at most one seat
in an org.

**Reason.** Migration 0031 gave a member their own Giving screen, and
`member_giving()` decides whose seat is whose by
`board_members.user_id = auth.uid()`. Nothing in the app ever set that
column, so the feature shipped with no way to turn it on. A second seat
for the same person would show them one and hide the other.

**Alternatives.** Matching a seat to a login by email (rejected: a
board member's org email and their sign-in address are often different,
and a silent match on a typo is a privacy failure). A unique constraint
in the database (worth doing later; the check is in the action today
because the column is nullable and shared with seats that have no
login).

**Consequences.** `linkSeatSignIn` in `src/lib/actions/governance.ts`,
a Sign-In section on the seat page, `userId` carried through
`BoardMember`, and six action laws covering every branch.

## 2026-09-22: transfer windows are entered, not seeded

**Decision.** An owner enters NCAA transfer-portal windows under More,
Reference. The source URL is required. No window dates ship in the
repo or in a migration.

**Reason.** The rule in CLAUDE.md is that window dates are data, never
code, because the NCAA changes them by vote most years. The same logic
forbids seeding them from memory: a date nobody can trace is worse than
no date, because `src/lib/fit/transfer.ts` reports timing as unverified
when no window matches and that is an honest answer. Requiring the
source makes every row checkable later.

**Alternatives.** Seeding the current windows (rejected: they would
have to come from recall rather than from an NCAA-published page).
Scraping the NCAA site (rejected: a scraper is a second thing to
maintain for a handful of rows a year).

**Consequences.** `transfer_windows` gets its first writer, through
the service role behind `requireOwner()`, like schools. A duplicate of
the same sport, division, season and label is refused in the action,
since the table is shared reference data with no org to scope a
constraint to.

## 2026-09-22: search appears when a list outgrows the screen

**Decision.** A search field renders on the roster and on Schools once
the list passes five rows, filters in the URL, and filtering happens
in memory over the rows already loaded rather than in the query.

**Reason.** A field above a four-row list is clutter; a hundred-row
list without one is unusable. Filtering in memory keeps the list, the
count and the empty state reading from one array, which is where they
disagreed in every version that filtered in the query.

**Alternatives.** Always showing the field (rejected: clutter on a new
org's screens). Filtering with `.ilike()` in the query (kept in
reserve: the fake client now understands it, so the switch is testable
the day a roster is big enough to need it).

**Consequences.** `SearchField`, a `q` search param on both screens,
and their own empty states. `.ilike()` and `.or()` implemented in the
fake Supabase client with PostgREST's meaning, with laws for the
pattern anchoring and for an `.or()` narrowing alongside other filters.

## 2026-09-22: region is derived from the state, never stored

**Decision.** `src/lib/fit/regions.ts` maps a state to one of seven
regions and the matches screen filters on it alongside the state
filter.

**Reason.** "The Northeast" and "the Carolinas" are how a family talks
about distance; the state list is fifty long on a phone. A derived
region cannot drift from the school's state, which a stored column
would the first time a school moved conference and somebody edited one
field.

**Alternatives.** A region column on `schools` (rejected: two sources
of truth). Census regions unchanged (rejected: four buckets put
Connecticut and Maryland together and split nothing usefully).

**Consequences.** Plain data in the walled-off engine directory, a
Region select before State, and the region options built from the
schools actually in the list.

## 2026-09-22: a search box stays while its term does

**Decision.** Every long list's search field renders when the list
passes five rows OR when a term is in the address, and the term is kept
alongside any filter already in the URL rather than replacing it.

**Reason.** A term that narrows a list to one row, or to none, used to
take the field off the screen with it, because the threshold read the
filtered list. The only way back was the browser's address bar, which
on a phone is the way nobody takes. The same applies to the gift
ledger, where a category filter and a search have to coexist.

**Alternatives.** Always rendering the field (rejected: clutter on a
new org's four-row screens). Clearing the filter when a search starts
(rejected: silently throwing away what somebody chose).

**Consequences.** `SearchField` reads `useSearchParams()` and rewrites
only `q`. Six screens carry it. Seven page entries render the searched
state, including a term nothing matches, and a law asserts the field
survives on each of them.

## 2026-09-22: a row wraps its trailing rather than squeeze its title

**Decision.** The kit's Row and Option lay their children out with
`flex-wrap`, the body asks for a 96px basis and does not shrink below
it, and the trailing is pushed right with `ml-auto`. The section
heading is left alone.

**Reason.** Below about 300px of layout width, which is Safari at 150%
page zoom on the phone Dave uses, the trailing kept its width and the
title's box shrank until ordinary words broke in half. The live driver
counted 72 broken words at 260 and 300 across both themes; it counts 14
now, and none at 320 and above.

**Alternatives.** `overflow-wrap: break-word` in place of `anywhere`
(tried and measured: no change, because every text box in the kit
already carries `min-w-0`, which zeroes its minimum width whatever the
wrapping rule says). Making the section label hold its width the same
way (tried and measured: it pushed the widest heading past the right
edge at 260, so it was reverted; a page that scrolls sideways is worse
than a heading that wraps). A container query (no container query
plugin in the config, and the wrap needs no breakpoint).

**Consequences.** A row whose trailing is wider than about a third of
the row stacks at any width, which is the same intent as the existing
`max-w-half` cap. A kit law pins all three classes on both components,
planted and watched to fail before it counted.

## 2026-09-22: the member summary functions are for signed-in callers only

**Decision.** `member_program`, `member_program_schools` and
`member_giving` are granted to `authenticated` and revoked from both
`public` and `anon` (migration 0033). The private helpers keep their
public grant.

**Reason.** Migration 0031 granted them `to public` because the local
test harness has no `authenticated` role, and PostgREST exposes
everything in the public schema, so `/rest/v1/rpc/member_program` was
reachable without signing in. Nothing leaked: each function checks
membership through `auth.uid()`, which is null for an anonymous caller,
and a probe as `anon` on the live database returned zero rows. But the
call should not be reachable, and Supabase's own linter said so.

Two revokes were needed, not one: `from public` drops the grant 0031
wrote, and `from anon` drops the one Supabase's default privileges
write for every new function in the schema. The first migration only
did the former, and the probe still came back true, which is why the
live database carries a follow-up named `member_rpc_revoke_anon`.

**Alternatives.** Moving the functions into the private schema
(rejected: PostgREST cannot call them there, and calling them is the
whole point). `SECURITY INVOKER` (rejected: the functions exist
precisely to read rows the caller's own policies hide).

**Consequences.** The local harness creates the two Supabase roles when
they are missing and gives `app_user` the `authenticated` role, so the
suite exercises the same grants production has. An assertion in
`scripts/rls_test.sql` fails if an anonymous caller can execute any of
the three, or if a signed-in caller cannot. The remaining linter
warning, that a signed-in person can call them, is the design.

## 2026-09-25: a record opens, a sentence does not

**Decision.** Every kit row, card and stat tile that stands for a
record links to that record's screen. A tile counts something and opens
the list it counts. An empty state carries the button that fills it. A
sentence on paper (a caveat, a reason, an explanation) stays still, and
says so in code: `Card` takes `isStatic`, and the kit tags the other
three with `data-kit` so a browser can tell them apart.

**Reason.** Dave, from his phone: "I can't click on anything pretty
much ... virtually anything should be clickable." Driving the app found
234 rows, cards and tiles that went nowhere. It also found the athlete
screen throwing outright, and a link inside a link.

**Alternatives.** Linking literally everything (rejected: a caveat that
navigates is a trap, and a tile that opens the screen it is already on
is noise). A hand-written list of what may stay static (rejected for
the general case: 50 entries nobody would maintain; a per-screen count
in `qa/clickable-baseline.json` that may only go down does the same job
and needs no upkeep).

**Consequences.** `Stat` takes an href. Targets filters by `?status=`
and `?athlete=`, so a tile and a stage line have somewhere to land.
Three browser checks run from `scripts/live/check.sh`: the edge driver,
the clickability baseline, and a link follower that opens every link as
the login that saw it. The driver also fails on a tap target inside
another, which is what the Edit link inside a row had become.

## 2026-09-25: a line earns its place by changing what somebody does

**Decision.** Screen copy carries warnings, refusals, rules and
caveats. It does not carry explanations of how the app works, or
restatements of what the screen already shows. An empty state with a
button does not describe the button. A field hint gives the format, not
the reasoning.

**Reason.** Dave, from his phone: "eliminate as much instructional
subtext as possible. Leave only what we will actually need." Explaining
the mechanics on every screen reads as an app that does not trust
itself, and on a phone it pushes the thing somebody came for below the
fold.

**Alternatives.** Keeping the explanations behind a tap (rejected: a
screen nobody opens is not documentation, it is dead weight; what is
genuinely load bearing belongs on the screen, and the rest belongs in
docs/). Cutting everything including the caveats (rejected: the NCAA
projection warning and the D3 scholarship rule are the app's own
promises about what it does not know).

**Consequences.** Eight paragraphs, four notes, thirty-seven empty
state bodies and twenty-five hints cut or shortened. The copy law still
holds every remaining title to Title Case, and the preview audit still
proves no screen renders empty.

## 2026-09-26: Enrolled is the status after Committed, and it closes recruiting out

**Decision.** A new `athletes.status` value, Enrolled. Reaching it (from
the dedicated Mark Enrolled screen, or from the plain Edit form's status
dropdown) runs one shared function, `applyEnrollment`
(`src/lib/data/enrollment.ts`): every other open target on the athlete
(not Committed, not already Not Interested) closes to Not Interested
with an appended note saying why and when; the Committed target is left
alone; `first_full_time_enrollment` backfills from the enrollment date
only if it was null. Once Enrolled, the athlete's stage stepper and
Matches section (staff and family screens both) give way to a single
Enrolled row and disappear, respectively; the Colleges section keeps
showing every target's real status as history.

**Reason.** Dave, after trying to update an athlete's status and
watching nothing else change: "their status should change and
everything should shift based on that status... the schools that
they're interested in, all that should no longer be relevant, it should
be cleared out. Right now, everything is stagnant. So if I update
anybody, nothing really changes." `athletes.status` already had a
"Committed" value with nothing reading it beyond a roster pill, which
is the exact bug: a status column that looked meaningful and did
nothing.

He also ruled out one shape before I ever proposed it: "it can't just
be like high school recruiting to transfer recruiting, it needs to make
sense." `recruit_type` describes what kind of recruit an athlete is
being evaluated as (`hs`, `transfer_4to4`, `transfer_juco`,
`transfer_grad`); flipping it after enrolling would misrepresent the
athlete's own history and would re-trigger transfer-specific reasoning
that does not apply to someone who was never a transfer. Enrolled is a
new, orthogonal, athlete-level lifecycle fact instead.

**Alternatives.** Reusing `recruiting_targets.status = "Not Interested"`
as the athlete-level signal (rejected: it already means something else,
a school-specific coaching decision, and conflating it would make the
Colleges history dishonest - which is why the auto-close writes a note
rather than a bare status flip, so a staff member reading it later
knows why). A new terminal `recruiting_targets` status distinct from
"Not Interested" (considered; rejected for now: "Not Interested" is
already excluded from the journey stage calculation, Today's Needs
Follow-Up, and the board's forward-progress ordering, so reusing it
needed zero changes to any of those, and the note makes the reason
explicit without adding an enum value everywhere else has to learn
about). Enforcing enrollment only through the dedicated screen
(rejected: the plain Edit dropdown would still silently no-op, which is
the exact bug being fixed - so both paths run the same close-out, with
the dedicated screen additionally requiring a Committed target first
and letting the date be picked).

**Consequences.** `ATHLETE_STATUSES` gains "Enrolled" (no migration:
both status columns are app-validated free text, not a Postgres enum).
New screen `/roster/[id]/enroll`, new action `markEnrolled`, `updateAthlete`
reads the prior status before writing so the cascade runs once, on the
transition, never on an ordinary later save. Not touched: the recruiting
board's own Committed grouping; the member/board role's Program screen,
which still reads only the Committed target (docs/ROADMAP.md); Today's
Strong Matches, which does not exclude an Enrolled athlete's stored fits
(a narrow, self-healing gap, docs/ROADMAP.md). Two new fixture athletes
(Committed, Enrolled) and a law that plants a violation (Matches shown
after enrollment) and watches it fail before counting.

## 2026-09-26: stop publishing preview artifacts; the build stays a verification gate

**Decision.** No more `Artifact` publish of `app_preview.html` or
`test_bench.html` after a feature, and no preview link in the report
back to Dave. `scripts/build_previews.sh` still runs before calling
anything done - it is the audit, not only the render, and it catches
what unit tests cannot.

**Reason.** Dave: "I don't need previews. Ship it." Supersedes the
2026-09 "a preview for everything, automatic" rule in CLAUDE.md.

**Consequences.** CLAUDE.md's preview section rewritten. The pre-build
design catalog rule (a new, undesigned screen gets a tappable catalog of
options before code is written) is untouched - a different purpose,
not what this message was about.

## 2026-09-26: Mark Enrolled no longer requires a Committed target

**Decision.** Loosened the just-shipped Mark Enrolled flow: it reads
which school from a Committed `recruiting_targets` row when one exists,
but no longer refuses to run without one. Every other open target still
closes to Not Interested with the same automatic note; `schoolName` is
simply null, so the notice reads "Enrolled." instead of "Enrolled at
{school}."

**Reason.** Dave: "I can't mark enrolled for guys already in college
which I understand but it's showing a bunch of schools for them... Why
are the other guys in college not following the same logic?" An athlete
already in college - a transfer, or a historical roster entry - often
has no clean Committed row in this system, and the original hard
requirement meant their open targets never closed, unlike an athlete who
went through the normal HS-committed-then-enrolled path.

**Alternatives considered.** A free-text or school-picker field to name
a destination when there is no Committed target (rejected: introduces an
untyped destination name outside the existing `schools`/
`recruiting_targets` relational model for no real product gain - the
close-out cascade, which is the actual complaint, does not need a school
name to run). Removing the Committed-target read entirely (rejected: it
is still the right, zero-typing source of truth when it exists).

**Consequences.** `markEnrolled` (`src/lib/actions/enrollment.ts`) and
the enroll screen (`src/app/org/[slug]/roster/[id]/enroll/page.tsx`) no
longer branch on `!committed`. The athlete profile's Mark Enrolled
button shows for any staff-editable, non-enrolled athlete, not only one
with a Committed target. `src/lib/data/enrollment.ts` needed no change -
it already handled a null `schoolName` correctly.

## 2026-09-26: Committed and Enrolled are one fact with a school, everywhere

**Decision.** A shared rule, `placementOf()` in `src/lib/placement.ts`,
decides whether an athlete is Committed or Enrolled and where, and every
screen that shows it reads that rule. The school is the Committed
target, else (Enrolled only) the Current School on the athlete's record.
Board commits sync `athletes.status` (Active and Committed only).
Enrolling always has a school: the enroll screen asks when nothing on
file names one, and a picked school is recorded as the Committed target.
Matches hide once an athlete is Committed, not only once Enrolled. The
athlete page's "Colleges" section is renamed "Targets".

**Reason.** Dave: "when they commit, it doesn't say the school they're
committed to anywhere. And when they're enrolled, it doesn't say it
anywhere either... I think you just added one thing and didn't think of
the chain reaction." Each screen read a different source
(athletes.status, a Committed target, nothing), the Current School he
typed was read by none of them, and a board commit never reached the
athlete. "Colleges" was the Targets board under a second name, next to
Matches, and read as a third list.

**Alternatives considered.** A new athlete column for the enrolled
school (rejected: needs a migration, and would be a second place a school
can be named that the board does not see; the Committed target plus the
existing Current School cover every case). Syncing athletes.status on
every board save rather than on transitions (rejected: would overwrite a
status staff set by hand whenever any target was touched).

**Consequences.** Superseded: the same-day "Mark Enrolled no longer
requires a Committed target" entry's no-school path; enrolling without a
school is now refused rather than allowed. The member program screen's
SQL summary (`member_program()`) follows the same rule from migration
0034, since a member reads no athlete rows and so cannot call
`placementOf()` itself.

## 2026-09-26: Graduated and Drafted end recruiting the way Enrolled does

**Decision.** Two more athlete statuses. Graduated means graduated from
college, only follows Enrolled, and is named by the same school.
Drafted records the team (required), round and year, and can follow any
status. Both close open targets through the shared close-out, hide
Matches, and read through `placementOf()` everywhere, including
`member_program()` (migration 0035). The Edit dropdown cannot set
Drafted, since the team has no field there.

**Reason.** Dave: "I should be able to say graduated or drafted." His
picks from the options offered: Drafted records team, round and year;
Graduated means college.

**Alternatives considered.** A single "Outcome" screen with a type
picker (rejected: one more tap, and the three need different fields).
Storing the draft in `athletes.detail` (rejected: that jsonb is
per-recruit-type and Zod-shaped by recruit type; a draft can happen to
any type, and the member summary reads it in SQL). Closing the Committed
target on Drafted (rejected: the commitment is history, the same as
after Enrolled).

**Consequences.** New columns `draft_team`, `draft_round`,
`draft_year`, `graduated_on` (nullable, meaningful only under the
matching status). `member_program()` gained `draft_round` and
`draft_year` columns, so it was dropped and recreated with 0033's
grants; the RLS suite checks the grants survive.

## 2026-09-26: the app icon and manifest are public

**Decision.** `/icon`, `/apple-icon` and `/manifest.webmanifest` load
without signing in.

**Reason.** Dave's Home Screen showed a letter "R" instead of the logo,
even after re-adding it. iOS fetches the icon without the session; the
sign-in redirect handed it the login page. The first diagnosis (a stale
iOS cache) was wrong because it was checked against the fixture build,
which skips sign-in.

**Consequences.** Nothing else opens up; a law in
`src/laws/publicPaths.test.ts` holds both sides.
