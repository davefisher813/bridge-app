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
