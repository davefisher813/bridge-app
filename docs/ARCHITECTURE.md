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

Same pattern for `orgs.modules` (`src/lib/org/modules.ts`): a jsonb
feature-toggle map, parsed with a Zod schema whose every field has a
`.catch()` default, so a malformed or missing key degrades to the safe
default (recruiting/doc_ai on, board_governance/donor_fundraising off)
instead of throwing. `getOrgBySlug` returns the parsed `OrgModules`
alongside the org, so a page checks `org.modules.donor_fundraising`
rather than reading raw jsonb itself.

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

### The DB-to-fit-engine seam: `src/lib/data/fitAdapters.ts`

The walled-off boundary means `src/lib/fit/` never imports Supabase or
knows a column is `snake_case`. Something still has to bridge a raw
`athletes`/`schools`/`transfer_windows` row into `Athlete`/`School`/
`TransferWindow` - that's `src/lib/data/fitAdapters.ts`, deliberately
outside `src/lib/fit/`. It does two things: renames columns
(`is_international` -> `isInternational`, etc.) and validates the jsonb
columns (`athletes.detail`, `schools.academics`/`financials`/
`athletics`/`conflicts`) through the Zod schemas in
`src/lib/fit/schema.ts`, degrading a malformed field to "not on file"
(`.catch({})` / `.catch([])`) rather than throwing - a bad row from
shared reference data (schools) or a hand-edited jsonb value should
never take down a whole page. `src/app/org/[slug]/board/page.tsx` is
the first caller.

`schools.academics`/`financials`/`athletics`/`conflicts` jsonb use
camelCase keys, matching `School` in `types.ts` directly (same
convention `athletes.detail` already used) - see docs/DECISIONS.md for
why this needed deciding explicitly rather than being obvious.

### Stored matches: `src/lib/data/fits.ts`

A match is stored, not recomputed on view (docs/MATCHING_CONTRACT.md).
`athlete_school_fits` holds one row per athlete by school: score, tag,
`partial`, the dimensions with their reasons and warnings, a hash of
the inputs and a timestamp. `fits.ts` is the only writer. It loads the
org's context (preset, transfer windows, positions of need, board
status), the athletes with their metric logs, and the schools, runs the
pure engine, and upserts in batches of 500. Four entry points match the
contract's recompute table: one athlete against every school, every
athlete in the org, every athlete against one school, and every org
against a set of schools (the admin client, after a shared school
changes). The engine is pure and cheap, so this runs inline in the
server action that changed the input rather than in a job. Screens
read rows through `loadFitsForAthlete` and `loadFitsForPairs`; the one
live compute left is `loadTarget`'s fallback when no row exists yet,
which Recalculate All under More fills.

The metrics log (`athlete_metrics`) feeds the engine through
`selectScoringMetrics` in `src/lib/fit/metrics.ts`: best value in the
most trusted source tier, else the most recent self-reported one, and
the chosen entry's source tier is the athletic dimension's confidence.
`athleteRowToFitAthlete` merges the log over the legacy `measurables`
column so rows written before the log still score.

## Roles

