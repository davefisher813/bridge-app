# Current state

Last updated: 2026-09-15 (post-redesign pass). Replaced wholesale when
this changes meaningfully, not appended to.

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
- **Roster screen** (`src/app/org/[slug]/roster/page.tsx`). Read-only
  full-bleed list per DESIGN_SYSTEM.md's chassis rule (plain list =
  rows, not cards). Now shows an initials avatar and a color-coded
  `StatusPill` per row. Honest empty state pointing at ROADMAP.md, since
  add/edit isn't built. Gated through `requireRole`.
- **Recruiting board screen** (`src/app/org/[slug]/board/page.tsx`).
  Every `recruiting_targets` row for the org, grouped by status
  (Target/In Contact/Visit/Offer/Committed/Not Interested, in that
  pipeline order), with a fit tag and score computed live from
  `src/lib/fit/` rather than stored, so it can never go stale the way a
  saved tag could. Read-only; adding/updating a target isn't built.
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
  his call when asked. Pure logic is unit-tested (7 tests); no screen
  renders it yet since there's no per-athlete detail route (see Known
  gaps).
- **Visual redesign applied**: Dave built his own mockup in ChatGPT and
  asked to match its styling. Accent color is now Apple's `systemRed`
  (`#ff3b30`/`#ff453a` light/dark, his final call over both the old
  Bridge red and the redesign's own red), headline weight is Inter at
  800/900 (self-hosted via `next/font/local` from the vendored
  `@fontsource-variable/inter` woff2 in `src/app/fonts/` - deliberately
  not `next/font/google`, so the build never depends on reaching
  Google's font CDN), and a `--info` token (indigo) was added for the
  "In Contact" status color. See docs/DECISIONS.md for the full
  conflict-resolution history and a red-comparison artifact.
- **DB-to-fit-engine adapter** (`src/lib/data/fitAdapters.ts`): converts
  raw Supabase rows (snake_case columns) into `src/lib/fit/`'s plain
  camelCase types. Lives outside `src/lib/fit/` on purpose, so the fit
  engine itself stays walled off from anything DB-specific. A malformed
  jsonb field (bad `detail`, bad `academics`/`financials`/`athletics`)
  degrades to "not on file" rather than throwing and taking a page down;
  covered by `fitAdapters.test.ts` (6 tests).
- **Database schema** (`migrations/0001_core_schema.sql`,
  `0002_athlete_intl_eligibility_fields.sql`,
  `0003_recruiting_target_tracking_fields.sql`): `orgs`, `users`,
  `org_members`, `athletes`, `schools`, `recruiting_targets`,
  `benchmark_sets`, `transfer_windows`, with RLS policies on all 8
  tables, plus a `_member_org_ids()` SECURITY DEFINER helper (see
  below). `0002` adds five athlete columns (`is_international`,
  `toefl_score`, `ielts_score`, `f1_visa_status`,
  `ncaa_eligibility_status`) that the fit engine's `Athlete` type always
  declared but no migration had actually created - found building the
  board's data adapter. `0003` adds `recruiting_targets.updated_at` and
  `.visit_date` - found building the Today screen's "needs follow-up"
  and "upcoming" sections, which otherwise had no honest way to say how
  stale a target was or when a visit is scheduled. Tested twice:
  schema/relationship correctness as superuser, and real RLS enforcement
  as a non-superuser role (`scripts/run_rls_test.sh`, 11/11 assertions
  pass, all three migrations applied) - cross-org reads and writes are
  actually denied, not just that the relationships insert correctly.
  **Not yet applied to any real Supabase project.**
- **Fit-scoring engine** (`src/lib/fit/`): complete first pass.
  `types.ts`, `bands.ts`, `benchmarks.ts` (ported baseball/softball
  tier data), `academic.ts`, `athletic.ts`, `financial.ts`,
  `transfer.ts` (eligibility), `schema.ts` (Zod validation for
  `athletes.detail`), `score.ts` (the combiner), `index.ts` (public
  API). 6 smoke tests (`score.smoke.test.ts`) plus 9 laws-as-tests
  (`src/laws/`), all passing (15/15). `npx tsc --noEmit` clean.
- **Laws as tests** (`src/laws/`): no em dash, D3 never shows a
  scholarship-availability claim, transfer portal window never
  fabricated, a veto always overrides the blend. Each has actually been
  proven to fail on a planted violation this session, not just asserted.
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
- **Docs**: this file, ARCHITECTURE.md, DESIGN_SYSTEM.md,
  BUSINESS_RULES.md, DECISIONS.md, PRODUCT.md, ROADMAP.md, CLAUDE.md.

## Known gaps (be honest about these, don't let them go stale)

- **RLS enforcement has been verified locally, not against real
  Supabase.** It has not been re-run against an actual Supabase project
  (real `auth.uid()` from a verified JWT, Supabase's own role setup) -
  do that before this schema goes anywhere near production, since a
  hosted project's exact role/grant setup can differ from this local
  approximation.
- **Only Today, roster, board, and More exist as UI screens.** No
  add/edit for athletes or targets, no communication tracking, no
  per-athlete detail route. The recruiting-journey stepper
  (`JourneyStepper.tsx`) is built and tested but nothing renders it yet
  - it belongs on an athlete profile screen that doesn't exist. That
  screen is mocked in the full-preview artifact Dave approved but was
  deliberately not built as real code this pass: it needs its own
  routing and, for the Colleges/Contacts/Visits tabs shown in the mock,
  data this schema doesn't fully back yet (contacts has no table; visits
  has only the new `visit_date` on a target, not a real log). Confirm
  scope with Dave before building it. docs/DESIGN_SYSTEM.md documents
  the rules to build against.
- **Auth flow and all four screens are structurally verified only, not
  runtime-verified.** `npx tsc --noEmit`, `npm test` (69/69), and
  `npm run build` all pass clean, but there is no real Supabase project
  or env vars yet, so actual sign-in, session refresh, RLS-backed org
  resolution, and the board's/Today's live queries have never run
  against a live backend or real seeded data. Confirm all of that once a
  real Supabase project exists.
- **The Today screen's "needs follow-up" staleness is honest but young.**
  `recruiting_targets.updated_at` (added in `0003`) defaults to
  `created_at` and is only bumped by app code on an edit - and target
  editing isn't built yet. Until it is, every target's "no update in N
  days" is really "days since created," which is accurate but will read
  oddly once real data exists and nothing has touched it in months.
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
- **Doc AI's file-ingest pipeline has not been ported.** Bridge's real
  ingest code (magic-byte sniffing, HEIC conversion, EXIF-aware image
  normalization, PDF pre-validation) depends on `File`/`Image`/
  `canvas`/`FileReader`, none of which exist in this build sandbox to
  actually exercise. Porting it without a browser to verify it in would
  mean shipping untested code while claiming otherwise - deferred to
  when real screens exist. See docs/ARCHITECTURE.md.
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
