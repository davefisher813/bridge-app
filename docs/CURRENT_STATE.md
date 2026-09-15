# Current state

Last updated: 2026-09-15. Replaced wholesale when this changes
meaningfully, not appended to.

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
- **Roster screen** (`src/app/org/[slug]/roster/page.tsx`). Read-only
  full-bleed list per DESIGN_SYSTEM.md's chassis rule (plain list =
  rows, not cards). Honest empty state pointing at ROADMAP.md, since
  add/edit isn't built. Gated through `requireRole`.
- **Recruiting board screen** (`src/app/org/[slug]/board/page.tsx`).
  Every `recruiting_targets` row for the org, grouped by status
  (Target/In Contact/Visit/Offer/Committed/Not Interested, in that
  pipeline order), with a fit tag and score computed live from
  `src/lib/fit/` rather than stored, so it can never go stale the way a
  saved tag could. Read-only; adding/updating a target isn't built.
- **Shared org chrome** (`src/app/org/[slug]/layout.tsx`): org name,
  a Roster/Board nav, sign out - one place instead of each page
  duplicating a header.
- **DB-to-fit-engine adapter** (`src/lib/data/fitAdapters.ts`): converts
  raw Supabase rows (snake_case columns) into `src/lib/fit/`'s plain
  camelCase types. Lives outside `src/lib/fit/` on purpose, so the fit
  engine itself stays walled off from anything DB-specific. A malformed
  jsonb field (bad `detail`, bad `academics`/`financials`/`athletics`)
  degrades to "not on file" rather than throwing and taking a page down;
  covered by `fitAdapters.test.ts` (6 tests).
- **Database schema** (`migrations/0001_core_schema.sql`,
  `0002_athlete_intl_eligibility_fields.sql`): `orgs`, `users`,
  `org_members`, `athletes`, `schools`, `recruiting_targets`,
  `benchmark_sets`, `transfer_windows`, with RLS policies on all 8
  tables, plus a `_member_org_ids()` SECURITY DEFINER helper (see
  below). `0002` adds five athlete columns (`is_international`,
  `toefl_score`, `ielts_score`, `f1_visa_status`,
  `ncaa_eligibility_status`) that the fit engine's `Athlete` type always
  declared but no migration had actually created - found building the
  board's data adapter. Tested twice: schema/relationship correctness as
  superuser, and real RLS enforcement as a non-superuser role
  (`scripts/run_rls_test.sh`, 11/11 assertions pass, both migrations
  applied) - cross-org reads and writes are actually denied, not just
  that the relationships insert correctly. **Not yet applied to any real
  Supabase project.**
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
- **Only roster and board exist as UI screens.** No add/edit for
  athletes or targets, no communication tracking, no calendar. Adding a
  target or an athlete has to go through Supabase directly or a future
  screen. docs/DESIGN_SYSTEM.md documents the rules to build against.
- **Auth flow and both screens are structurally verified only, not
  runtime-verified.** `npx tsc --noEmit`, `npm test` (58/58), and
  `npm run build` all pass clean, but there is no real Supabase project
  or env vars yet, so actual sign-in, session refresh, RLS-backed org
  resolution, and the board's live fit-scoring query have never run
  against a live backend or real seeded data. Confirm all of that once a
  real Supabase project exists.
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
- **Board/governance and donor/fundraising modules do not exist**,
  toggleable or otherwise. `orgs.modules` has the flags reserved; no
  code reads them yet.
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
