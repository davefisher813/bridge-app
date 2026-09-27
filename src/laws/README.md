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
   an action's body at 1MB; a document can be 10MB. Files go through the
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

## Added 2026-09-26: the athlete lifecycle (Stage 1)

15. **A placed or Inactive athlete has no score anywhere.** Committed,
    Enrolled, Graduated and Drafted end recruiting; Inactive pauses it.
    The close-out and a board commit delete the athlete's stored fits,
    Recalculate All deletes any it finds on one and never scores one,
    and the board, target and school screens show the status where the
    number sat. `actionRun.test.ts` (the enrolling block) and
    `pageRender.test.ts`; proven to bite by removing the status filter
    in `src/lib/data/fits.ts` and by putting the closed target back on
    the profile, planted and reverted.
16. **Reopening restores exactly what the close-out closed.** The
    close-out writes `closed_from`; Reopen Recruiting puts every target
    with one back to that status, closes the commitment for a transfer
    or turns it back into the offer it was for a withdrawn commitment,
    leaves a hand-picked Not Interested closed, refuses Drafted, and
    scores the athlete again. The Edit form cannot bring a placed
    athlete back by hand. `actionRun.test.ts`; proven to bite by
    dropping the `closed_from` write in `enrollment.ts` and the
    `closed_from` filter in `reopen.ts`, planted and reverted.
17. **Today counts every status, and each tile opens the roster it
    counts.** One tile per status in vocabulary order, counted by
    `effectiveStatus` the same way the roster filters, so the number on
    the tile and the narrowed list can never disagree. Recruiting
    History keeps every school with its own messages and visits, and
    the profile shows only what is live. `pageRender.test.ts`.


## Added 2026-09-27: Stage 4 (autofill, notes, the high school directory) and the audit fixes

Every law below was planted, seen to fail, and reverted in the session
it was written; each file's comments name the plant.

18. **Autofill goes through the kit, fills only what is blank, and the
    directory comes from public files only.** No raw `<datalist>`
    outside the kit; `SuggestField` wires its list; no note column on
    `athletes`; no family or member file names `athlete_notes`; the
    NCES loader and parser never touch org data; every athlete detail
    key survives an edit; name matching is `lower(btrim())` with
    wildcards escaped. `autofillLaws.test.ts`.
19. **A migration from 0040 on carries no data.** No org slug, no uuid
    literal, no insert into orgs, members, athletes, schools, coaches,
    windows, high schools, benchmarks, donors or users.
    `migrationLaws.test.ts`.
20. **An athlete record can be corrected, noted and removed, and only
    inside its own org.** Duplicate names are caught on this roster
    only; a picked school fills Home State or Current Division only when
    blank and never trusts an id from the browser; notes are filed with
    their step; Edit cannot move an athlete to Enrolled or Graduated;
    Remove Athlete is a scoped soft delete; contacts, metrics, check-ins,
    messages and family links are edited and removed by id, org and
    athlete together. `athleteAutofillLaws.test.ts`,
    `athleteCrudLaws.test.ts`.
21. **Targets, the contact log, visits, schools, coaches, grading
    scales, approved lists and transfer windows can each be edited and
    removed, scoped the same way.** A school is refused removal while
    anything points at it and is merged instead; the coach directory is
    the owner's; a typed coach email always wins over the directory.
    `referenceCrudLaws.test.ts`, `referenceAutofillLaws.test.ts`.
22. **Nothing the stand-in reader read is ever applied.** A document
    records who read it; 'stub' is refused forever, no key refuses
    everything, and an older document with no reader on record is
    refused unless the usage log shows a real model call. Transcript
    rows and a pending reading can be corrected; only a discarded or
    failed document can be deleted for good, files first.
    `documentLaws.test.ts`.
23. **The org, its people, its board and its money can all be edited in
    place.** Settings are the owner's; a new org comes from
    `create_org`; role changes to and from family carry their links;
    advisors are assigned from the member page; every governance and
    fundraising record has an update and a remove behind a confirm; a
    donor removal is a soft delete; a pledge's Fulfilled comes from its
    payments. `orgCrudLaws.test.ts`.
24. **The screens show it to the right people.** Staff see Remove on an
    athlete, a target, a message, a course and a finished document, each
    behind a ConfirmButton; the owner alone sees Merge, Remove School,
    the coach list and Organization Settings; each edit screen opens on
    its record; no family or member screen shows a note, a coach
    control or a Remove; both are turned away from every staff edit
    screen; a removed athlete leaves the board, Today and the school
    page. `pageRender.test.ts`, the last describe block.
