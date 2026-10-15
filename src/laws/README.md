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
    advisors are assigned by any Admin, from the athlete's page or the
    member's page (Stage 5 Phase 2, below); every governance and
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

## Added 2026-09-27: Stage 5 Phase 1, Matches

25. **Fits are ranked one way everywhere, and a partial row says so.**
    `rankFits` puts every fully scored fit above every partial one,
    each by score, A to Z then id on a tie; each other sort falls back
    to that rule; the six sort keys are fixed and an unknown one is
    Best Fit; the partial label reads N of M with M off the row (3 for
    a high school athlete, 4 for a transfer); no member screen or
    member data file names `athlete_school_fits` or `rankFits`.
    `matchingLaws.test.ts`. On the fixture the full 41 renders above
    the partial 48 on the profile, Matches, the family's Matches and
    the family's athlete page; the profile shows ten rows under "N
    Schools Evaluated" and See All past ten; Matches searches by name,
    offers the six sorts, shows 25 rows then Show More and `?show=50`
    shows the rest; Add Target sits inside the row and outside its
    link, a target's stage pill opens the Board; the family's Matches
    has search and sort and no target action; Today never headlines a
    partial Safety over a full one; a filter change keeps the search
    and the sort. `pageRender.test.ts`, the last describe block.

## Added 2026-09-27: Stage 5 Phases 2 and 3, the advisor and More

Dave approved the Stage 5 plan whole (docs/PLAN_STAGE5.md), so its
recommendations are the decisions. Every law below was planted, seen
to fail, and reverted by copy; each file's header names the plants.

26. **Who may advise is decided in one place, the database stamps when,
    and the athlete page is where it is managed.** `ADVISOR_ROLES`,
    `canAdvise` and `isEligibleAdvisor` live in `src/lib/org/advisors.ts`
    and the rule is spelled nowhere else in the actions, the org module
    or the roster and member screens; migration 0043's trigger stamps
    `athletes.advisor_assigned_at` on a new advisor and no action, page
    or loader ever writes it; the form action assigns, clears on empty,
    and refuses a Viewer, an Athlete login, another org's Admin and
    another org's athlete; `updateAthlete` ignores an advisorId and Edit
    has no picker while Add keeps one; the sheet lists Admins most
    recently used first, never assigned last, ties A to Z, marks the
    current one and offers Clear and Add Admin; Add Admin writes the
    membership first, then the advisor, none when the invite fails, and
    assigns someone already an Admin instead of inviting them twice;
    the Advisor section is first on the profile with Change or Assign;
    the member page offers Assign Athlete to an Admin only.
    `advisorLaws.test.ts`.
27. **More is six sections in the plan's order, every row where the
    plan puts it and every href a registered page; Advisors counts the
    athletes still being recruited.** People, Program, Reference,
    Matching, Foundation, Organization; Foundation is left out entirely
    when neither module is on; Members and Organization Settings stay
    the owner's while a leftover staff row keeps every other row; a
    Viewer and an Athlete login open neither More nor Advisors; each
    Admin's count follows the reminder rule (Active and Transferring,
    not deleted) and the lede says how many have nobody.
    `moreLaws.test.ts`.
28. **The render side of both.** Advisor is the first section on every
    staff profile, above the stage line or the placement row; Change
    with an advisor, Assign without, no picker on Edit; no family or
    member screen carries a trigger, Clear, Add Admin, the pinned invite
    or the sheet's field, and neither login reaches the profile or Add
    Admin; More renders its groups for an Admin with something in each
    and drops Foundation for the org without modules; Advisors counts
    two for the fixture owner, drops an Inactive athlete, and an
    assignment lowers the count of athletes with nobody.
    `pageRender.test.ts`, the last describe block.

## Added 2026-09-27: Stage 5 Phase 6, the activity log

Dave approved the Stage 5 plan whole (docs/PLAN_STAGE5.md). Every law
below was planted, seen to fail, and reverted; each file's header names
the plants.

29. **A summary is built from a template, and no caller hands the log a
    note, a body or a reading.** Every `logActivity` call in `src` passes
    names, statuses, kinds and dates only; only `activity.ts` makes an
    `ActivitySummary`; the templates take no property that could carry
    free text; the action harness fed the fixture bodies records none of
    them, for a check-in, a staff message, a family message and a note;
    the fixture's own rows carry none. `activityLaws.test.ts`.