`org_role` is a 4-value enum: `owner | staff | member | family`.
Generalized from tucci-admin's real `owner | admin | coach | reception |
family` + `requireRole()` pattern. The *label* a person sees (Bridge:
"Executive Director" / "Coordinator"; Elite Squad: "Owner" / "Coach") is
org-level config in `orgs.role_labels`, never a second permission
system - see `src/lib/auth/guard.ts`.

The first three read the whole org and differ only in what they write.
`family` (migrations 0022 and 0023) reads one athlete: the rows in
`athlete_guardians` for their user id say which. The RLS helpers in the
`private` schema carry the split: `_member_org_ids()` returns the orgs
the caller reads in full and excludes the family role; `_any_org_ids()`
is every membership and is used only to resolve the org row;
`_family_athlete_ids()` is the athletes a family member may see, and
`_family_staff_ids()` the people they may ask. Every read policy on
athlete data is `org_id in member orgs OR athlete_id in family
athletes`; every write policy is `org_id in staff orgs`, which never
included family. A trigger on `athlete_guardians` refuses a row whose
athlete or person is not in the row's org, so the org id on it cannot be
used to cross tenants. `scripts/rls_test.sql` seeds a family member and
asserts each of these.

## Testing a Supabase-flavored migration without Docker or a live project

`migrations/0001_core_schema.sql` was tested against a real local
Postgres 16 instance (Docker was unavailable in the build sandbox) by
stubbing a minimal `auth` schema - a bare `auth.users` table plus
`auth.uid()` / `auth.role()` stub functions - so RLS policies that
reference `auth.uid()` parse and run without the full Supabase stack.
Smoke-tested with sample inserts across all 8 tables including the
recruiting_targets join.

That first pass was a schema/relationship smoke test only, run as the
Postgres superuser, which bypasses RLS unconditionally - it could never
have caught an RLS bug. `scripts/run_rls_test.sh` closes that gap: it
extends the `auth` stub with a settable session GUC so a script can
impersonate different users, creates a genuine non-superuser
(`NOBYPASSRLS`) role, and asserts cross-org reads/writes are actually
denied. Running it found a real bug on the first try: `org_members`'s
own RLS policy queried `org_members`, so any other policy that also
filtered through `org_members` (athletes, recruiting_targets,
benchmark_sets) recursed into re-evaluating that same policy, forever
("infinite recursion detected in policy for relation org_members").
Fixed with the standard pattern - a `SECURITY DEFINER` helper function,
`_member_org_ids()`, owned by the role that owns `org_members`, so its
internal query bypasses `org_members`'s RLS (owner bypass) instead of
re-triggering it. Every org-scoped policy now goes through that
function instead of querying `org_members` directly. All 10 RLS
assertions pass after the fix; see `scripts/README.md`.

This has been verified locally, not yet against a real Supabase
project - see docs/CURRENT_STATE.md.

## Doc AI: document upload + structured-data extraction

`src/lib/docai/` rebuilds Bridge's `Engine`/`EngineBridge`
(bffsa-site/index.html ~lines 1621-2660, 13358-14973). Unlike the fit
engine, most of Bridge's Doc AI design was already coherent: a
config-driven categories registry, a confidence-scoring model with
named thresholds, and a versioning/reconciliation step, not a patch
stack. So this is mostly a port-and-generalize:

- `categories.ts` - one registry entry per document type (transcript,
  test scores, offer letter, recommendation, financial aid; film is a
  placeholder that stops at "not supported yet"). Each entry pairs an
  extraction prompt with a Zod schema (`schemas.ts`) - the one thing
  Bridge's version never had. Bridge trusted raw `JSON.parse` output
  completely; here, extraction output that doesn't match its category's
  schema is rejected before anything downstream (a database write, a
  review queue) ever sees it.
- `gpa.ts` - GPA scale normalization (4.0/5.0/10/20/100-point scales to
  a common 4.0 scale), ported as-is: admin-tuned conversion data, not a
  patch.
- `resolver.ts` - fuzzy name/school/grad-year matching to find which
  roster athlete a document belongs to, plus an override-pinning path
  for when a coordinator explicitly names the athlete. Pure functions
  over a roster array the caller supplies, same "no database access
  inside the module" design as the fit engine.
- `provenance.ts` - confidence scoring (`effectiveConfidence`: model
  confidence x source-role weight x triage legibility) and the
  auto-apply/review/reject routing decision. See docs/DECISIONS.md for
  a real double-penalty bug this port found and fixed in the original
  low-legibility handling.
- `versioning.ts` - classifies a new extraction against prior ones for
  the same athlete/category as a replacement (same grad year, recent)
  or a new period. Bridge kept this index in localStorage; here the
  caller supplies prior versions queried from the database, since
  localStorage doesn't exist server-side and wasn't shared across an
  org's users anyway.
- `parseModelJson.ts` - strips markdown fences and recovers a JSON
  object from a model response that ignored the "return only JSON"
  instruction, same cleanup Bridge repeated in three places.
- `pipeline.ts` - orchestrates triage -> extract -> validate -> route.
  Takes a `ModelCaller` the caller supplies (a thin wrapper around
  whatever actually calls the Anthropic API), so the whole pipeline is
  testable with a scripted fake model and touches no network or API key
  in tests. Returns a result; it never writes to a database itself -
  Bridge's version wrote straight into a global object, which doesn't
  have an equivalent here since `org_id` and RLS matter for where a
  result actually lands.

**Built and verified:** the file ingest pipeline
(`src/lib/docai/magicBytes.ts`, `src/lib/docai/ingest.ts`). Magic-byte
sniffing (PDF/JPEG/PNG/GIF/WEBP/HEIC by leading bytes, not extension or
claimed MIME type) is pure logic, unit-tested under vitest like the
rest of the fit engine. The browser-dependent half
(`File`/`FileReader`/`Blob`/`createImageBitmap`/`canvas`) can't run
under vitest's node environment, so it's verified instead with
Playwright driving a real headless Chromium
(`scripts/docai_ingest_browsertest.mjs`, 18/18 assertions passing) -
this sandbox has both available, so the "can't test it, can't ship it"
problem that used to defer this doesn't apply anymore.

One design change from Bridge's original: EXIF orientation is *not*
hand-parsed and rotated. The first pass did that (parse the JPEG's own
orientation tag, rotate via canvas transform), but the Playwright
verification caught that this sandbox's Chromium auto-rotates on
`createImageBitmap` regardless of an explicit `imageOrientation: "none"`
override, so the manual rotation was silently applying a second,
wrong rotation on top of the browser's own. The fix was to delete the
manual EXIF code entirely and trust `createImageBitmap`'s native
orientation handling. See docs/DECISIONS.md. HEIC files are detected
by magic bytes but not decoded (neither this browser nor Anthropic's
API can read HEIC directly) - surfaced to the caller as an honest
`fallbackReason` rather than silently mis-processed.

**The real caller (2026-09-21):** `src/lib/ai/anthropicCaller.ts`
implements `ModelCaller` on the official SDK, outside the walled module
so `src/lib/docai` stays free of the SDK, the environment and the
network. Each ingested file goes over as a document (PDF) or image
block; a file the model cannot take (HEIC) is named in the prompt
rather than dropped. The SDK's own retries cover 429 and 5xx. A
refusal, an empty answer or an answer cut off at `max_tokens` throws,
which `pipeline.ts` already files as a failed extraction. Every call
reports its tokens and cost (list price, cache reads and writes
included) to the caller-supplied `onUsage`, and the document action
writes that to `docai_usage` (migration 0025) with the org and the
document. The cap is `orgs.docai_budget_cents`, per calendar month,
owner-set under More; `processDocument` reads the month's ledger and
refuses before writing a row or reading a byte once the cap is reached.
`isStubbedModel()` (no `ANTHROPIC_API_KEY`) still selects the stub, so
the whole flow runs and is labelled simulated until a key exists.

**Applying each type (2026-09-21):** a transcript writes GPA, date of
birth, the course rows and a grading scale (in `documents.ts`, the
original). The other four live in `src/lib/data/applyExtraction.ts`,
plain functions over the caller's client: test scores put the best SAT
total and ACT composite on a high school athlete's `detail` (a
transfer's stay on the document); an offer letter finds the school by
name on the shared table (exact, then a single containing match, never
a guess), then creates the recruiting target as Offer or moves an
existing one to Offer with the offer type, percentage and coach; an
award letter puts its numbers on the same target's `aid` column
(migration 0027), which the financial dimension reads as the known net
cost; a recommendation letter becomes a contact with the letter's kind,
tone, date and summary in its notes, once per name. Every apply records
before and after in `documents.applied_changes`, discard restores a
value only while it still holds what the document wrote, a created
target or contact is removed, and a target or score change rescores the
athlete's stored matches. A letter naming a school not on file applies
nothing and says to add the school first; a FAFSA or EFC report is kept
on file and changes nothing, since only an award letter carries a
school's numbers.

**Where the file goes (2026-09-19).** The browser uploads each
ingested file to a private Supabase Storage bucket, `documents`, at
`<org id>/<request id>/<n>-<name>`, and the server action receives a
`StoredRecord`: the `IngestedRecord` with its bytes replaced by that
path. The action reads the bytes back with the caller's own client, so
the bucket's policies (staff of the org write, members read, keyed off
the first path segment) decide what it may see, then runs the same
acceptance checks on what arrived. Nothing about `src/lib/docai`
changed: the pipeline still takes `IngestedRecord[]` with base64 in it.
The bytes never cross a server action call because Next caps that body
at 1MB and a scanned transcript is not. A law in `src/laws/dataLaws.test.ts`
keeps it that way.

## The UI

Every screen composes `src/components/kit/` and writes layout classes
only; the contract is docs/STYLING_CATALOG.md and the laws in
`src/laws/kitLaws.test.ts` fail the build on anything else. The
preview is the same pages rendered on the fixture
(`scripts/preview/build_app_preview.ts`, driven by the list in
`src/testing/pages.ts` that the render law also executes), so it
cannot drift from the app, and `scripts/audit_preview.mjs` inspects
what a browser computed on each screen in both themes.

## Auth

Supabase Auth with `@supabase/ssr`. `src/proxy.ts` (Next 16's name for
the middleware file) refreshes the session on every request and sends a
signed-out person to `/login`; `/auth` and `/unauthorized` are the only
other public paths.

Two ways in. **Password** is the first screen (Dave's selection,
2026-09-19, after Supabase's email rate limit locked him out of the
link flow for an afternoon): email and password on one form. **Magic
link** (`sendMagicLink` in `src/lib/auth/actions.ts`) sits behind
"Email me a link instead": `signInWithOtp` with `shouldCreateUser:
false`, so the form never creates an account and never confirms which
addresses have one. Both land on
`/auth/callback`, which accepts a `token_hash` (the shape the email
templates should be set to, because a link tapped in Mail on an iPhone
opens Safari rather than the app that asked) or a PKCE `code`, and only
ever redirects to a path on this site.

A trigger on `auth.users` (migration 0017, in the `private` schema)
keeps `public.users` in step: id, email and a name carried on the
invitation. Membership is a separate row in `org_members`, written only
by the service role behind `requireOwner()` (`src/lib/actions/members.ts`),
because the row grants everything and carries its own role. An org can
never be left without an owner.

## What isn't built yet

Transfer window entry, and Invite Family on the athlete's page. Doc
AI's real caller exists and waits only on `ANTHROPIC_API_KEY` being set
on the server. See docs/ROADMAP.md and docs/CURRENT_STATE.md.
