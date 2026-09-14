# Business rules

## Org / module model

- Every org gets `recruiting` and `doc_ai` on by default; they are the
  core product.
- `board_governance` and `donor_fundraising` are off by default. Bridge
  turns both on. Elite Squad turns neither on.
- An org's role labels (what "owner" and "staff" are called for that
  org) are display-only config in `orgs.role_labels`. They never affect
  what a role can actually do - that's the fixed `org_role` enum plus
  `requireRole()` / `requireOwner()` in `src/lib/auth/guard.ts`.

## NCAA facts encoded in the fit engine

These were researched and, in one case, corrected after Dave caught an
overstated first draft ("Did you check the scholarship thing for all
divisions? I don't believe d3 can offer scholarships" - 2026-09).
Verify against current NCAA/conference sources before relying on any of
these in production; rules like this change by NCAA vote.

- **D3 categorically bans athletic scholarships.** This is universal
  and NCAA-administered - D3 athletes get only need-based/merit aid, no
  exceptions. It is unrelated to the House settlement below. Encoded in
  `src/lib/fit/financial.ts`'s D3 branch and enforced as a law in
  `src/laws/fitLaws.test.ts` ("D3 never shows a scholarship-availability
  claim"), because a wrong or dirty School record should never be able
  to leak a false scholarship claim for a D3 school.
- **The House v. NCAA settlement** (elimination of sport-specific
  scholarship caps, replaced by roster limits) applies **only to
  Division I**, and only to D1 schools that opt in. Encoded as
  `School.financials.rosterSpotsOpen`, checked only when `isD1()` is
  true (`src/lib/fit/benchmarks.ts`).
- **D2 keeps its own separate, still-capped scholarship rules**,
  untouched by the House settlement. D2 schools use the same
  scholarship-type + aid-vs-cost model as before; the roster-spots
  signal never applies to them.
- **Transfer types and their rules**, encoded in `src/lib/fit/transfer.ts`:
  - `transfer_4to4` (four-year to four-year): the one-time transfer
    exception grants immediate eligibility for a first transfer, entered
    within the sport's portal window, in academic good standing. A
    second transfer generally requires an NCAA waiver, not covered by
    the exception - `transferCount >= 2` produces a warning, not a veto
    (a waiver can still be granted; this isn't a hard NCAA-wide rule the
    same way the 2.5 GPA floor below is).
  - `transfer_juco` (two-year to four-year, the "4-2-4 rule"): 2.5
    cumulative college GPA minimum (hard veto below it), plus a
    full-time credit-hour completion requirement (24 semester / 36
    quarter hours per NCAA year - a warning, since partial data
    shouldn't hard-veto).
  - `transfer_grad`: requires a completed bachelor's degree (hard veto
    if not completed) and remaining NCAA eligibility (hard veto at
    zero). Uses shorter (~60 day), sport-specific grad transfer windows,
    separate from the undergrad primary window.
  - **Portal windows are NCAA-voted and change most years.** They are
    always data (`transfer_windows` table / `TransferWindow[]` passed
    into `scoreEligibility()`), never hardcoded. Without a matching
    window row, timing is reported as unverified - never assumed valid.
    Enforced as a law in `src/laws/fitLaws.test.ts`.

## Fit-scoring model

See docs/ARCHITECTURE.md for the full design rationale (the `veto`
field, the weighted blend, why this replaces Bridge's `calcCollegeFit`
patch stack). The score bands used to turn a 0-100 score into a
Conflict/Reach/Fit/Safety tag are centralized in `src/lib/fit/bands.ts`
- one scale, used everywhere, unlike Bridge which had four different
scales across its four `calc*FitTag` functions plus a fifth just for
sorting.
