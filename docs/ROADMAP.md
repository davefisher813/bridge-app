# Roadmap

Not a committed timeline - Dave hasn't scoped dates for any of this yet.
Ordered by what naturally follows what's already built.

## Done from the original "next up" list

1. ~~Verify RLS enforcement for real~~ - done, found and fixed a real
   infinite-recursion bug. See docs/DECISIONS.md.
2. ~~Doc AI redesign~~ - core logic done (categories, schemas, GPA
   normalization, resolver, provenance/routing, versioning, pipeline
   orchestration), found and fixed a real double-penalty bug in the
   confidence math. Ingest and the real API call are not done - see
   below.
3. ~~Auth flow~~ - sign-in, sign-out, session-refresh middleware, and
   multi-org membership resolution (0/1/many orgs) are wired up and
   built against `requireRole`. Structurally verified (typecheck, tests,
   build); not yet runtime-verified against a real Supabase project,
   since none exists.
4. ~~First real screen: roster~~ - read-only athletes list, gated
   through `requireRole`. Add/edit still not built.
5. ~~Recruiting board~~ - every target grouped by status, with a fit
   tag/score computed live (not stored) via the new
   `src/lib/data/fitAdapters.ts` bridge into `src/lib/fit/`. Found and
   fixed a real schema gap doing it: `athletes` was missing five columns
   (`is_international`, `toefl_score`, `ielts_score`, `f1_visa_status`,
   `ncaa_eligibility_status`) the fit engine's `Athlete` type always
   declared. See docs/DECISIONS.md. Read-only; adding/updating a target
   still isn't built.
6. ~~Visual redesign to match Dave's ChatGPT mockup~~ - resolved three
   conflicts with him first (accent color -> Apple systemRed, headline
   typeface -> Inter heavy, journey stepper -> derived live), built a
   full-preview artifact, got his approval, then shipped: Today
   dashboard (pipeline snapshot, needs-follow-up, upcoming), bottom tab
   bar (Today/Athletes/Board/More, replacing the old top nav), restyled
   roster with avatars and status pills, `donor_fundraising` module
   gating (placeholder only - no fundraising data model exists). See
   docs/DECISIONS.md.

## Done from the redesign pass

7. ~~Athlete add/edit~~ - `src/app/org/[slug]/roster/new` and
   `.../[id]/edit`, staff/owner only, HS-vs-transfer conditional detail
   fields, international-athlete fields, server-side re-validation via
   `src/lib/validation/athlete.ts`.