30. **The log is append only and Admins only.** No family or member page
    or loader names `activity_log` or its helpers; nothing in `src`
    updates, upserts or deletes a row; migration 0044 has a select and an
    insert policy and no other, the honesty and coherence triggers, and no
    function that lets a parameter reach `summary`, nothing granted to
    anon; the RLS suite applies it and holds the log to its cases.
    `activityLaws.test.ts`, `scripts/rls_test.sql`.
31. **Every action writes one row on success, none on refusal, and never
    fails for the log.** Athlete, target, document, check-in, message
    (staff and family), member and guardian actions each write exactly
    one row (two for a status change made on an edit); a refused caller
    writes none; a log write that errors does not fail the business
    write; a person removing or demoting themselves is logged through the
    admin client. `actionRun.test.ts`.
32. **The screens: five on the profile, everything on the org screen and
    the athlete's log, Admin only.** The profile shows the newest five
    with See All only past five and an empty state for none; the org
    screen lists only its own org's entries newest first, searches the
    summary and the person and reaches the empty state, stops at 50 with
    Show More asking for 50 more; a Viewer, an Athlete login and a
    signed-out visitor are refused, and no Viewer or Athlete screen
    carries an entry or a link to one; no summary on screen carries a
    note, a message, a check-in or a reading, and search cannot reach
    them; an entry links only to a screen that exists, and a removed
    athlete's entries link nowhere. `pageRender.test.ts`, the last
    describe block, `moreLaws.test.ts` for the More row.

## Added 2026-09-27: Stage 5 Phase 4, assignments

Dave approved the Stage 5 plan whole (docs/PLAN_STAGE5.md). Every law
below was planted, seen to fail, and reverted; each file's header names
the plants.

33. **Overdue is computed, never stored, and there is no in-progress
    status.** `computeOverdue` and `computeDueSoon` are pure over a due
    date, a status and a day; no column, insert field or stored flag
    says overdue; the status enum is exactly assigned, submitted,
    needs_revision, complete, cancelled. `assignmentLaws.test.ts`,
    `schemaLaws.test.ts`.
34. **The Viewer reads nothing about assignments, and the Athlete login
    writes one thing.** No Viewer page or loader names the table; the
    only family write is `submit_assignment` (no `.from("assignments")`
    write in any family path, and the fake's copy of the function refuses
    an Admin, another athlete's login and a row that is not open, as the
    SQL does). `assignmentLaws.test.ts`, `scripts/rls_test.sql`.
35. **A family file lands only under `<org>/family/<request>/<file>`, is
    filed and never read.** The path pattern, the `[2] = 'family'`
    storage check, the owner check and the size and type limits are in
    the function and the policy; a submission makes no Doc AI call and
    sends no email; a family note and a reviewer comment never reach an
    activity line. `assignmentLaws.test.ts`, `scripts/rls_test.sql`.
36. **A filed document never renders in Needs Review or with an Apply
    button.** The documents list shows the family file under its own
    Family Upload heading and the document screen offers no Apply.
    `assignmentLaws.test.ts`.
37. **Migrations 0045 and 0046 are structure only**: 0045 is one
    statement in its own file, neither carries data, both are in the
    RLS runner in order, and every planted case (Admin, a leftover staff
    row, the Athlete login for its own and another athlete, the Viewer,
    a second org, anon) fails when its policy or check is dropped.
    `assignmentLaws.test.ts`, `migrationLaws.test.ts`,
    `scripts/rls_test.sql`.
38. **The screens: Admin only, computed on every draw, one button per
    row for the Athlete login.** The profile puts Assignments right after
    Advisor with the three most urgent rows; the athlete's list groups
    Open, Submitted and Done; review controls show on a submitted row
    only and Cancel never on a finished one; the org list opens with
    Submitted for Review; Today shows Submitted for Review and Overdue
    after Needs Follow-Up only when each has a row; My Athletes counts
    open, overdue and to review; an Overdue chip follows a moved date
    and a changed status. `pageRender.test.ts`, the last describe block,
    `moreLaws.test.ts` for the More row.
39. **What the Athlete login sees of it.** Your Assignments sits above
    Your Advisor, one link button per open row and none on a sent or
    finished one, cancelled rows hidden, no form anywhere on the
    athlete's page, no reviewer comment, family note or other athlete's
    or org's work; the answer screen shows the reviewer's comment only
    on a row sent back and offers its one form only on an open row; a
    cancelled row, another org's row and an unlinked athlete are Not
    Found; every link stays under `/family/`; an Admin and a Viewer are
    sent away. `pageRender.test.ts`, the last describe block.
