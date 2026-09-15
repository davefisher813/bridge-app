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
   solid token set stays complete.** The locked styling catalog
   (docs/STYLING_CATALOG.md) is built on solid saturated fills, which is
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