8. ~~Target add/edit~~ - `src/app/org/[slug]/board/new` and
   `.../[id]/edit`. Deliberately does not let staff create new schools:
   `schools` is shared reference data, writable only via the service
   role by design (see the RLS comment in `migrations/0001_core_schema.sql`
   and docs/ARCHITECTURE.md) - an org with zero schools seeded sees an
   honest empty state instead of a workaround. Also guards against a
   cross-org `athlete_id` (RLS alone can't catch that one, since it only
   checks the target row's own `org_id`) by re-fetching the athlete
   scoped to the org before writing.
9. ~~Communication log per target~~ - `target_communications` (migration
   `0004`), logged from the target-edit page
   (`src/components/CommunicationForm.tsx`). Feeds
   `RecruitingSignals.commCount`/`visitCount` into `scoreFit()` on the
   board for real now (`src/lib/data/fitAdapters.ts`'s
   `communicationsToSignals`) - the board had been calling `scoreFit()`
   with no signals at all since it was built. Logging a communication
   also bumps the parent target's `updated_at`, which is what actually
   makes Today's "needs follow-up" staleness mean something day to day,
   not just react to someone opening the full edit form.
10. ~~A real `offer` signal~~ - `recruiting_targets.offer_type` and
    `.offer_scholarship_percent` (migration `0005`), set from the target
    add/edit form and fed into `RecruitingSignals.offer` on the board
    (`src/lib/data/fitAdapters.ts`'s `targetOfferToSignal`). This was the
    last of the three `RecruitingSignals` fields that had nothing real
    behind it - `commCount`/`visitCount` were fixed by item 9 above.
    Deliberately independent of `status = 'Offer'`, which is a pipeline
    stage, not an offer record.
11. ~~Athlete profile / detail screen~~ - `src/app/org/[slug]/roster/[id]`,
    with `JourneyStepper` finally wired to a real screen (it only ever
    needed `recruiting_targets.status`, no changes needed there). Two new
    tables (migration `0006`): `contacts` (athlete-scoped people - HS/travel
    coach, parent/guardian, advisor, college coach - distinct from
    `recruiting_targets.coach_name`'s single free-text field) and
    `target_visits` (a real visit log with type/impression/next-step,
    replacing `target_communications kind='visit'` as the source of
    `RecruitingSignals.visitCount` - see docs/DECISIONS.md). Roster rows
    now link to this detail page for everyone; staff/owner get an Edit
    link from there instead of the list linking straight to the edit form.
12. ~~A real way to get schools into the system~~ - `src/app/org/[slug]/schools/new`,
    owner-only, writes through the service-role client
    (`src/lib/supabase/admin.ts`'s previously-unused `createAdminClient`)
    since `schools` still has no INSERT policy for ordinary users -
    `requireOwner()` is the actual gate here, not RLS. Linked from the
    target-add form's empty state and header for owners. See docs/DECISIONS.md.
13. ~~Doc AI file ingest~~ - `src/lib/docai/magicBytes.ts` (pure,
    unit-tested) and `src/lib/docai/ingest.ts` (browser-dependent,
    verified with Playwright driving real headless Chromium -
    `scripts/docai_ingest_browsertest.mjs`, 18/18 assertions). Found and
    fixed a real double-rotation bug in the first pass's hand-rolled EXIF
    handling; the shipped version trusts the browser's native
    `createImageBitmap` orientation instead. See docs/DECISIONS.md. Not
    wired to any page yet - it's a library module the eventual upload UI
    will call.

14. ~~Doc AI upload, review queue and apply~~ - `documents` table
    (migration `0007`), `src/lib/actions/documents.ts`, and three screens
    under `/org/[slug]/documents`. Dave asked for both ways in, so triage
    names the document type by default (`detectCategory()`) and a type can
    be forced up front. A stub ModelCaller
    (`src/lib/docai/stubCaller.ts`) drives the real pipeline so the whole
    flow is usable before an API key exists, and every screen showing a
    stubbed result says so. Only the injected caller changes when a real
    key arrives.
## Done since

10. ~~NCAA eligibility, researched and then built~~ - the rules were
    verified against NCAA-published documents (cited in
    docs/BUSINESS_RULES.md) rather than recalled, which found that the
    app's GPA maths was wrong in five ways at once. Now: a real
    core-course GPA engine (`src/lib/fit/ncaa/`), qualifier / academic
    redshirt / nonqualifier status, the D1 10/7 rule, the age-based
    five-year clock adopted mid-2026, per-course storage
    (`migrations/0008_core_courses.sql`) and the eligibility screen at
    `/org/[slug]/roster/[id]/eligibility`. Ten laws in
    `src/laws/ncaaLaws.test.ts`.

## Known gaps, recorded rather than fixed (audit 2026-09-16)

These came out of an adversarial audit and are real. They are written
down because each needs a decision, not because they were missed.

- ~~**RLS carries no role check.**~~ Fixed 2026-09-16, migration `0010`.
  Every org-scoped table now has a read policy keyed off membership and
  insert/update/delete policies keyed off `_staff_org_ids()`. The
  benchmark_sets shared row, which the old policy made writable by any
  member of any org, is now writable by nobody through RLS.
  `scripts/rls_test.sql` gained a member-role pass and a staff-role
  pass, which is what it had been missing: every assertion in it used
  to run as an owner, so it could never have caught this. 55 assertions,
  up from 35.
- ~~**`discardDocument` does not undo an apply.**~~ Fixed 2026-09-16,
  migration `0011`. An apply now records what it changed on
  `documents.applied_changes`, and discarding an applied document
  removes its course rows, puts back the athlete's previous values and
  deletes a grading scale that only existed because of it. A field
  corrected by hand since the apply is deliberately left alone, and the
  screen says what was and was not undone. The Discard button now
  appears on applied documents at all, which it never did before.
- ~~**The weighted-grade bonus is unreachable in practice.**~~ Fixed
  2026-09-16. The grading-scale entry form asks both NCAA conditions and
  the school's real bonus amount, and the adapter passes it through.
- **Per-course school name.** Every course from one document gets that
  document's single school, because the extraction schema has no
  per-course school field. A transcript covering two schools therefore
  converts entirely against one school's table. The transfer-student
  design is in the storage and the adapter but cannot be expressed by
  the extractor yet.
- ~~**No server-side file validation.**~~ Fixed 2026-09-16.
  `src/lib/docai/acceptance.ts` re-checks size, format and the HEIC
  refusal from the bytes that actually arrived, before the document row
  is created. The size cap moved to `src/lib/docai/limits.ts` so both
  sides share one number instead of keeping two copies.

## Next up

1. **Check courses against each school's NCAA-approved list.** The
   engine reports an unchecked course as unchecked, which is honest but
   means most core GPAs read as estimates. The Eligibility Center
   publishes each high school's approved list at
   `web3.ncaa.org/hsportal`, keyed by CEEB code, and the transcripts
   already carry that code. Nothing is built for this yet.

2. ~~**Grading-scale entry.**~~ Done 2026-09-16. Resolved by splitting
   the shared verified table from a new org-scoped one
   (`migrations/0009`), so staff can enter a scale that affects only
   their org. Screens at `/org/[slug]/grading-scales`. A school with no
   table at all now converts on the ten-point default with the
   assumption labelled everywhere, rather than producing nothing. See
   docs/DECISIONS.md.

3. **Wire a real `ModelCaller`** (the last piece of Doc AI) against the Anthropic API: needs an API
   key (Dave doesn't have one to provide yet) and a persistent per-org
   budget table, since Bridge's localStorage-based daily budget tracking
   has no multi-tenant, server-side equivalent yet. On hold until a key
   exists.

## After that
- A real fundraising/donation data model for the `donor_fundraising`
  module - Today's "Program overview" section is currently a "coming
  soon" placeholder, not backed by any table.
- Board/governance module, gated behind `orgs.modules`, built only once
  the core product works for both Bridge and Elite Squad.
- Elite Squad onboarding as the second real org - this is the actual
  test of whether "generic from day one" held up, not just a design
  intention.
- Create a real GitHub repo (name TBD - "recruiting-platform" is a
  placeholder) with write access, once Dave wants to push.

## Longer-term, not yet scoped

- Standalone recruiting product for other organizations/coaches.
- Two-sided marketplace including college coach accounts.
- Deployment/hosting decision (Vercel, matching tucci-admin, is the
  likely default but hasn't been discussed).