40. **A Viewer opens none of it.** Every assignment screen, the org
    list, Today, My Athletes and More send a Viewer away, and no Viewer
    screen names an assignment, links to one or has a Submit button; a
    signed-out visitor is sent to sign in. `pageRender.test.ts`, the
    last describe block.

## Added 2026-09-30: Stage 5 Phase 5, View As

Dave approved the Stage 5 plan whole (docs/PLAN_STAGE5.md), so the
plan's option D2 is the design: the caller's own token, an effective
identity in the database, no token for anyone else. Every law below was
planted, seen to fail, and reverted; each file's header names the plants.

41. **Every write is refused while viewing, in the database.** Every
    INSERT, UPDATE and DELETE policy in `public` and `storage.objects`
    carries `and not private._viewing()`, found by a catalog loop in 0047
    and asked of the catalog again by the suite; every policy written
    after 0047 must name it in its own text; the definer functions that
    write as the caller (`create_org`, `log_family_message`,
    `submit_assignment`) refuse. The write loop attempts an insert, an
    update and a delete on every table and demands each is refused, and
    shows the same attempt lands as the target Admin not viewing. Plants:
    one policy left ungated; the gate present in text but defeated with
    `or true` on an insert, a delete and a storage policy (the write loop
    alone catches it). `scripts/rls_test.sql`, `viewAsLaws.test.ts`.
42. **What the Admin reads while viewing is what the target reads.** A
    loop generated from `pg_class` hashes every table and
    `storage.objects`, and the three member functions, both ways for an
    Admin, a Viewer and an Athlete target; `view_as_sessions` is the one
    named exemption. Plants: a helper left on `auth.uid()`, one spelled
    `auth . uid ()` to slip past the text check, the org scope dropped
    from two helpers, the read policy widened. `scripts/rls_test.sql`.
43. **Only an Admin starts it, only inside the org, never as someone
    outside it, never as a higher grant.** A Viewer, an Athlete login, a
    leftover staff row, an outsider, someone signed out, self and a person
    outside the org are refused, and a second live session is refused;
    the function and the table's trigger each hold alone and both dropped
    fails. Plants: the owner check dropped, both owner locks dropped, the
    target check dropped from each and from both, the clock clause
    dropped. `scripts/rls_test.sql`, `viewAsLaws.test.ts`.
44. **Every server action refuses while viewing, and nothing mints.**
    `requireNotViewing()` is the first statement of every exported action
    (checked with the TypeScript parser; the exceptions are named), every
    action run while viewing writes nothing and returns the refusal, the
    service-role fake has no `viewing` so only the guard stands in its
    way, and no file mints or forges a credential or reads with the
    service role for another person. Plants: the guard removed from two
    actions, moved below a lookup, a new action file without it,
    `createAdminClient` in `viewAs.ts`, `generateLink` in a scratch file.
    `viewAsLaws.test.ts`.
45. **The screens that start it are the Admin's alone, and the banner is
    on every screen while viewing and on none otherwise.** Both View As
    screens refuse a Viewer, an Athlete login, someone signed out, a
    person outside the org, a leftover staff row and an Admin who is
    viewing as a Viewer or an Athlete; an Admin viewing as another Admin
    is told to Return first. Every org screen, rendered through the org
    layout, carries "Viewing as <name>", Read only and Return to Admin
    while viewing, and none does otherwise; the markup under the banner
    equals what the target's own render produces, screen for screen (an
    Athlete login's, a Viewer's, and the Admin's for every screen an
    Admin can open); while viewing an Athlete login or a Viewer no link
    leaves their screens and no View As door is on them. Plants: the
    banner removed from Chrome, shown always, the guard reading the real
    id, a staff-wide check on the start screen, a link out of the family
    home. `pageRender.test.ts`, `viewAsLaws.test.ts`.
46. **The live driver's route list is the page list.** `routes.mjs`
    reads `src/testing/pages.ts` with one pattern, so the count, the
    login and the person viewed of every entry are compared with
    `PAGES`; a key written out of order drops a screen from the live
    checks and fails here. Plant: two keys swapped in one entry.
    `pageRender.test.ts`.

What these cannot catch: the fake client and the fixture are second
implementations of the database, so the render laws prove the page code
and the RLS suite proves the scope; the suite runs against a stubbed
`auth` schema, so the real Supabase JWT path is unexercised; and
`signout()` does not end an open session (bounded by the 30 minutes).
