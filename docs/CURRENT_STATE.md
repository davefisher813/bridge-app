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
- **No UI exists.** Roster, recruiting board, communication tracking,
  calendar - none of it is built. docs/DESIGN_SYSTEM.md documents the
  rules to build against, not built screens.
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
