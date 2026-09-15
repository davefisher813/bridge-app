# Current state

Last updated: 2026-09-15 (Doc AI upload, review queue and apply built
on a stub model caller).
Replaced wholesale when this changes meaningfully, not appended to.

## What exists

- **Scaffold**: Next.js 16 / React 19 / TypeScript / Tailwind /
  Supabase, dependency versions matching tucci-admin.
- **Auth flow**: session-refresh middleware (`src/middleware.ts`,
  `src/lib/supabase/middleware.ts`, ported from tucci-admin's
  `@supabase/ssr` pattern), login/signout server actions
  (`src/lib/auth/actions.ts`), login page, unauthorized page.
  Self-registration stays disabled (accounts are created by an org
  owner). `getCurrentUser` / `requireRole` / `requireOwner`
  (`src/lib/auth/guard.ts`) are now wired into a real page, not just
  existing as unused helpers.
- **Multi-org membership resolution** (`src/lib/org/membership.ts`):
  after login, 0 orgs shows a no-access message, exactly 1 auto-redirects
  into it, more than 1 shows a picker (name + role). Org-slug-to-org
  lookup relies on RLS (`orgs_by_membership`) as the actual access
  control: an org the caller isn't a member of is invisible, so it
  404s, not 403s.
- **Today screen** (`src/app/org/[slug]/page.tsx`, was a redirect to
  roster, now the real dashboard). Built to match Dave's ChatGPT
  redesign after resolving three conflicts with him (accent color,
  headline typeface, journey stepper - see docs/DECISIONS.md), then
  refocused per his direction that this is an org/recruiting management
  tool, not a life-management app: no add-a-task/add-an-event widgets.
  Shows a pipeline snapshot (athlete count, In Contact count, Committed
  count, all real counts from `athletes`/`recruiting_targets`), a
  "needs follow-up" list (open targets sorted by `updated_at`, oldest
  first), and "upcoming" (targets with a `visit_date` set, plus
  `transfer_windows` opening in the next 60 days). A "Program overview"
  section appears only when `orgs.modules.donor_fundraising` is true
  (Bridge, not Elite Squad) and is an honest "coming soon" placeholder,
  not an invented dollar figure - no fundraising data model exists yet.
- **Roster screen** (`src/app/org/[slug]/roster/page.tsx`), now with
  add/edit. Rail cards (catalog C2) with a gradient initials avatar and
  a color-coded `StatusPill` per row, the rail in that athlete's own
  status hue. Staff/owner see "+ Add";
  every row (everyone, not just staff/owner) links to the athlete detail
  screen (`roster/[id]`, below) rather than straight to the edit form
  (`src/lib/actions/athletes.ts`, `src/lib/validation/athlete.ts`,
  `src/components/AthleteForm.tsx`) - HS-vs-transfer conditional detail
  fields, international-athlete fields, server-side re-validation
  through the same `athleteDetailSchema` the fit engine reads. Gated
  through `requireRole`.
- **Athlete detail screen** (`src/app/org/[slug]/roster/[id]/page.tsx`):
  `JourneyStepper` finally wired to a real screen (see below), the
  athlete's own recruiting targets ("Colleges", reusing the same data
  the board shows), Contacts (new `contacts` table - athlete-scoped
  people: HS/travel coach, parent/guardian, advisor, college coach, with
  email/phone/notes and an optional linked school), and Visits (new
  `target_visits` table, aggregated across every target this athlete
  has). Staff/owner get an Edit link and can add/remove contacts;
  visits are logged from a target's edit page, not here (a visit is
  tied to one specific school). Migration `0006`.
- **Recruiting board screen** (`src/app/org/[slug]/board/page.tsx`), now
  with add/edit. Every `recruiting_targets` row for the org, grouped by
  status (Target/In Contact/Visit/Offer/Committed/Not Interested, in
  that pipeline order), with a fit tag and score computed live from
  `src/lib/fit/` rather than stored. Staff/owner see "+ Add target" and
  rows link to `board/new` / `board/[id]/edit`
  (`src/lib/actions/targets.ts`, `src/lib/validation/target.ts`,
  `src/components/TargetForm.tsx`). The action re-checks that a
  submitted `athleteId` actually belongs to the org before writing,
  since RLS alone doesn't catch a cross-org mismatch here.
- **Schools admin form** (`src/app/org/[slug]/schools/new`), owner-only.
  `schools` is shared reference data with no INSERT policy for ordinary
  users by design, so this writes through the service-role client
  (`src/lib/supabase/admin.ts`) after `requireOwner()` - the actual
  authorization happens in the app, not RLS. Linked from the target-add
  form's header and its "no schools yet" empty state, for owners only;
  non-owners still see an honest "ask an owner" message.
