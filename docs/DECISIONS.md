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
