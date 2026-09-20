# The laws, as tests

Pattern borrowed directly from jarvis-app's `src/laws/`. A rule that lives
only in CLAUDE.md or a docs file decays the moment someone (or an AI
session) is moving fast and hasn't reread it that day. A rule that fails
`npm test` cannot decay.

Currently enforced:

1. **No em dashes, anywhere in source.** Dave's rule across every repo
   (bffsa-site/CLAUDE.md, tucci-admin/CLAUDE.md): "No em dashes. Ever."
   `laws.test.ts`.
2. **D3 schools never show a scholarship-availability claim.** NCAA bans
   athletic scholarships at D3, full stop, regardless of what a School
   record's `financials.athleticScholarship` field happens to say. This
   was the exact fact Dave caught a wrong first draft on ("Did you check
   the scholarship thing for all divisions? I don't believe d3 can offer
   scholarships"), so it gets a standing test, not just a corrected
   comment. `fitLaws.test.ts`.
3. **A transfer's portal-window timing is never asserted without a real
   TransferWindow record.** Portal windows are NCAA-voted and change
   almost every year (see docs/BUSINESS_RULES.md). The eligibility
   dimension must report timing as unverified when no window row is
   supplied, never silently assume the athlete is inside the window.
   `fitLaws.test.ts`.
4. **A veto always overrides the blend.** The entire reason
   `DimensionResult.veto` exists instead of Bridge's tag-ordering is that
   a hard conflict (GPA below the floor, JUCO GPA below 2.5, no degree
   for a grad transfer, sport not sponsored) must never be averaged away
   by a strong score elsewhere. `fitLaws.test.ts`.
5. **A solid fill never appears without its paired foreground, and the
   solid token set stays complete.** The styling contract
   (docs/STYLING_CATALOG.md) keeps solid fills for the primary action, which is
   the easiest way in a dark UI to ship text nobody can read. White on
   the raw `--accent` is 3.4:1. Every fill therefore ships as a
   contrast-checked `--solid-X` / `--solid-X-on` pair, and the pair has
   to be written together. Also covers: no raw hex in components, the
   neutral fill's hairline, and the same pairing rule for the tint
   tokens, which must additionally be declared in BOTH themes since a
   tint is defined against the paper behind it. `stylingLaws.test.ts`.

## How to add a law

Write the check here in the same session the rule is agreed, not
"later". Then prove it bites: plant a deliberate violation, watch the
test fail, revert, and note in the test comment that this was actually
done (not just asserted). Laws 1 and 2 above were verified that way when
this file was written; if a law here doesn't say so in its comment, it
hasn't been proven yet and should be treated with proportionate
suspicion.

## What this cannot catch

These are static/behavioral unit checks against the fit engine and
source text. They cannot catch a wrong number in a real School or
Athlete record, a UI screen that never renders a warning it computed, or
a business rule nobody has told this file about yet.

## Added 2026-09-19

6. **Every foreign key is the leading column of an index.** Supabase's
   advisor found nineteen that were not, most of them `org_id`. The
   schema law reads every `references` and every index out of the
   migrations and compares. `schemaLaws.test.ts`, planted and reverted.
7. **A server action takes a storage path, never file bytes.** Next caps
   an action's body at 1MB; a document is 4MB. Files go through the
   `documents` bucket and the action reads them back. No exported action
   may accept an `IngestedRecord` or a `base64` field.
   `dataLaws.test.ts`, planted and reverted.

## Added 2026-09-20: the matching laws

`matchingLaws.test.ts`, every one a line in docs/MATCHING_CONTRACT.md
and every number read from `src/lib/fit/contract.ts`:

6. **The primary number under its floor is a conflict; anything else
   below target only lowers the score.** Proven to bite by removing the
   floor check and watching it fail.
7. **Staff grades blend in by position group** (a catcher's carry half)
   **and never replace a floor.**
8. **The scoring entry is the best verified number, else the most
   recent, and its source sets the confidence.**
9. **Offers, visits and messages are shown, never scored.** Proven to
   bite by putting the old offer floor back and watching it fail.
10. **An unknown dimension is left out of the blend, the rest are
    renormalized, and the result says so.**
11. **The blend is the org's preset shifted by the athlete's goal, and
    Money First leads by default.**
12. **Financial fit is net cost against the family budget, every aid line
    is a reason, D3 never counts athletic aid, and it never vetoes.**
13. **A school's tier is its Program Tier when set; positional need is a
    boost that never passes a veto.**
14. **One band everywhere: 80, 55, 35.**

