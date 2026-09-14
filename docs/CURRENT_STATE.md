# Current state

Last updated: 2026-09-14. Replaced wholesale when this changes
meaningfully, not appended to.

## What exists

- **Scaffold**: Next.js 16 / React 19 / TypeScript / Tailwind /
  Supabase, dependency versions matching tucci-admin. No pages beyond a
  placeholder `src/app/page.tsx`. No auth flow wired up yet beyond the
  `getCurrentUser` / `requireRole` / `requireOwner` helpers in
  `src/lib/auth/guard.ts`.
- **Database schema** (`migrations/0001_core_schema.sql`): `orgs`,
  `users`, `org_members`, `athletes`, `schools`, `recruiting_targets`,
  `benchmark_sets`, `transfer_windows`, with RLS policies on all 8
  tables, plus a `_member_org_ids()` SECURITY DEFINER helper (see
  below). Tested twice: schema/relationship correctness as superuser,
  and real RLS enforcement as a non-superuser role
  (`scripts/run_rls_test.sh`, 10/10 assertions pass) - cross-org reads
  and writes are actually denied, not just that the relationships
  insert correctly. **Not yet applied to any real Supabase project.**
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
- **Docs**: this file, ARCHITECTURE.md, DESIGN_SYSTEM.md,
  BUSINESS_RULES.md, DECISIONS.md, PRODUCT.md, ROADMAP.md, CLAUDE.md.

## Known gaps (be honest about these, don't let them go stale)

- **RLS enforcement has been verified locally, not against real
  Supabase.** `scripts/run_rls_test.sh` proves the policies work
  against a local Postgres 16 with a stubbed `auth` schema and a real
  non-superuser role. It caught and led to fixing a genuine infinite-
  recursion bug in the original policies (see docs/DECISIONS.md). It
  has not been re-run against an actual Supabase project (real
  `auth.uid()` from a verified JWT, Supabase's own role setup) - do
  that before this schema goes anywhere near production, since a
  hosted project's exact role/grant setup can differ from this local
  approximation.
- **No UI exists.** Roster, recruiting board, communication tracking,
  calendar - none of it is built. docs/DESIGN_SYSTEM.md documents the
  rules to build against, not built screens.
- **Doc AI (document upload/extraction) has not been started.** Bridge's
  real `Engine`/`EngineBridge` system (bffsa-site/index.html ~lines
  1621-2660, 13358-14973) has been read and understood but nothing has
  been ported or redesigned yet.
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
