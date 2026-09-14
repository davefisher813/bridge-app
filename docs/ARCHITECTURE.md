# Architecture

## Stack

Next.js 16 (App Router), React 19, TypeScript 5.7, Tailwind 3.4,
Supabase (`@supabase/ssr` + `@supabase/supabase-js`), Vitest. This
mirrors tucci-admin's stack exactly, dependency versions included -
tucci-admin is the only current (non-abandoned), correctly-documented
Next.js/Supabase repo of Dave's, so it's the reference rather than
JARVIS (which is a different kind of app: single-user, offline-capable,
`item`-table entity model) or Bridge (single-file PWA, no build step).

## Multi-tenancy: membership table from day one

JARVIS's own architecture doc describes a "single owner_id row now,
membership table later" pattern: start with `owner_id = auth.uid()` RLS
and defer real multi-tenancy until it's needed. That pattern doesn't fit
here, because two real organizations (Bridge and Elite Squad) exist on
day one, not hypothetically later. So the membership table
(`org_members`) is the starting point, not a future migration:

- `orgs` - one row per organization, with `role_labels` (display-only
  role names per org), `modules` (feature toggles), `branding`.
- `org_members` - `(user_id, org_id, role)`. A person can belong to more
  than one org (a coach who volunteers at two organizations).
- Every org-scoped table (`athletes`, `recruiting_targets`,
  `benchmark_sets`) carries `org_id` and an RLS policy of the shape
  `org_id in (select org_id from org_members where user_id = auth.uid())`.
- `schools` and `transfer_windows` are shared reference data, not
  org-scoped: one canonical school row is reused by every org recruiting
  it, so two orgs never duplicate or collide on the same school's facts.

See `migrations/0001_core_schema.sql` for the full schema and RLS
policies, and docs/DECISIONS.md for why this wasn't deferred the way
JARVIS deferred its own equivalent step.

## Shape validation: Postgres owns access, the app owns shape

Borrowed directly from jarvis-core's philosophy for its `item.data`
jsonb column: "Postgres validates ownership; the app validates shape."
`athletes.detail` is `jsonb` with no Postgres-level shape constraint. Its
shape (an `hs` or `transfer` discriminated union, see
`src/lib/fit/types.ts`) is validated by Zod in `src/lib/fit/schema.ts`
before any write. This means a new recruit_type, or a new field on an
existing one, is a code change and a Zod schema update, never a
migration.

## The fit-scoring module: a walled-off module, not a Bridge feature

`src/lib/fit/` is the rebuilt replacement for Bridge's
`calcCollegeFit()` / `calcAcademicFitTag()` / `calcAthleticFitTag()` /
`calcFinancialFitTag()` patch stack
(bffsa-site/index.html ~lines 10469-11530). It takes no dependency on
anything Bridge-specific (board/governance, donor/fundraising, BFFSA
branding) and no dependency on Next.js/Supabase - it's pure functions
over plain types, so it can be lifted into a standalone recruiting
product later without a rewrite. That's the concrete meaning of "walled
off": an import boundary, checked by nothing more exotic than "does this
file import from outside src/lib/fit/", enforceable as a law later if it
ever needs to be.

### Why a `veto` field instead of tag ordering

Bridge's combiner (`calcCollegeFit`) worked by computing a tag
(Conflict/Reach/Fit/Safety/Unknown) per dimension, taking the worse of
academic/athletic by a hand-written ordering table, then applying five
more sequential override layers (financial nudge, offer boost, coach-
engagement boost, playing-time-outlook downgrade, in that order) each
capable of undoing the one before it. This is exactly what Dave
described as frustrating: it "could provide so much value, and it just
wouldn't work cleanly."

The replacement gives every dimension the same `DimensionResult` shape:

```
{ score: 0-100, confidence: high|medium|low|unknown, veto: boolean, reasons: string[], warnings: string[] }
```

A `veto: true` (a hard conflict - GPA below a school's floor, a JUCO
transfer below the 2.5 GPA minimum, a school that doesn't sponsor the
athlete's sport) always overrides the weighted blend in
`src/lib/fit/score.ts`, full stop. Absent a veto, dimensions blend with
one documented set of weights (see the WEIGHTS constants in
`score.ts`). Recruiting signals (offers, visits, comms) are applied once
afterward as bounded nudges, not another chain of tag reassignments.

### Dimensions

- `academic.ts` - GPA (with course-rigor boost for HS, college GPA for
  transfers), SAT/ACT signal, major availability (advisory only),
  division-default fallback when a school profile has no academic data.
- `athletic.ts` - baseball/softball uses the ported tier/position
  benchmark tables (`benchmarks.ts`, faithful to Bridge's real,
  admin-tuned `getDefaultBenchmarks()`); other sports use a tier-
  multiplier model, ported from Bridge's `_calcAthleticFitNonBaseball`
  but unified through the same `runCheck()` used by baseball, instead of
  two separately-shaped functions.
- `financial.ts` - D3 (never any scholarship claim, merit/need aid
  coverage instead) vs. D1/D2/NAIA/JUCO (scholarship-type + aid-vs-cost
  model, with a D1-only roster-spots signal for the House settlement).
  Always `veto: false` - financial is advisory, same as Bridge's own
  design intent, just made explicit instead of implicit.
- `transfer.ts` - eligibility dimension, only computed for
  `transfer_4to4` / `transfer_juco` / `transfer_grad`. New: Bridge never
  recruited transfers. See docs/BUSINESS_RULES.md for the NCAA rules
  encoded here.

See docs/BUSINESS_RULES.md for the specific rules each dimension
encodes and how they were verified.

## Roles

`org_role` is a 3-value enum: `owner | staff | member`. Generalized from
tucci-admin's real `owner | admin | coach | reception | family` +
`requireRole()` pattern. The *label* a person sees (Bridge: "Executive
Director" / "Coordinator"; Elite Squad: "Owner" / "Coach") is org-level
config in `orgs.role_labels`, never a second permission system - see
`src/lib/auth/guard.ts`.

## Testing a Supabase-flavored migration without Docker or a live project

`migrations/0001_core_schema.sql` was tested against a real local
Postgres 16 instance (Docker was unavailable in the build sandbox) by
stubbing a minimal `auth` schema - a bare `auth.users` table plus
`auth.uid()` / `auth.role()` stub functions - so RLS policies that
reference `auth.uid()` parse and run without the full Supabase stack.
Smoke-tested with sample inserts across all 8 tables including the
recruiting_targets join. This is a schema/relationship smoke test only:
RLS *enforcement* (does a non-superuser role actually get denied cross-
org rows) was not verified this way, since the smoke test ran as
superuser, which bypasses RLS entirely. That remains an open item - see
docs/CURRENT_STATE.md.

## What isn't built yet

Doc AI (document upload/extraction), the actual UI (roster, recruiting
board, communication, calendar), board/governance and donor/fundraising
modules, and any deployment/hosting setup. See docs/ROADMAP.md.