- **Communication log** (`target_communications` table, logged from the
  target-edit page). Every entry feeds `src/lib/fit/score.ts`'s
  `RecruitingSignals.commCount` on the board's live `scoreFit()` call
  (`src/lib/data/fitAdapters.ts`'s `communicationsToSignals`), computed
  fresh on every page load like the fit tag itself - not stored or
  cached. Logging one also bumps the parent target's `updated_at`, so
  Today's "needs follow-up" staleness reflects real engagement day to
  day, not just full-form edits.
- **Visit log** (`target_visits` table, migration `0006`, logged from
  the target-edit page and shown aggregated on the athlete detail
  screen). The sole source of `RecruitingSignals.visitCount`
  (`fitAdapters.ts`'s `visitsToVisitCount`) - richer than a bare
  `target_communications kind='visit'` entry: visit type, impression,
  next step. See docs/DECISIONS.md for why `visitCount` moved here.
- **Offer tracking** (`recruiting_targets.offer_type` /
  `.offer_scholarship_percent`, set from the target add/edit form,
  scholarship-percent field only shown for a scholarship offer). Feeds
  the third and last `RecruitingSignals` field, `offer`, into the
  board's live `scoreFit()` call (`fitAdapters.ts`'s
  `targetOfferToSignal`). Deliberately independent of
  `recruiting_targets.status = 'Offer'`, which is a pipeline stage, not
  an offer record - a scholarship offer and a verbal one score
  differently in `score.ts` even at the same status.
- **Shared org chrome** (`src/app/org/[slug]/layout.tsx`): org name up
  top, a bottom tab bar (`src/components/BottomTabBar.tsx`) for
  Today/Athletes/Board/More instead of the old text-link nav. Forces
  `data-theme="dark"` on every org screen - the redesign is dark-first
  and there's no light/dark toggle yet. Sign out moved to the new More
  screen (`src/app/org/[slug]/more/page.tsx`), which is otherwise a
  placeholder for account/org-switching, not yet built.
- **Recruiting-journey stepper** (`src/lib/journey.ts` +
  `src/components/JourneyStepper.tsx`): the 4-stage Profile/In
  Contact/Visits/Committed indicator from Dave's redesign, derived live
  from an athlete's `recruiting_targets.status` values (never stored) -
  his call when asked. Pure logic is unit-tested (7 tests); now rendered
  on the athlete detail screen above.
- **Visual redesign applied**: Dave built his own mockup in ChatGPT and
  asked to match its styling. Accent color is now Apple's `systemRed`
  (`#ff3b30`/`#ff453a` light/dark, his final call over both the old
  Bridge red and the redesign's own red), headline weight is Inter at
  800/900 (self-hosted via `next/font/local` from the vendored
  `@fontsource-variable/inter` woff2 in `src/app/fonts/` - deliberately
  not `next/font/google`, so the build never depends on reaching
  Google's font CDN). The color language has since been rebuilt twice on
  top of this: the locked styling catalog, then the Apple iOS palette and
  the role map that replaced it. See docs/STYLING_CATALOG.md for what is
  current and docs/DECISIONS.md for how it got there.
- **DB-to-fit-engine adapter** (`src/lib/data/fitAdapters.ts`): converts
  raw Supabase rows (snake_case columns) into `src/lib/fit/`'s plain
  camelCase types. Lives outside `src/lib/fit/` on purpose, so the fit
  engine itself stays walled off from anything DB-specific. A malformed
  jsonb field (bad `detail`, bad `academics`/`financials`/`athletics`)
  degrades to "not on file" rather than throwing and taking a page down;
  covered by `fitAdapters.test.ts` (14 tests).
- **Database schema** (`migrations/0001_core_schema.sql` through
  `0006_contacts_and_target_visits.sql`): `orgs`, `users`,
  `org_members`, `athletes`, `schools`, `recruiting_targets`,
  `benchmark_sets`, `transfer_windows`, `target_communications`,
  `contacts`, `target_visits`, with RLS policies on all 11 tables
  (`schools` has read-only RLS - see below), plus a `_member_org_ids()`
  SECURITY DEFINER helper (see below). `0002` adds five athlete columns
  (`is_international`, `toefl_score`, `ielts_score`, `f1_visa_status`,
  `ncaa_eligibility_status`) that the fit engine's `Athlete` type always
  declared but no migration had actually created - found building the
  board's data adapter. `0003` adds `recruiting_targets.updated_at` and
  `.visit_date` - found building the Today screen's "needs follow-up"
  and "upcoming" sections, which otherwise had no honest way to say how
  stale a target was or when a visit is scheduled. `0004` adds
  `target_communications` (call/text/email/visit/other, per-target),
  feeding `RecruitingSignals.commCount` into the board's `scoreFit()`
  call for the first time - it had been running with none. `0005` adds
  `recruiting_targets.offer_type` / `.offer_scholarship_percent`, the
  third `RecruitingSignals` field that had nothing real behind it. `0006`
  adds `contacts` and `target_visits` for the athlete detail screen;
  `RecruitingSignals.visitCount` moved from `target_communications` to
  `target_visits` here (see docs/DECISIONS.md). Tested twice:
  schema/relationship correctness as superuser, and real RLS enforcement
  as a non-superuser role (`scripts/run_rls_test.sh`, 22/22 assertions
  pass, all six migrations applied) - cross-org reads and writes are
  actually denied, not just that the relationships insert correctly.
  **Not yet applied to any real Supabase project.**
- **Fit-scoring engine** (`src/lib/fit/`): complete first pass.
  `types.ts`, `bands.ts`, `benchmarks.ts` (ported baseball/softball
  tier data), `academic.ts`, `athletic.ts`, `financial.ts`,
  `transfer.ts` (eligibility), `schema.ts` (Zod validation for
  `athletes.detail`), `score.ts` (the combiner), `index.ts` (public
  API). 6 smoke tests (`score.smoke.test.ts`) plus 9 laws-as-tests
  (`src/laws/`), all passing (15/15). `npx tsc --noEmit` clean.
- **Locked styling catalog** (`docs/STYLING_CATALOG.md`): fourteen
  component treatments, selected by Dave from an interactive catalog
  artifact rather than guessed at across revision rounds (see
  docs/DECISIONS.md). Converted so far: the token layer
  (`--solid-*` contrast-checked fill/foreground pairs in
  `globals.css` + `tailwind.config.ts`, including three new field-type
  hues named `time`/`people`/`place`, plus contrast-checked tint pairs
  for the surfaces that sit beside a solid one; the palette itself is
  Apple's iOS system colors and the role tier is generated by
  `scripts/gen_tokens.py`), the shared primitives
  in `src/components/catalog.tsx`, the single status-to-hue mapping in
  `src/components/statusHue.ts`, and the laws below. Applied across
  Today, Athletes, athlete detail, Board, More, login, every form and
  every empty state. Only T3 (toasts) is unapplied, because the app has
  no toast anywhere yet: every write is a server action that redirects
  rather than confirming in place.
- **Laws as tests** (`src/laws/`): the fit engine and Doc AI stay walled
  off from Next/Supabase/components/environment (a CLAUDE.md rule that had
  nothing enforcing it until a stub caller was written with a
  `process.env` read in it), no em dash, D3 never shows a
  scholarship-availability claim, transfer portal window never
  fabricated, a veto always overrides the blend, and the styling laws
  (a solid fill never appears without its paired foreground, the neutral
  fill always carries its hairline, no raw hex in components, the solid
  token set stays complete and Tailwind-exposed). Each has actually been
  proven to fail on a planted violation, not just asserted.
- **RLS enforcement test** (`scripts/`): real non-superuser role test,
  not just a superuser smoke test. Found and led to fixing a genuine
  infinite-recursion bug in the original RLS policies.
- **Doc AI core logic** (`src/lib/docai/`): categories registry (5
  document types + Zod schemas per type: transcript, test scores, offer
  letter, recommendation, financial aid; film is an explicit
  not-yet-supported placeholder), GPA scale normalization, fuzzy
  identity resolution, confidence scoring + auto-apply/review/reject
  routing, version reconciliation, and the full pipeline orchestration
  (triage -> extract -> validate -> route) tested end-to-end against a
  scripted fake model, no real API key or network needed. 52/52 tests
  pass across the repo, `npx tsc --noEmit` clean. Found and fixed a real
  double-penalty bug in Bridge's original low-legibility confidence
  handling (see docs/DECISIONS.md) that made its "review" queue
  mathematically unreachable.
- **Doc AI file ingest** (`src/lib/docai/magicBytes.ts`,
  `src/lib/docai/ingest.ts`): magic-byte sniffing (PDF/JPEG/PNG/GIF/WEBP/HEIC
  by leading bytes, not extension or claimed MIME) is pure logic, unit
  tested (11 tests). The browser-dependent half - decode via
  `createImageBitmap`/canvas, base64 encode, size-guard oversized files -
  can't run under vitest, so it's verified with Playwright driving a real
  headless Chromium instead (`scripts/docai_ingest_browsertest.mjs`,
  18/18 assertions pass). Trusts the browser's native EXIF-orientation
  handling rather than hand-parsing it - a first pass that hand-rolled
  EXIF rotation was found, via that same Playwright harness, to be
  double-rotating images, and was deleted. See docs/DECISIONS.md. Not
  yet wired to any page - it's a library module, not a screen.
- **Doc AI upload, review and apply** (`/org/[slug]/documents`,
  `/documents/new`, `/documents/[id]`, `src/lib/actions/documents.ts`,
  `migrations/0007_documents.sql`): the front end for the extraction
  pipeline that had been built and wired to nothing. Ingestion runs in the
  browser (`DocumentUploader.tsx`) because ingest.ts needs File/canvas;
  the pipeline and persistence run server-side. Per Dave, both ways in:
  triage names the type by default via the new `detectCategory()`, and a
  type can be forced. A document routes to applied, review or refused, and
  a human can apply it to a different athlete or discard it. **No real
  model is wired up**: `src/lib/docai/stubCaller.ts` drives the real
  pipeline with deterministic made-up results so the flow is usable, and
  every screen showing one says "Simulated reading" out loud. Verified the
  stub reaches all three routes rather than only the easy one
  (`stubCaller.test.ts`).
- **Previews and the functional test bench** (`scripts/build_previews.sh`,
  run after every finished feature per CLAUDE.md). The previews render the
  real screens from the app's own compiled CSS, parsing the color maps out
  of `statusHue.ts` rather than copying them. The bench
  (`scripts/build_testbench.py` + `testbench_entry.ts`) is not a mockup: it
  bundles the shipped `src/lib/fit/` and `src/lib/docai/` with esbuild and
  runs them in the browser, so the fit engine and the Doc AI pipeline can
  be driven by hand and the repo's own laws execute live. 19 assertions,
  checked in a real headless browser by `scripts/verify_testbench.mjs`
  before anything is published.
- **Docs**: this file, ARCHITECTURE.md, DESIGN_SYSTEM.md,
  BUSINESS_RULES.md, DECISIONS.md, PRODUCT.md, ROADMAP.md, CLAUDE.md.

## Known gaps (be honest about these, don't let them go stale)

- **RLS enforcement has been verified locally, not against real
  Supabase.** It has not been re-run against an actual Supabase project
  (real `auth.uid()` from a verified JWT, Supabase's own role setup) -
  do that before this schema goes anywhere near production, since a
  hosted project's exact role/grant setup can differ from this local
  approximation.
- **Today, roster (+ add/edit + detail), board (+ add/edit), schools
  add, and More exist as UI screens.** Communication tracking, a
  per-athlete detail route, contacts, a real visit log, and an
  owner-gated way to add a school are all built now (see above) - this
  gap is closed. Remaining known-missing piece: a real `ModelCaller`
  (see below).
- **Auth flow and all screens are structurally verified only, not
  runtime-verified.** `npx tsc --noEmit`, `npm test` (108/108), and
  `npm run build` all pass clean, but there is no real Supabase project
  or env vars yet, so actual sign-in, session refresh, RLS-backed org
  resolution, and the board's/Today's live queries have never run
  against a live backend or real seeded data. Confirm all of that once a
  real Supabase project exists.
- **The Today screen's "needs follow-up" staleness now has two real ways
  to move**: editing a target (`board/[id]/edit`) and logging a
  communication (same page) both bump `recruiting_targets.updated_at`.
  Before target-add/edit and the communication log existed, it only
  ever defaulted to `created_at` - now it moves under normal use, not
  just in theory.
- **The `schools.academics`/`financials`/`athletics`/`conflicts` jsonb
  key-casing convention (camelCase, matching `School` in
  `src/lib/fit/types.ts`) is decided and documented (docs/DECISIONS.md)
  but nothing has ever written real data into these columns** - the
  convention hasn't been exercised against a real school profile yet,
  only against test fixtures.
- **Next 16 flags the `middleware.ts` file convention as deprecated**
  in favor of a `proxy.ts` convention (`npx @next/codemod@canary
  middleware-to-proxy .` would migrate it). Still works today; not
  worth doing until this settles, since it may change again before
  Next 16 stabilizes further.
- **Doc AI has no real model wired up.** `pipeline.ts` takes an
  injected `ModelCaller`; nothing implements one against the real
  Anthropic API yet. That needs an API key (none exists in this
  environment) and a persistent per-org budget store (a DB table, since
  Bridge's localStorage-based budget tracking doesn't carry over to a
  multi-tenant server-side app).
- **Board/governance module does not exist**, toggleable or otherwise.
  `donor_fundraising` is now read (the Today screen's "Program overview"
  section gates on it), but only to show a "coming soon" placeholder -
  there is still no fundraising/donation data model behind it.
- **No repo has been created on GitHub for this project**, and nothing
  has been pushed anywhere. Everything is local commits only, per the
  "never push without Dave's explicit go" rule. The project's working
  name, "recruiting-platform," is a placeholder Dave has not confirmed.
- **`npm audit` reports 5 vulnerabilities** (3 moderate, 1 high, 1
  critical) as of the last `npm install`. Not yet triaged - do that
  before this is anywhere near production, especially before Supabase
  credentials exist in this repo's environment.

## Immediate next steps

See docs/ROADMAP.md.
