# Plan: Stage 5

Written 2026-09-27 on branch `claude/stage5-plan` from main `62636db`.
Stage 1 of Dave's spec: plan, then stop. No code is written until Tony
signs off below.

## Baseline And Preconditions

| Fact | Where | Consequence |
|---|---|---|
| `origin/main` is `62636db` (Family becomes Athlete wherever a person reads it), same as local main. Main moved past the `8e1a9ea` deploy the spec names by three commits: `ca02966` (CURRENT_STATE rewrite), `401e86d` (QA report), `62636db` (the rename). | `git fetch`, `git log origin/main` | Nothing to stop for. Every citation below is at `62636db` unless it says otherwise. |
| Branch `claude/roles-admin-viewer-titles` (`82d8006`, gate green, preview READY, not merged) retires staff into one Admin level (owner), labels member as Viewer and family as Athlete, and adds `org_members.title`. It carries migration `0041_access_levels_and_titles.sql` and edits 75 files including `more/page.tsx`, `roster/[id]/page.tsx`, `members/*`, `guard.ts`, `membership.ts`, `members.ts`, `pages.ts`, `pageRender.test.ts`, `rls_test.sql`, `run_rls_test.sh`. | `git diff --stat main...claude/roles-admin-viewer-titles` | Every Stage 5 branch is cut after that merge. In this plan "staff" in Dave's spec means Admin (owner). Wherever the spec's staff/owner split needs a call it is listed under Decisions For Tony. Migration numbers start at 0042. |
| `origin/claude/open-rows` touches only `qa/check.js`. `origin/claude/downloads-directory-4mf6gv` is already in main. | `git diff --stat main...` | No overlap with these areas. |
| `org_role` stays `owner, staff, member, family` in the database. After 0041 staff rows are owner and nothing offers staff. `STAFF_ROLES` in `src/lib/auth/guard.ts:16` stays `["owner","staff"]` so a leftover row works. `private._member_org_ids()` is owner and staff only (`migrations/0031:29-32`); `private._family_athlete_ids()` is the athlete login's linked athletes (`0023:91-94`). | Access levels facts, `guard.ts` | "Admin" below means `STAFF_ROLES`. "Athlete login" means role `family`. "Viewer" means role `member` (Bridge calls it Board). |
| Doc AI is out of scope. `ANTHROPIC_API_KEY` is never set in any Stage 5 session. | Task brief | Phase 4 uploads make no Doc AI call; Phase 3 moves the spending row only. |

Recommended build and merge order: **1, 2, 3, 6, 4, 5.** Phase 6 lands
before 4 and 5 because both write its log from inside their RPCs, and
Phase 3 lands before 4 to 6 so each of those adds its own More row to a
regrouped page. Details in Branch And Delivery Plan.

---

## Phase 0: Fix The Status Doc

**Goal.** `docs/CURRENT_STATE.md` tells the truth about what is deployed.
Already done in `ca02966`; this phase is verify only.

**What exists today.** `docs/CURRENT_STATE.md:3-5` says Stages 3 and 4
are deployed with migrations applied through 0040; `:31-36` names the
Supabase project, 40 migrations applied 2026-09-27. Test count 1,774 in
67 files, 24 law files, 210 PASS lines (`:39-40`).

**What changes.** Nothing in this stage. At Stage 3 the file is replaced
again and must then say: 41 migrations (0041 roles) plus whatever Stage 5
merged, the roles vocabulary (Admin, Viewer, Athlete), the `62636db`
rename, and the new commit and deploy ids. No migrations, RLS, actions,
screens or laws.

**Open question for Tony.** None.

---

## Phase 1: Matches

**Goal.** One ranking rule everywhere fits are listed: full scores first,
then partial, each by score. The Matches screen gets search, sort, a
compact row with the target action inside it, and 25 rows before Show More.

### What Exists Today

- Stored fit row `athlete_school_fits` with `score`, `tag`, `partial`,
  `dimensions jsonb {academic, athletic, financial, eligibility?, counted}`
  (`migrations/0021_matching_and_metrics.sql:119-138`, `src/lib/data/fits.ts:76-114`).
  `partial = counted.length < dims.length`, 3 dims for HS, 4 for a transfer
  (`src/lib/fit/score.ts:107-115`). No numeric net cost stored; it is reason
  text only.
- Ranking is database order `score desc` in every place, nothing demotes partial:
  profile `fits.slice(0, 5)` (`roster/[id]/page.tsx:157`, See All at `:330`),
  staff Matches (`roster/[id]/matches/page.tsx:134-135`), family Matches
  (`family/[id]/matches/page.tsx:63-65`), family athlete page (`family/[id]/page.tsx:126`),
  Today Strong Matches (`org/[slug]/page.tsx:100-105, 219-226`, a partial
  Safety can headline), school page (`schools/[id]/page.tsx:88`).
- Partial wording: `f.warnings[0] ?? "Partial score"` in four row metas plus a
  "Some Scores Are Partial" Notice (report finding 3).
- `MatchFilters` rebuilds URLSearchParams from its own values only and would
  drop `q`, `sort`, `show` (`src/components/MatchFilters.tsx:47-53`);
  `SchoolFilters` and `SearchField` preserve other params (`SchoolFilters.tsx:21-27`,
  `SearchField.tsx:20-27`). Division options come from data, sorted
  alphabetically (`matches/page.tsx:137-139`); NCAA order exists in
  `SCHOOL_DIVISIONS` (`src/lib/validation/school.ts:5`), so JUCO and NAIA
  appear whenever a school carries them.
- "Make a Target" is a second line under each row (`matches/page.tsx:179-183`);
  an existing target shows `StatusPill` plus "Open on Board" (`:174-177`).
  `addMatchToBoard` inserts a Target and redirects to the board
  (`src/lib/actions/matching.ts:16-38`). Kit `Row` wraps the whole body
  including `trailing` in one `<Link>` when `href` is set
  (`src/components/kit/index.tsx:247-253`); the live driver fails a tap
  target inside another (`scripts/live/clickable.mjs:57-60`).
- Location: schools have `state` and `location` "City, ST"
  (`migrations/0037:8`); athletes have `home_state` only (`0021:63`). No
  coordinates anywhere.
- Fake client: one `.order()`, no `.range()` (`src/testing/fakeSupabase.ts:229-233`);
  every existing search filters in memory.
- Viewer screens read only the member RPCs and `schools`; no member file
  reads `athlete_school_fits` (`src/lib/data/member.ts:61,86,143`).

### Distance Decision

Left out. The only location data is state granularity on both sides
(`0037:8`, `0021:63`); no lat/lng, zip or city exists on athletes. The
spec's condition "both school location and athlete home location exist"
is met only as a state match, which the Region and State filters already
give. Record in MATCHING_CONTRACT as deferred until schools carry
coordinates. The Stage 3 report will say so.

### Migrations

`0042_fit_net_cost.sql`: `alter table athlete_school_fits add column if not exists net_cost integer;`
plus `comment on column`. Written by `fitToRow` from a new exported pure
estimate in `src/lib/fit/financial.ts` (today `costFor` and the aid math
are private, `financial.ts:25-60`). `FIT_ENGINE_VERSION` bumped (`fits.ts:31`)
so every row recomputes; Recalculate All exists (`matching.ts:65`). No new
table, so no coherence trigger and nothing a Viewer could read that it
cannot read today. Structure only, passes `migrationLaws`.

Alternative (not recommended): compute net cost on view. Contract hard
rule "A screen reads rows; it never scores" argues for storing it.

### RLS Policies

None change. `athlete_school_fits` read policy is Admin org or family
athlete (`0023:150-160`); the new column rides it. Viewer reads no fit row
today and none after. Add to `scripts/rls_test.sql`: a member session
`select count(*) from athlete_school_fits` = 0 (pins the "reads nothing"
claim), and a family session cannot update `net_cost` on its own athlete's
row (0 rows). Both planted by temporarily widening the read policy to
`_any_org_ids()` and watching them fail.

### Actions

| File | Function | Refuses |
|---|---|---|
| `src/lib/fit/rank.ts` (new, walled off, benchable) | `rankFits(rows, sort)` with `sort` in `best, academic, athletic, financial, net_cost, az`; `partialLabel(counted, total)` returns "Partial · N of M scored" | Pure; no refusal. Best Fit: full before partial, score desc, name A to Z tiebreak so fake and Postgres agree. Net Cost: null last. |
| `src/lib/data/fits.ts` | `loadFitsForAthlete` returns unsorted; every caller goes through `rankFits` | A screen cannot bypass the helper. |
| `src/lib/actions/matching.ts` | `addMatchToBoard` unchanged | Same guard as today (`requireRole STAFF_ROLES`). |

### Screens

| Screen | File | Change |
|---|---|---|
| Athlete profile | `roster/[id]/page.tsx:320-366` | Top 10 through `rankFits`, Section label "Matches", count and lede "N schools evaluated" where N is stored rows after the sport-sponsored filter (align with `matches/page.tsx:119`), See All when > 10. Partial rows show `partialLabel` as the meta lead fact. |
| Staff Matches | `roster/[id]/matches/page.tsx` | `SearchField` over school name (`q`, in memory). Sort `SelectField` writing `sort=` with Best Fit, Academic, Athletic, Financial, Net Cost, A to Z. `MatchFilters` switched to the `useSearchParams` pattern so `q`, `sort`, `show` survive. Division options ordered by `SCHOOL_DIVISIONS` index. Compact `Row`: title school, meta "division · score · tag" or the partial label, `trailingAction` = `Form` + `Button` "Add Target" (or the target's `StatusPill` wrapped in a `TextLink` to `/board/[targetId]`). 25 rows then `TextLink` "Show More" (`show=50`, in memory). Conflicts section and Notice stay. |
| Kit | `src/components/kit/index.tsx:196-255` | `Row` gains `trailingAction?: ReactNode` rendered as a sibling of the `Link`, never inside it, so the live driver's nested-tap rule holds. kitLaws "a row and an option let their trailing wrap" (`kitLaws.test.ts:153`) must still pass. Catalog addendum. |
| Family Matches | `family/[id]/matches/page.tsx` | Same helper and label; add the same search and sort (no filters exist there); no target action; hrefs stay under `/family/`. |
| Family athlete page | `family/[id]/page.tsx:126, 205-240` | Top 10 through `rankFits`, same label. |
| Today | `org/[slug]/page.tsx:214-226` | Rows run through `rankFits` per athlete so a full Fit beats a partial Safety as the headline; 7-day "new" rule unchanged. |
| School page | `schools/[id]/page.tsx:88` | Targets sorted through the helper for consistency. |

Every role at 320/375/390: Admin sees the full Matches screen; Athlete
login sees family Matches with search and sort; Viewer never reaches
either (`pageRender.test.ts:776-789` loops). The compact row must not
sideways-scroll at 320 with a trailing button; `Row` already stacks
trailing below 300px (task 29), verify the action stacks the same way.

### Tests And Laws

| Law | Plant that proves it |
|---|---|
| `matchingLaws.test.ts` new describe: a fully scored fit ranks above any partial one, and score orders within each, for every sort key that is Best Fit | Remove the partial split in `rankFits`; fails. |
| `matchingLaws.test.ts`: `partialLabel` says N of 3 for an HS athlete and N of 4 for a transfer | Hardcode 4; fails on the HS fixture. |
| `pageRender.test.ts`: on the fixture the partial row sits below the last full row on profile, Matches, family Matches and Today | Needs a second full fit for `athleteNoGpa` in `fixture.ts:806+`; plant by reversing the sort. |
| `pageRender.test.ts`: profile shows 10 rows and "schools evaluated"; Matches renders 25 then Show More; `?show=50` renders more | Set the cap to 5; fails. |
| `pageRender.test.ts`: changing a filter keeps `q` and `sort` (assert the filter form carries them as hidden fields or the client preserves params) | Revert `MatchFilters`; fails. |
| Guard law: no file under `src/app/org/[slug]/member/` or `src/lib/data/member*.ts` names `athlete_school_fits` or `rankFits` | Add the string to `member.ts`; fails. |
| `src/lib/fit/rank.test.ts` unit tests plus bench cases in `scripts/testbench_entry.ts` | Direct assertions. |
| `src/testing/pages.ts`: new entries `matches-search`, `matches-sort-academic`, `matches-show-more`, `family-matches-sorted` | Render law covers them. |

### Existing Laws And Contract Lines This Phase Changes

| Where | Today | Becomes |
|---|---|---|
| `docs/MATCHING_CONTRACT.md` section 2 "Where it lives" | top five, See All | top ten, "N schools evaluated", See All |
| Section 2 "A match row" | School, division, score, tag; first reason on the second line | Compact: partial rows show "Partial · N of M scored" as the lead fact; the action sits in the row |
| Section 2 "Missing numbers" | the sentence "scored on academic and financial only" | plain label in the row; the engine sentence stays in the detail and in `warnings` |
| Section 2 "Filters" | seven filters | plus search by name and the six sorts; Distance deferred, reason above |
| Section 2 "Order" | Score, high to low | Fully scored first, then partial, each by score; Today's headline follows the same rule |
| Section 2 "To the board" | Add to Board on every row; the row then shows the stage | "Add Target" inside the row; the stage pill opens the target on the Board |
| New subsection "Amended 2026-09-27: ranking, search and sort", Dave approved Sep 27 2026 | | |
| `src/testing/pages.ts:132` expects `/Scored on financial only/` | | expects `/Partial · 1 of 3 scored/` |
| `src/laws/matchingLaws.test.ts:120-137` | asserts `warnings[0]` | unchanged, engine still emits it |
| `docs/STYLING_CATALOG.md` Row contract | trailing is a display slot | adds `trailingAction`, a tap target outside the row link |
| `docs/DECISIONS.md` | | entry "2026-09-27: partial scores rank below full ones everywhere", Dave approved Sep 27 2026 |
| `docs/CURRENT_STATE.md:99-103` Matches bullet | | rewritten at Stage 3 |
| `src/laws/README.md` | | item 25 |

### Risks

- `FIT_ENGINE_VERSION` bump means a full recompute at deploy; 122 schools
  times the roster is trivial (`fits.ts:7-9`), Recalculate All covers it.
- `MatchFilters` param bug silently resets search and sort unless fixed in
  the same pass.
- "Add Target" versus the spec's "+ Target": `titleCase("+ Target")` must
  return unchanged or copyLaws fails on the button text (`copyLaws.test.ts:37`).
- Roles branch touches `roster/[id]/page.tsx`; rebase on it.

### Open Questions For Tony

1. Partial label denominator: "N of M" with M from the row (3 or 4), recommended, versus the spec's literal "N of 4".
2. Button text: "Add Target" (recommended, Title Case safe) versus "+ Target".
3. Net cost stored (recommended) versus computed on view.
4. Family Matches gets search and sort too (recommended, same helper, no filters today) versus ranking and label only.

---

## Phase 2: Advisor, Managed Where You See It

**Goal.** The Advisor section moves to the top of the athlete profile with
Assign or Change in a sheet. One function decides who may advise.

### What Exists Today

- `athletes.advisor_id` with trigger `private.advisor_is_staff()` refusing
  anyone not owner or staff of the org (`0039:36-64`). Comment: display
  and reminders only, never permissions.
- The eligible-advisor rule is duplicated in six places: the trigger
  (`0039:52-55`), `assertAdvisorInOrg` (`src/lib/actions/athletes.ts:43-47`),
  `setAthleteAdvisor` (`src/lib/actions/members.ts:435`), `loadStaff`
  (`src/lib/data/staff.ts:34`), the member page query and `canAdvise`
  (`members/[userId]/page.tsx:73, 106`), `STAFF_ROLES` (`guard.ts:16`).
- `setAthleteAdvisor(slug, athleteIds, advisorId|null)` (`members.ts:420-455`)
  guards `requireRole(STAFF_ROLES)`, checks advisor and athletes, does not
  bump `updated_at`. Wrappers `assignAdvisorForm` `:457`, `unassignAdvisorForm` `:464`.
  `createAthlete`/`updateAthlete` also write `advisor_id` (`athletes.ts:127, 276`).
- Profile: Advisor section sits after Targets (`roster/[id]/page.tsx:391-423`),
  with `mailto:` row or `EmptyState "No Advisor Yet"` plus "Pick One" to `/edit`,
  then Messages and Check-Ins rows. Member page has "Athletes They Advise"
  with a tick list and "Assign Ticked Athletes" (`members/[userId]/page.tsx:236-272`).
- Invite: `inviteMember` (`members.ts:44-158`), non-family role requires
  `user.role === "owner"` (`:54`), honours `returnTo` under `/org/${slug}/` (`:61-67`),
  `InviteForm` has a `pinned` variant with `Hidden` fields (used at
  `roster/[id]/family/new/page.tsx:37`). Needs `SUPABASE_SERVICE_ROLE_KEY` (`:82`).
- The only sheet is `ConfirmButton` (`src/components/kit/ConfirmButton.tsx`);
  `fixed` is allowed only under `kit/` (`kitLaws.test.ts:128-135`).
- No "most recently used" data exists; `athletes.updated_at` moves on any
  edit and is not bumped by assignment (report finding 7).
- Viewer reads no `athletes` row (`0023:147-148` on `_member_org_ids()`).

### Migrations

`0043_advisor_assigned_at.sql`: `alter table athletes add column if not exists advisor_assigned_at timestamptz;`
and extend `private.advisor_is_staff()` so `new.advisor_assigned_at := now()`
when `new.advisor_id is distinct from old.advisor_id and new.advisor_id is not null`
(the trigger already fires `before insert or update of advisor_id, org_id`).
Optional index `(org_id, advisor_id, advisor_assigned_at desc)`. No
backfill: `update athletes` on a DATA_TABLE fails `migrationLaws.test.ts:88-118`;
nulls sort last. No new table, so Viewer reads nothing new by construction.

Alternative: per-user `advisor_picks` table for per-Admin recency. Not
recommended; org-wide recency is enough and it avoids a new table.

### RLS Policies

None change; the `athletes` update policy governs `advisor_id` and the new
column rides it. Add to `scripts/rls_test.sql` after `:1790`: Admin assigns
and the stamp moves; an unrelated edit leaves it; a family session updating
`advisor_id` on its athlete changes 0 rows (already asserted in the "writes
nothing" block `:1545-1568`, extend the notice); member session still reads
0 athletes rows; a second org's Admin cannot assign an advisor to the first
org's athlete (trigger raises, and RLS scopes to 0 rows anyway). Plant:
comment out the stamp line in the trigger; the stamp assertion fails.

### Actions

| File | Function | Refuses |
|---|---|---|
| `src/lib/org/advisors.ts` (new) | `ADVISOR_ROLES`, `canAdvise(role)`, `isEligibleAdvisor(client, orgId, userId)` | The single app copy of the rule; the trigger is the single database copy. Replaces the five copies in `athletes.ts:45`, `members.ts:435`, `staff.ts:34`, `members/[userId]:73, 106`. |
| `src/lib/actions/members.ts` | `setAdvisorFromAthleteForm(slug, athleteId, formData)` calling `setAthleteAdvisor`; redirect to the profile with a notice | Same guard as editing the athlete (`requireRole STAFF_ROLES`), a non-eligible advisor, an athlete of another org, empty value clears |
| `src/lib/data/staff.ts` | `loadAdvisorChoices(client, orgId)` returns Admins ordered by max `advisor_assigned_at` desc then name | Read only |
| `src/lib/actions/members.ts` `inviteMember` | accepts hidden `assignAthleteId`; after the membership insert (`:132`) sets the advisor through the caller's client and returns to `returnTo` | Refuses `assignAthleteId` when role is family (`parseInviteForm`, `src/lib/validation/member.ts:12-25`); writes no advisor when the invite fails |
| `src/lib/actions/athletes.ts` `updateAthlete:276` | stops writing `advisor_id` from Edit (decision below) | Otherwise every Edit save clears the sheet's assignment |

### Screens

| Screen | File | Change |
|---|---|---|
| Athlete profile | `roster/[id]/page.tsx` | Advisor `Section` moves to directly under the header and notice, above the placement row (`:223`). Row with `Avatar`, name, "Title" meta from the roles branch `personLabel`, `mailto:`, and a "Change" trigger; or `EmptyState "No Advisor Assigned"` with "Assign". Messages and Check-Ins rows move with it. Triggers only when `canEdit`. |
| Kit | `src/components/kit/PickerSheet.tsx` (new) | Client component on the `ConfirmButton` shell: trigger `Button`, scrim, bottom panel, a kit `Field type="search"` filtering the passed list in memory, `Form` of `Option` rows submitting `advisorId`, a "Nobody" option to clear, footer `LinkButton` "Add Admin" (wording decision below) to `roster/[id]/staff/new` when the user may invite. Generic so the member page can reuse it for Assign Athlete. |
| New page | `roster/[id]/staff/new/page.tsx` | `InviteForm` in a `pinnedRole` mode: `Hidden role=owner`, `Hidden assignAthleteId`, `Hidden returnTo`. Lede "They will be assigned as {name}'s advisor." Hint copy matches the roles branch ("Admins add and edit everything"). |
| Member page | `members/[userId]/page.tsx:236-272` | Keeps the tick list; adds an inline "Assign Athlete" `PickerSheet` when the tick list is empty or hidden. |
| Add and Edit forms | `src/components/AthleteForm.tsx:237-243` | Keep the Advisor select on Add (metrics-while-building pattern), drop it from Edit. |

Roles at 320/375/390: Admin sees the section, sheet and Add Admin; Athlete
login sees "Your Advisor" on its own page, unchanged (`family/[id]/page.tsx:163-176`);
Viewer never reaches the profile. Sheet panel must fit 320 with the search
field and 44px options.

### Tests And Laws

| Law | Plant |
|---|---|
| `orgCrudLaws.test.ts` (after `:372-414`): form action clears on empty; refuses a member, family or outsider advisorId; family login redirected to `/unauthorized`; recency puts the most recently assigned first (fixture `advisor_assigned_at` on `fixture.ts:185, :217`) | Drop the eligibility check in `setAthleteAdvisor`; fails |
| New law: the string `in("role", ["owner", "staff"])` or `.in("role", STAFF_ROLES)` against `org_members` for advisor purposes appears in one file only (`advisors.ts`) | Add a second copy; fails |
| `actionRun.test.ts` after `:2186-2235`: `inviteMember` with `assignAthleteId` writes membership then advisor, in that order, and no advisor when the invite fails | Swap the order; fails |
| `pageRender.test.ts:966-972`: Advisor precedes Targets in the HTML | Move the section back; fails |
| `pages.ts`: `athlete` expect gains `Advisor[\s\S]*(Assign\|Change)`; new entry for `roster/[id]/staff/new` expecting `Send Invite` | Render law |
| kitLaws: sheet under `kit/`, no raw input; copyLaws on every label | Automatic |

### Existing Laws And Contract Lines This Phase Changes

| Where | Today | Becomes |
|---|---|---|
| `docs/BUSINESS_RULES.md:266-271` and `:313` | Dave assigns from the Edit screen; owner on the member page, owner and staff on Edit | any Admin, from the athlete page or the member page |
| `docs/DECISIONS.md:3076` | Production `advisor_id` stays null, assign from Edit | new dated entry, not an edit |
| `docs/STYLING_CATALOG.md:98-99` | ConfirmButton is the only sheet | adds PickerSheet under Controls |
| `src/testing/pages.ts:84` | no Advisor expectation | adds one |
| `src/laws/README.md:164` item 23 | wording | wording |
| `0039` trigger comment | | names `src/lib/org/advisors.ts` as the app twin |

### Risks

- Line-for-line conflict with the roles branch across `members.ts`,
  `members/[userId]`, `InviteForm.tsx`, `AthleteForm.tsx`, `roster/[id]/page.tsx`,
  `staff.ts`, `validation/member.ts`, `fixture.ts`, `pages.ts`. Build on the
  rework's API (`labelForRole(role)`, `personLabel`, `title`), not HEAD's.
- Invite of an email that is already a Viewer or Athlete login returns
  "Already a member" (`members.ts:117`); the sheet flow should route to
  that person's member page rather than dead-end.
- No service-role key locally: Add Admin fails with the existing sentence
  (`members.ts:83-85`); assigning an existing Admin still works because
  `setAthleteAdvisor` uses the user's own client.

### Decisions For Tony (Staff/Owner Split)

1. "Owner only: Add Staff Member" becomes every Admin, because inviting a
   non-family role is `user.role === "owner"` (`members.ts:54`) and every
   Admin is owner after 0041. Recommend accepting; no narrower owner exists.
2. Preset role is `owner` (shown as Admin), not `staff`.
3. Button wording: "Add Admin" (recommended, the app's own word after the
   rework and honest about what the person can do) versus "Add Team Member"
   versus the spec's "Add Staff Member". Product call for Dave.
4. Recency source: trigger-stamped column (recommended) versus per-user picks table.
5. Advisor select removed from Edit (recommended) versus kept.
6. Messages and Check-Ins rows travel with the section to the top (recommended).

---

## Phase 3: More As The Control Center

**Goal.** Regroup the existing More rows into six sections and add an
Advisors list. No new capability beyond links to Phases 4 to 6, which
those phases add themselves.

### What Exists Today

- `more/page.tsx` sections: Work `:50` (Documents, Fundraising and Board
  module-gated), Reference `:56`, Matching `:67` (owner `PresetForm` and
  Recalculate All, staff read-only row `:81`), Document Reading `:86`
  (spend row and owner `DocaiBudgetForm`), Organization `:107` (Members and
  Settings owner-only `:108-109`, Start Another Organization `canStartOrg` `:36`,
  identity row `:111`, `YourNameForm` `:112`, Sign Out `:113-117`). `canEdit`
  `:25` gates nothing. Baseline `qa/clickable-baseline.json` `"more": 1`.
- Destination guards: schools, grading scales, approved lists, transfer
  windows, documents, mine `STAFF_ROLES`; settings and members `requireOwner`;
  `setScoringPreset` and `recalculateAllMatches` `requireOwner`
  (`src/lib/actions/matching.ts:47, 68`).
- `loadStaff` returns Admins name-sorted (`staff.ts:33`); advisor counts are
  computed on the member page (`members/[userId]/page.tsx:71, 101`); `/mine`
  filters `advisor_id = me` (`mine/page.tsx:45`).
- View As, Activity and Assignments do not exist (`git grep`).
- Viewer More reads only `org_members` (`member/more/page.tsx:31`); family
  More similar. Neither changes.

### Migrations And RLS

None. An Advisors screen reads `org_members` and `athletes.advisor_id`,
both already readable by Admins (`0023:147-148`, `0031:63-69`) and by no
Viewer (`rls_test.sql:771-785`). Add one `rls_test.sql` line: member
session reads 0 rows from `athletes` (already there) and only owner/staff
rows of its own org from `org_members` (already there). Nothing to plant.

### Actions

None new.

### Screens

| Section | Rows | Guard |
|---|---|---|
| People | Members (Admin), Advisors (new, Admin) | as today; `requireOwner` on Members becomes every Admin after 0041 |
| Program | Assignments (added by Phase 4), Documents | Admin |
| Reference | Schools, Grading Scales, Approved Lists, Transfer Windows | Admin, unchanged |
| Matching | Scoring Preset form and Recalculate All | Admin; `requireOwner` in `matching.ts:47, 68` is every Admin after 0041 |
| Foundation | Fundraising, Board | module-gated; section omitted entirely when neither module is on (`STYLING_CATALOG.md:41`) |
| Organization | Settings, Doc AI Spending (moved row; budget form stays where it is), View As (Phase 5), Activity (Phase 6), Start Another Organization, identity row, Your Name, Sign Out | Settings and View As and Activity are Admin |

New screen `src/app/org/[slug]/advisors/page.tsx`: `requireRole(STAFF_ROLES)`;
`loadStaff` plus one `athletes.select("id, advisor_id, status")` for the org;
a `Row` per Admin with `Avatar`, name, meta "Title · N athletes", `Chevron`,
href to `/members/[userId]` (where bulk assignment lives). A trailing "No
Advisor" row with the unassigned count linking to `/roster?advisor=none`
if the roster gains that filter, else no href (which would raise the
baseline; avoid). Count only Active and Transferring athletes, and say so
in the lede, so the number agrees with the reminder rule (`BUSINESS_RULES.md:264-275`).

Roles at 320/375/390: Admin sees every row (after 0041 there is no
narrower staff view; the per-row guards stay in code for leftover staff
rows). Viewer and Athlete login see their own More screens, untouched.

### Tests And Laws

| Law | Plant |
|---|---|
| `pageRender.test.ts:1145-1154` Organization Settings law kept: owner More links to `/settings`; a leftover staff role does not | Automatic |
| New: Foundation label absent for `ORG_WITHOUT_MODULES` (add a More entry for the Elite fixture in `pages.ts`) | Render Foundation unconditionally; fails |
| New: Viewer and Athlete login cannot open `/advisors` (falls out of the loops at `pageRender.test.ts:176-189, 793-803` once registered) | Register the page |
| New: every More row `href` resolves to a registered page (links law already runs live via `scripts/live/links.mjs`) | Point a row at a missing route; live check fails |
| `qa/clickable-baseline.json` `"more": 1` may only go down | Do not add non-link rows |
| copyLaws on "Doc AI Spending", "View As", "Recalculate All", "Advisors" | Automatic |

### Existing Laws And Contract Lines This Phase Changes

| Where | Today | Becomes |
|---|---|---|
| `docs/MATCHING_CONTRACT.md:250` "Recalculate All (owner, under More)" | | unchanged; owner means Admin |
| `docs/STYLING_CATALOG.md:38, 41` | | unchanged; Foundation hides when modules are off |
| `pageRender.test.ts:772` member-more form count, `:151/:197` family no-form | | untouched |
| `docs/CURRENT_STATE.md` More bullet, `docs/DECISIONS.md` regroup entry, `docs/ROADMAP.md` | | updated at Stage 3 |

### Risks

- The roles branch edits `more/page.tsx`, `pages.ts`, `pageRender.test.ts`; rebase first.
- Rows for Assignments, View As, Activity must not exist before their
  pages, or `links.mjs` fails. Each later phase adds its own row.
- Advisor counts and reminder rule disagree unless one definition is chosen (above).

### Open Questions For Tony

1. Program > Assignments target: the org-wide assignments list built in Phase 4 (recommended) versus `/mine`.
2. Advisors row for a leftover staff role: same read-only list (recommended).
3. Doc AI Spending: row moves to Organization, budget form stays beside it (recommended, placement only).

---

## Phase 4: Assignments

**Goal.** Admins assign an athlete a piece of work with a due date; the
Athlete login submits it (with a file when asked) through one RPC; Admins
review. Overdue is computed, never stored.

### What Exists Today

- No assignment model (`git grep`). `docs/DECISIONS.md:308-360` rejects task
  widgets on Today; assignments are athlete-scoped work, compatible, and
  DECISIONS should say so.
- Family write today: `athlete_messages` by a plain insert policy
  (`0039:202-206`), action `sendMessage` (`src/lib/actions/messages.ts:43-76`).
  Security-definer precedents: member RPCs (`0031`), grants shape
  (`0033:28-34`), `create_org` (`0040:165-209`, `set search_path = ''`,
  errcodes). Fake RPC dispatch `fakeSupabase.ts:480-483` to `fakeRpc.ts`.
- Coherence trigger `private.athlete_row_is_coherent()` (`0039:122-132`),
  reused by `athlete_notes` (`0040:103-105`). Honesty trigger pattern
  `private.athlete_message_is_honest()` (`0039:155-175`).
- Documents: table `0007:34-78` (`source_role` includes parent and athlete
  `0007:21`; `doc_status` processing, pending, applied, discarded, failed
  `0007:32`), `storage_paths` `0017:104`, `content_hash` `0029:14`, `read_by`
  `0040:127`. Policies: read admits family athletes (`0024:24-26`); insert,
  update, delete are `_staff_org_ids()` (`0010:71-86`). Bucket `documents`
  private, 10MB, image and PDF types (`0017:67-75`, `0029:21`); storage
  read `_member_org_ids()`, insert and delete `_staff_org_ids()`, key is
  the org folder (`0017:77-96`).
- A family cannot upload today at three layers: storage insert (`0017:85-89`),
  `documents_insert` (`0010:71-73`), `processDocument` guard and Doc AI run
  (`src/lib/actions/documents.ts:283`). A family cannot read the bytes (`0017:77-82`, on purpose per `0024:11-14`).
- Upload path: `DocumentUploader.tsx:97-113` uploads client-side to
  `${orgId}/${requestId}/${i+1}-${safeFileName}` then calls `processDocument`;
  the server re-reads with the caller's client and enforces `STORAGE_PATH`
  (`documents.ts:194, 216-234`); bytes validated by `validateRecords`
  (`documents.ts:153-189`, `src/lib/docai/acceptance.ts`); `laws.test.ts:82-125`
  forbids duplicating the byte limit.
- Today sections `org/[slug]/page.tsx:234-350`; My Athletes meta `mine/page.tsx:102`;
  profile sections `roster/[id]/page.tsx:222-531`; family athlete page
  sections `family/[id]/page.tsx:143-271`, no form on it; the family thread
  carries a form (`family/[id]/messages/page.tsx:47`).
- `StatusPill` maps target and athlete statuses only; assignment statuses
  need their own `Chip` role map (`pageRender.test.ts:460-505` counts
  `STATUS_ROLE` against `ATHLETE_STATUSES`).
- No `updated_at` trigger exists anywhere in the repo.

### Migrations

`0045_doc_status_filed.sql` (its own file, the 0022 lesson, `DECISIONS.md:2132-2134`):
`alter type doc_status add value if not exists 'filed';` A family upload is
filed, never read by Doc AI, and never shows in Needs Review.

`0046_assignments.sql`:

```sql
create type assignment_category as enum ('academics','recruiting','eligibility','financial_aid','ncaa','applications','college_list','athletics','other');
create type assignment_kind as enum ('upload','complete_info','confirm','other');
create type assignment_status as enum ('assigned','submitted','needs_revision','complete','cancelled');

create table assignments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  athlete_id uuid not null references athletes(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  instructions text check (instructions is null or length(instructions) <= 4000),
  category assignment_category not null default 'other',
  kind assignment_kind not null default 'other',
  due_on date,
  status assignment_status not null default 'assigned',
  document_id uuid references documents(id) on delete set null,
  family_note text check (family_note is null or length(family_note) <= 4000),
  reviewer_comment text check (reviewer_comment is null or length(reviewer_comment) <= 4000),
  created_by uuid references users(id) on delete set null,
  reviewed_by uuid references users(id) on delete set null,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assignments_athlete_idx on assignments (athlete_id, status, due_on);
create index assignments_org_idx on assignments (org_id, status, due_on);
create index assignments_document_idx on assignments (document_id);
create index assignments_created_by_idx on assignments (created_by);
create index assignments_reviewed_by_idx on assignments (reviewed_by);
```

Triggers:
- `assignments_coherent` before insert or update, `private.athlete_row_is_coherent()` (0039 pattern).
- `private.assignment_document_is_coherent()`: refuses a `document_id` whose
  `documents.org_id <> new.org_id` or `documents.athlete_id <> new.athlete_id`.
- `private.assignment_is_honest()`: on insert `created_by := auth.uid()`
  (unless service role) and `created_at := now()`; on update `created_by`,
  `created_at`, `athlete_id`, `org_id` may not change; `updated_at := now()`
  on every update (the repo's first touch trigger, scoped to this table).
- Overdue is `due_on < current_date and status in ('assigned','needs_revision')`,
  a pure function in `src/lib/assignments.ts`, never a column.

RPC `public.submit_assignment(p_assignment uuid, p_note text, p_file_name text, p_file_size int, p_media_type text, p_storage_path text) returns uuid`,
`security definer`, `set search_path = ''`:
1. Row must exist with `athlete_id in (select private._family_athlete_ids())`, else `insufficient_privilege`.
2. Status must be `assigned` or `needs_revision`, else `check_violation`.
3. If `p_storage_path` is not null: it must start with `<org_id>/family/` and
   the caller must own it (`storage.objects.owner = auth.uid()`), else
   `check_violation`; insert a `documents` row (`status 'filed'`, `source_role 'parent'`,
   `athlete_id`, `org_id`, `file_name`, `file_size`, `media_type`, `storage_paths`,
   `content_hash` from the action), link it.
4. Set `status = 'submitted'`, `family_note`, `submitted_at = now()`.
5. If Phase 6 has merged: insert the `activity_log` row `assignment_submitted` with `actor_id = auth.uid()` inside the same function.
6. `revoke execute from public, anon; grant execute to authenticated` (0033 shape).

Add both files to `scripts/run_rls_test.sh` after the 0040 line (`:75`).

### Minimum Storage And Documents Policy Change For A Family Upload

One new policy, no existing policy changes:

```sql
create policy documents_bucket_family_insert on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._family_org_ids() as org_id)
    and (storage.foldername(name))[2] = 'family'
  );
```

A family writes only under `<org>/family/<request>/<file>`. The `[2] = 'family'`
segment is load-bearing: without it a family could drop a file into a
staff request folder that `processDocument` would later read back. The
`documents` table gets no family insert policy: the RPC files the row.
Family read of the bytes stays closed (`0017:77-82`); Admin read already
covers the org folder. `STORAGE_PATH` (`documents.ts:194`) is not widened;
the assignment action uses its own four-segment `FAMILY_STORAGE_PATH`.

### RLS Policies

| Policy | Shape |
|---|---|
| `assignments_read` select | `org_id in (select private._member_org_ids()) or athlete_id in (select private._family_athlete_ids())` |
| `assignments_insert` | `org_id in (select private._staff_org_ids()) and created_by = (select auth.uid())` |
| `assignments_update` using and with check | `org_id in (select private._staff_org_ids())` |
| delete | none; Cancel is a status and history stays (the suite demands SELECT and INSERT only, `rls_test.sql:1204-1258`) |

Planted-to-fail cases for `scripts/rls_test.sql`:

| Role | Case | Plant |
|---|---|---|
| Admin | reads, inserts, reviews within org; cannot insert with `created_by` of another user (trigger rewrites, policy refuses) | Drop `created_by` clause; fails |
| Admin, second org | reads 0 rows of org A; insert naming org A's athlete raises from the coherence trigger; update affects 0 rows | Drop the trigger; fails |
| Athlete login | reads its linked athlete's rows and 0 of another athlete; insert, update, delete each 0 rows or 42501; `submit_assignment` succeeds on a linked assigned row, refuses non-linked, refuses complete or cancelled, refuses a storage path under another org or outside `/family/`, refuses a document of another athlete | Remove the guardian check in the RPC; fails |
| Athlete login, storage | insert into `<org>/family/x/f.pdf` accepted; into `<org>/<other>/f.pdf` refused; into another org's folder refused; read of its own upload refused | Drop the `[2]` check; fails |
| Viewer | `select count(*) = 0`; insert refused (add `assignments` to the loop at `:916`) | Widen read to `_any_org_ids()`; fails |
| anon | `submit_assignment` refused | Skip the revoke; fails locally through `run_rls_test.sh` anon mirroring |
| All | the "a family member writes nothing" block `:1545-1568` stays green; notice text amended to "writes nothing but a message and an assignment submission" | |

### Actions

`src/lib/actions/assignments.ts`, validation `src/lib/validation/assignment.ts` (zod, mirrors `validation/message.ts`):

| Function | Guard | Refuses |
|---|---|---|
| `createAssignment(slug, athleteId, prev, formData)` | `requireRole(STAFF_ROLES)`, `assertAthleteInOrg` (as `checkins.ts:21-25`) | bad form, athlete of another org, removed athlete |
| `reviewAssignment(slug, athleteId, assignmentId, decision, comment)` | Admin; update scoped `.eq("org_id").eq("athlete_id").eq("id")`, zero-row check (`checkins.ts:79-87`) | decision not in complete or needs_revision; needs_revision without a comment; a row not in status submitted |
| `cancelAssignment(...)` | Admin, `ConfirmButton` | a complete row |
| `submitAssignment(slug, athleteId, assignmentId, prev, formData)` | `requireFamilyAthlete`; Admin refused | anything but `supabase.rpc("submit_assignment")`; for kind upload: downloads the file with the caller's client, runs `checkIngestedRecord` (no duplicated limit), hashes, refuses a duplicate `content_hash` in the org with the existing wording (`documents.ts:337-360`), then calls the RPC |
| Client component `AssignmentUploader` | family | uploads to `<org>/family/<request>/<file>` then calls `submitAssignment` |

Every action revalidates the profile, Today, `/mine`, `/assignments`, the
family athlete page. No email.

### Screens

| Screen | File | Roles |
|---|---|---|
| Profile section "Assignments" | `roster/[id]/page.tsx` between Advisor and Notes; overdue then due soon first (`sortByUrgency`), `Chip` status, `action=` See All, `LinkButton` "Assign" | Admin |
| `/roster/[id]/assignments` | full list, grouped Open, Submitted, Done | Admin |
| `/roster/[id]/assignments/new` | title, category `SelectField`, kind, due_on, instructions `TextAreaField` | Admin |
| `/roster/[id]/assignments/[assignmentId]` | detail; document row link when uploaded; Complete `Button`, Needs Revision with comment `Form`, Cancel `ConfirmButton` | Admin |
| `/org/[slug]/assignments` | org-wide: Submitted for Review, Overdue, Due Soon, with `SearchField` over title and athlete when over five; More > Program row | Admin |
| Today | two sections "Submitted for Review" and "Overdue" after Needs Follow-Up (`:301`), before Upcoming, each only when non-empty; one query joins the `Promise.all` (`:93-110`) | Admin |
| My Athletes | meta gains "N overdue · N to review" per athlete (`mine/page.tsx:102`) | Admin |
| Family athlete page | "Your Assignments" section at the top, under the placement row (`:161`) and above Your Advisor; one `Row` per open row with trailing `LinkButton` "Submit" or "Fix and Resubmit"; complete ones summarised; cancelled hidden | Athlete login |
| `/family/[id]/assignments/[assignmentId]` | instructions, reviewer comment when needs_revision, `FileField` for kind upload, `TextAreaField` note, one `Button` | Athlete login |

Viewer reaches none of these (existing loops) and its athlete page carries
no assignment title. At 320 the family row with a trailing button stacks
like every Row; the Chip map lives in a new `assignmentStatus.ts` beside
`statusHue.ts`.

### Tests And Laws

`src/laws/assignmentLaws.test.ts`, each planted and reverted:

| Law | Plant |
|---|---|
| Overdue and due soon are pure (`src/lib/assignments.ts` unit tests, bench cases) | Store a boolean; schema law and this law fail |
| Family reads only linked athletes' rows; the page 404s otherwise; an owner cannot open family assignment pages; a Viewer cannot open any assignment page | Loops in `pageRender.test.ts:127-189, 758-803` once registered |
| `submitAssignment` writes through `rpc` only: no `.from("assignments").update` in any family path | Add one; fails |
| `submitAssignment` refuses an Admin, a non-linked athlete, status complete or cancelled (fake RPC mirror in `fakeRpc.ts`, recorded) | Remove a check in the mirror and in SQL; both fail |
| Review is scoped by org and athlete; a foreign key from another org refused (`actionRun.test.ts:304-373` template) | Drop `.eq("org_id")`; fails |
| No family or member file names `athlete_notes`, `athlete_checkins`, `activity_log` (extend `autofillLaws.test.ts:127-131`) | Add the string; fails |
| Today renders a submitted and an overdue fixture assignment, and nothing when there are none | Remove the empty guard; fails |
| A `filed` document never renders in Needs Review or with an Apply button (`documents/page.tsx:149-154`) | Route filed to pending branch; fails |
| Fixture: `assignments` rows on `IDS.athlete` (overdue assigned, submitted, needs_revision, complete), none on the transfer; a `family` storage object | |

### Existing Laws And Contract Lines This Phase Changes

| Where | Today | Becomes |
|---|---|---|
| `scripts/rls_test.sql:1568` notice | a family member writes nothing | writes nothing but a message and an assignment submission |
| `docs/BUSINESS_RULES.md:282-285, 303, 317-318` | a family writes exactly one thing | two: a message and a submission; table gains Assignment rows |
| `docs/DECISIONS.md:2117, 2148-2150` | family writes nothing; documents read only, no upload | new dated entry; old text stays as history |
| `docs/ARCHITECTURE.md:204-206` | every write policy is staff orgs with one exception | two exceptions and one family RPC |
| `docs/CURRENT_STATE.md:207-209` | | replaced at Stage 3 |
| `documents/page.tsx:119, 164-168`, `documents/[id]/page.tsx:151-152, 389`, `family/[id]/page.tsx:56-62` `DOC_STATUS` | five status values | six; filed labelled "Family Upload" |
| `src/laws/migrationLaws.test.ts` | | 0045 and 0046 carry no data |
| `docs/DECISIONS.md:308-360` no task widgets on Today | | entry saying assignments are athlete-scoped work, and the two Today sections render only when non-empty |

### Risks

- Wrong `doc_status` puts a family file in Needs Review with an Apply button; the `filed` value and its law exist for this.
- `fakeRpc` is a second implementation; the RPC rules must be written identically in SQL and the fake, and the SQL suite is the proof.
- Today grows two sections; Dave called Today "way too much" once (`pageRender.test.ts:461-462`).
- `documents.athlete_id` is `on delete set null` while `assignments.athlete_id` cascades; every assignment query filters `athletes.deleted_at is null` like `loadRoster`.
- Storage insert by a family has only the bucket's size and mime limits; the action re-validates bytes before the RPC files the row.
- If Phase 6 has not merged, step 5 of the RPC is added by a follow-up migration; build order 6 before 4 avoids that.

### Open Questions For Tony

1. `doc_status 'filed'` (recommended) versus reuse `applied`.
2. Family may open its own upload: no (recommended, matches 0024) versus a bucket read clause on `<org>/family/`.
3. Due soon window: 7 days (recommended) versus 3 or 14.
4. Cancel hides the row from the family screen (recommended) versus struck through.
5. The nine categories are an enum; adding one later is a code change plus a migration. Confirm final.
6. Staff/owner split: none; every Admin assigns, reviews and cancels.

---

## Phase 5: View As

**Goal.** An Admin sees exactly what a chosen Athlete login, Viewer or
other Admin sees, read only, for at most 30 minutes, with a banner and a
Return, and every write refused server side.

### What Exists Today

- Identity: `getAuthUser` calls `auth.getUser()` once per request (`guard.ts:42-48`);
  `getCurrentUser` reads the caller's own `org_members` row (`:50-74`);
  every `require*` sits on it; `homeFor` (`:147-151`) picks the home by
  role; the org layout picks the tab bar from `getCurrentUser().role`
  (`src/app/org/[slug]/layout.tsx:14-17`). `getOrgMemberships` reads by `user.id`
  (`src/lib/org/membership.ts:22-40`).
- Clients: one ssr session per cookie jar (`src/lib/supabase/server.ts:10-34`);
  service role `admin.ts:5-11` used in nine action files; `auth.getUser` in
  five places; no JWT or token code; `@supabase/ssr ^0.5.2`.
- RLS: every policy resolves through security-definer helpers on `auth.uid()`
  (`_member_org_ids` `0031:29`, `_staff_org_ids` `0015:55`, `_observer_org_ids` `0031:34`,
  `_family_org_ids`, `_family_athlete_ids` `0023:86-93`, `_family_staff_rows`,
  `_observer_staff_rows` `0031:43-51`); a few compare `user_id = (select auth.uid())`
  inline (`org_members_self` `0031:63-70`, `athlete_message_reads_*` `0039:215-232`,
  `athlete_notes_insert` `0040:115`, `athlete_messages_insert` `0039:202`).
  `0015:64+` has a DO loop that rewrites every policy with `format()`.
- Harness: `rls_test.sql` runs as NOBYPASSRLS `app_user` and switches with
  `set_test_user(uuid)` (`scripts/local_auth_stub.sql:15-26`); structural
  checks at `:1193-1258` with `write_exempt = ['org_members']` (`:1223`).
- Fixture: `fakeSupabase.ts` has no RLS; `pageRender.test.ts:57-59` sets
  `currentUser = page.as`; `:63-67` fails any page touching `createAdminClient`;
  `fixtureServer.ts:21-33` signs the live app in via a `fixture_user` cookie.
- Page-time write: `markThreadRead` upserts during render (`src/lib/data/messages.ts:95-98`).
- `DECISIONS.md:119-124` already declined JWT-claims approaches.

### Mechanism Options

| Option | How | Risks | Verdict |
|---|---|---|---|
| A. Mint a real session for the target | admin `generateLink` + `verifyOtp`, or an HS256 JWT signed with the project secret | Signs the Admin out (one session per jar); Return needs a second minted token; `verifyOtp` records a real sign-in and flips `users.last_sign_in_at`, which Members reads as Invited versus signed in; a custom JWT needs a god secret in env and breaks under asymmetric keys; `DECISIONS.md:119-124`. Acting as another person's credential. | **Not built.** No real token for another user is minted without Tony's written sign-off on that specific design, and this plan does not ask for it. |
| B. Service role plus an app-side filter layer | admin client, re-implement each role's scope in TypeScript | A second implementation of 40 migrations of policy; equivalence unprovable; every page violates `pageRender.test.ts:63-67` | Rejected |
| C. Fixture-style fake client | render with invented data | Shows nobody real; no RLS | Rejected as the mechanism; kept as the render harness |
| D. In-database effective identity on the Admin's own token | a `view_as_sessions` row; `private._effective_uid() = coalesce(_view_target(), auth.uid())`; every policy and helper evaluates the target's uid; every non-select policy gains `and not private._viewing()` | Blast radius of a policy rewrite, mitigated by an equivalence loop that fails on any policy missed; the switch is account-wide for 30 minutes (every tab and device) | **Recommended** |

Within D, two ways to reach every policy:
- D1: a DO loop over `pg_policy` in `public` and `storage.objects` rewriting
  `auth.uid()` to `private._effective_uid()` in `qual` and `with_check` and
  appending `not private._viewing()` to every non-SELECT policy (the `0015:64+`
  precedent). Mechanical, complete, large diff.
- D2: re-create the seven helpers on `_effective_uid()`, rewrite by hand the
  four inline `auth.uid()` policies, and run the DO loop only to append
  `not private._viewing()` to writes. Smaller diff, relies on the grep for
  inline uses being complete.

Recommend **D2 plus the equivalence loop**, because the loop, not the
grep, is the proof: if an inline policy is missed the read hash differs
and the suite fails. Both variants share the same tests.

### Migrations

`0047_view_as.sql`:

```sql
create table view_as_sessions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  viewer_id uuid not null references users(id) on delete cascade,
  target_id uuid not null references users(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('returned','expired')),
  check (viewer_id <> target_id)
);
create index view_as_sessions_org_idx on view_as_sessions (org_id, viewer_id);
create index view_as_sessions_viewer_idx on view_as_sessions (viewer_id);
create index view_as_sessions_target_idx on view_as_sessions (target_id);
create unique index view_as_sessions_one_active on view_as_sessions (viewer_id) where ended_at is null;
```

- Coherence trigger `private.view_as_is_coherent()`: `target_id` must be an
  `org_members` row of `new.org_id` with role in `('member','family','owner','staff')`
  and `viewer_id` an owner of `new.org_id`; `expires_at <= started_at + interval '30 minutes'`.
- `private._view_target()` (active, unexpired row for the real `auth.uid()`),
  `private._effective_uid()`, `private._viewing()`, `private._owner_org_ids()` on the real uid.
- Re-create the seven helpers on `_effective_uid()`; rewrite the four inline policies; DO loop appends `and not private._viewing()` to every INSERT, UPDATE, DELETE policy in `public` and `storage.objects`.
- RPCs `public.start_view_as(p_org uuid, p_target uuid) returns uuid` and `public.end_view_as() returns void`, security definer, `set search_path = ''`: only an owner of that org, target a member of that org and not self; one active row; each writes the Phase 6 `activity_log` row (`view_as_started`, `view_as_ended` with reason) with `actor_id = auth.uid()` (the real one). `end_view_as` is the only write allowed while viewing, and it checks the real uid. Lazy expiry: the next `start_view_as` or `end_view_as` closes an expired row with `expired`.
- `create_org` (`0040:165`) additionally refuses while viewing.
- Grants: revoke from public and anon, grant to authenticated.

### RLS Policies

| Table | Policy |
|---|---|
| `view_as_sessions` | select `org_id in (select private._owner_org_ids()) and viewer_id = (select auth.uid())`; no insert, update or delete policy (writes inside the two RPCs); add to `write_exempt` with reason |
| everything else | unchanged in meaning; evaluated for the effective uid; writes refused while viewing |

Planted-to-fail cases:

| Case | Plant |
|---|---|
| Equivalence loop: for every RLS table in `public` and `storage.objects`, `md5(string_agg(row::text order by row::text))` as owner-with-active-session equals the same as `set_test_user(target)`, for a family target, a member target and an admin target; the three member RPCs compared the same way | Leave one helper on `auth.uid()`; fails |
| Write loop: every INSERT, UPDATE, DELETE on every `org_id` table and on `storage.objects` while viewing affects 0 rows or raises 42501 | Remove `not _viewing()` from one policy; fails |
| Expiry: set `expires_at` into the past; reads revert to the owner's own | Drop the `expires_at > now()` clause; fails |
| `start_view_as` refused for a leftover staff row, a Viewer, an Athlete login, an outsider, and for self; refused while one is active | Drop the owner check; fails |
| Viewer and Athlete login read 0 rows of `view_as_sessions` and cannot insert | Widen; fails |
| Second org's owner cannot view a person of the first org | Trigger check; fails |
| `end_view_as` closes and logs; `start_view_as` logs | Phase 6 assertions |

### Actions

| File | Function | Refuses |
|---|---|---|
| `src/lib/actions/viewAs.ts` | `startViewAs(slug, targetId)`: `requireOwner`, `rpc start_view_as`, redirect to `homeFor(slug, targetRole)`; `endViewAs(slug)`: `rpc end_view_as`, redirect to `/more?notice=` | Anyone but an owner of the org; every other action while viewing |
| `src/lib/auth/guard.ts` | cached `getViewAs()`; `getCurrentUser` reads `org_members` by the effective id and returns `viewingAs: {sessionId, name, role, expiresAt} \| null`; `requireActor(orgId, roles)`, `requireOwnerActor`, `requireDirectoryEditorActor` refuse while viewing with the standard `{errors: {form}}` or `?error=` | Every file under `src/lib/actions/` switches to the actor variants except `viewAs.ts`, which covers the service-role sites because each sits behind a guard |
| `src/lib/org/membership.ts:29` | `getOrgMemberships` by effective id | |
| `src/lib/data/messages.ts:95` | `markThreadRead` failure ignored; page still renders | |

### Screens

| Screen | File | Roles |
|---|---|---|
| `/org/[slug]/view-as` | three `Row`s labelled with the roles vocabulary: Athlete, Viewer, Admin | owner |
| `/org/[slug]/view-as/[role]` | people of that role as `Row`s with `Form` + `Button` "View As"; family rows show linked athletes | owner |
| Banner | kit `ViewAsBanner` rendered in flow at the top of `Chrome` (`kit/index.tsx:589`) when `viewingAs` is set, `Notice`-styled: "Viewing as <name> · Return to Admin" with the `Form` button; `Chrome` gains a `viewingAs` prop from `layout.tsx:14`; also rendered on `/` and `/unauthorized` so Return is reachable wherever the owner lands | everyone while viewing |
| More | "View As" row under Organization | owner |

While viewing an Athlete login the app renders the `/family` screens with
that person's athletes; a Viewer, the `/member` screens; an Admin, the org
screens with that person's My Athletes and reminders. Walk each at
320/375/390 in both themes with the banner, which must not push the fixed
tab bar or cause sideways scroll at 320.

### Tests And Laws

| Law | Plant |
|---|---|
| `src/laws/viewAsLaws.test.ts`: no file under `src/lib/actions/` imports `requireRole`, `requireOwner`, `requireMember`, `requireDirectoryEditor` from guard except `viewAs.ts` (pattern `ncaaLaws.test.ts:341`) | Import one; fails |
| Runtime: every exported action, run with viewing active on the fake, records zero writes and returns no success redirect | Skip the actor guard in one; fails |
| The banner renders on every page in `pages.ts` when `viewing` is set, and never otherwise | Remove from Chrome; fails |
| `startViewAs` refused for staff, member, family callers and for self | |
| `fakeSupabase.ts` gains a `viewing` option refusing every write with 42501; `fixtureServer.ts` accepts `fixture_view_as` so `drive.mjs`, `clickable.mjs`, `links.mjs` open family, member and admin routes as the owner viewing; `pages.ts` entries for the two screens and banner renders of one family, one member and one admin screen with `as: OWNER_ID, viewing: FAMILY_ID` etc; the "an owner cannot open" loops at `pageRender.test.ts:127-129, 180, 758-785` filter on `!x.as` and must learn the new field | |
| `dataLaws.test.ts:86`: `view_as_sessions` is read in app code and written only in SQL; add the documented exception if the law flags it | |

### Existing Laws And Contract Lines This Phase Changes

| Where | Today | Becomes |
|---|---|---|
| `scripts/rls_test.sql:1223` `write_exempt` and `DECISIONS.md:1499-1530` | `['org_members']` | plus `view_as_sessions` with reason |
| `guard.ts:29-41` `CurrentUser` and its comment "comes from the session, not guessed" | | identity may come from a database row bound to the session; new field |
| `docs/STYLING_CATALOG.md:107` Chrome | org name above, TabBar fixed below | plus the in-flow banner while viewing |
| `kitLaws.test.ts:128` only the kit is fixed | | satisfied; the banner is in flow and in the kit |
| `pageRender.test.ts:63-67, 122-182, 757-797` | | meaning unchanged, extended with `viewing` |
| `docs/ARCHITECTURE.md:588-596` membership | | new section: effective identity |
| `docs/DECISIONS.md` | | entry: mechanism D chosen, minting rejected, reasons |
| `migrationLaws.test.ts` | | 0047 carries no data |

### Risks

- Policy rewrite blast radius; the equivalence and write loops are the mitigation and fail on any miss.
- Account-wide switch for 30 minutes: every device and tab, including the browser anon-key client; Return must be reachable everywhere, hence the banner on `/` and `/unauthorized`.
- Lockout bounded by the database expiry.
- Service-role writes bypass RLS; refusal there depends on the actor guards plus the static law.
- `fakeRpc.ts` and the fixture remain second implementations; the docs say the render law proves page code, not scope.
- Unread counts do not clear while viewing (`markThreadRead` refused); acceptable, the banner can say so.

### Open Questions For Tony

1. Mechanism: D2 plus equivalence loop (recommended) versus D1 full rewrite. Option A is off the table without a separate signed design.
2. Targets: Athlete login and Viewer only (the spec's "Staff" set would be other Admins after 0041; the report says never another owner). Recommend including other Admins because My Athletes, reminders and Today differ per person; otherwise the "Staff" row has nobody in it.
3. Account-wide row (recommended) versus row plus signed cookie for a one-browser switch.
4. Banner in flow at the top of Chrome (recommended) versus fixed; Return also on `/` and `/unauthorized` (recommended).
5. Storage policies included in the rewrite and the equivalence loop (recommended yes).
6. Lazy expiry log row (recommended) versus a sweep on every `getViewAs`.

---

## Phase 6: Activity Log

**Goal.** An append-only, org-scoped record of who did what to what,
written by every listed server action and RPC, read by Admins only, with
summaries that can never carry note, message or document text.

### What Exists Today

- No activity table, helper, screen or law (`grep`). Only `documents.applied_by`
  (`0007:70`) and `documents.read_by` (`0040:127`) say who did something.
- Closest pattern: `athlete_notes` (`0040:112-119`, select on `_member_org_ids()`,
  insert on `_staff_org_ids()` and `author_id = auth.uid()`, no update policy);
  `addAthleteNote` helper (`src/lib/data/athleteNotes.ts:40-55`).
- Actions under `src/lib/actions/*.ts`, each guarded and writing through the
  user's client; `actionRun.test.ts` records writes per table (`fakeSupabase.ts:33, 40`).
- Family writes: `sendMessage` (`messages.ts:43-76`) runs as the family session, which no Admin-only insert policy admits.
- Screens: profile Sections (`roster/[id]/page.tsx:326-521`), More Organization
  (`more/page.tsx:107-109`), `SearchField` shown when `all.length > 5 || q`
  (`roster/page.tsx:94`).

### Migrations

`0044_activity_log.sql` (before 0045 to 0047 so Phase 4 and 5 RPCs can write it):

```sql
create type activity_action as enum (
  'athlete_created','athlete_edited','athlete_status_changed','athlete_removed',
  'advisor_set','advisor_cleared',
  'target_added','target_status_changed','target_removed',
  'assignment_created','assignment_submitted','assignment_reviewed','assignment_cancelled',
  'document_uploaded','document_applied','document_discarded',
  'checkin_logged','message_sent',
  'member_invited','member_role_changed','member_removed',
  'view_as_started','view_as_ended'
);
create table activity_log (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references orgs(id) on delete cascade,
  athlete_id uuid references athletes(id) on delete set null,
  actor_id uuid references users(id) on delete set null,
  action activity_action not null,
  subject_type text not null check (subject_type in ('athlete','target','assignment','document','checkin','message','member','view_as')),
  subject_id uuid,
  summary text not null check (length(btrim(summary)) between 1 and 200),
  created_at timestamptz not null default now()
);
create index activity_log_org_idx on activity_log (org_id, created_at desc);
create index activity_log_athlete_idx on activity_log (athlete_id, created_at desc);
create index activity_log_actor_idx on activity_log (actor_id);
```

- Coherence trigger `activity_log_coherent ... when (new.athlete_id is not null)` using `private.athlete_row_is_coherent()`.
- Honesty trigger `private.activity_is_honest()`: on insert `created_at := now()` and, unless service role, `actor_id := auth.uid()`; any update raises `check_violation`.
- `athlete_id on delete set null`, never cascade: Remove Athlete is a soft delete (`athletes.ts:351`) and history outlives hard deletes elsewhere.
- RPC `public.log_family_message(p_athlete uuid) returns void`, security definer, `set search_path = ''`: caller must be in `athlete_guardians` for that athlete; reads `org_id` itself; inserts the fixed summary "Sent a message" with `actor_id = auth.uid()`. The body never enters the signature. Grants per 0033.
- No data rows; passes `migrationLaws`.

### RLS Policies

| Policy | Shape |
|---|---|
| `activity_log_read` select | `org_id in (select private._staff_org_ids())` (not `_member_org_ids`, so the intent survives if that helper is ever widened) |
| `activity_log_insert` | `org_id in (select private._staff_org_ids()) and actor_id = (select auth.uid())` |
| update, delete | none, for anyone; the service role has no delete path in code and a law greps for `.from("activity_log").delete` and `.update` |

Planted-to-fail cases:

| Role | Case | Plant |
|---|---|---|
| Admin | inserts as self; insert with another `actor_id` is rewritten by the trigger; update and delete affect 0 rows | Add an update policy; fails |
| Admin, second org | reads 0 rows; insert naming org A raises or is refused | Widen read; fails |
| Athlete login | `select count(*) = 0`; insert refused; `log_family_message` succeeds for its own athlete, refused for another | Drop the guardian check; fails |
| Viewer | `select count(*) = 0`; insert refused (add to the loop at `:916`) | Widen read; fails |
| anon | RPC refused | Skip revoke; fails |

### Actions

`src/lib/data/activity.ts`:

| Function | Contract |
|---|---|
| `logActivity(client, entry)` | `entry = { orgId, actorId, action: ActivityAction, subjectType, subjectId, athleteId?, subject: { name?, from?, to?, kind?, date? } }`. Builds the sentence from a fixed template per action ("Moved Fixture Athlete to Committed", "Logged a call check-in", "Sent a message"). Returns `ActivitySummary`, a branded string, and inserts it. Never throws into the action; warns and continues. |
| `loadActivity(client, orgId, { athleteId?, q?, limit })`, `loadRecentActivity(client, orgId, athleteId, 5)` | joined to `users` for actor names, same shape as `loadAthleteNotes` (`athleteNotes.ts:60-80`); search in memory over summary and actor name |

Call sites, one `logActivity` after the successful write and before `revalidatePath`:

| Action | File and function |
|---|---|
| athlete create, edit, status change, advisor set or cleared on edit, removed | `athletes.ts` `createAthlete:77`, `updateAthlete:173` (status entry when `transition` is non-null; advisor entry when `advisor_id` changed, add it to the `before` select), `removeAthlete:351` |
| advisor set or cleared in bulk | `members.ts` `setAthleteAdvisor:461`, one row per athlete; Phase 2's form action goes through it |
| status change via close-out or reopen | `enrollment.ts` `markEnrolled:54`, `markGraduated:138`, `markDrafted:176`; `reopen.ts` `reopenRecruiting:29`; never inside `src/lib/data/enrollment.ts` (double log) |
| target added, status change, removed | `targets.ts` `createTarget:35`, `updateTarget:78` (only when status changed), `deleteTarget:163`; `addMatchToBoard` (`matching.ts:16`) |
| document uploaded, applied, discarded | `documents.ts` `processDocument:261` after the insert at `:363-380`, `applyDocument:992` after `:1043`, `discardDocument:1106` |
| check-in logged | `checkins.ts` `logCheckin:34`; summary carries kind and date only |
| message sent | `messages.ts` `sendMessage:43`: Admin branch `logActivity`; family branch `rpc log_family_message` |
| member invited, role changed, removed | `members.ts` `inviteMember:42` (both branches), `changeMemberRole:169`, `removeMember:259`; guardian link and unlink (`guardians.ts:112, 57`) as `member_*` with subject athlete |
| assignment created, reviewed, cancelled | Phase 4 actions; submitted inside `submit_assignment` |
| View As start and end | inside `start_view_as` and `end_view_as` (Phase 5) |

### How Summary Never Carries Text Is Enforced

Two layers, both required:

1. **Type.** `summary` is not a parameter anywhere. `logActivity` takes an
   action and a small `subject` of names, statuses, kinds and dates, and
   builds the sentence from a template table in `activity.ts`. The result is
   `type ActivitySummary = string & { __brand: "ActivitySummary" }`, and the
   insert type requires it, so `.insert({ summary: someString })` anywhere
   else fails `npm run typecheck`. The two SQL functions that write rows for
   a family (`log_family_message`, `submit_assignment`) take no text
   parameter that reaches `summary`; their summaries are literals in the body.
2. **Law** (`src/laws/activityLaws.test.ts`, each planted and reverted):
   (a) every `logActivity(` call in `src/lib/actions` is scanned; any
   argument property named `notes`, `body`, `extracted`, `content`,
   `instructions`, `family_note`, `reviewer_comment` or `summary` fails;
   (b) the action harness runs with the fixture bodies ("Fixture check-in
   note", "Fixture message from staff", the extraction constants at
   `pageRender.test.ts:955-956`) and asserts no recorded `activity_log` write
   contains them; (c) no family or member page or `src/lib/data/(family|member)*.ts`
   names `activity_log` or `loadActivity` (shape of `autofillLaws.test.ts:127-132`);
   (d) no file names `.from("activity_log").update` or `.delete`; (e) the RLS
   suite asserts family and member read zero rows and an Admin update or
   delete affects zero rows; (f) the migration text of every function that
   inserts into `activity_log` contains no `summary := p_` assignment.

Summaries are sentences, so copyLaws does not apply; the em dash law does,
so templates use commas.

### Screens

| Screen | File | Roles |
|---|---|---|
| Profile section "Activity" | `roster/[id]/page.tsx`, after Notes; last 5; `action=` See All when more | Admin |
| `/roster/[id]/activity` | full list for the athlete | Admin |
| `/org/[slug]/activity` | org-wide, newest first, `SearchField` over summary and actor when over five, `?q=`; 50 rows then Show More like Phase 1 | owner (every Admin after 0041; decision below) |
| More | "Activity" row under Organization | same |

Athlete login and Viewer pages carry nothing (law c). Each `Row`: title the
summary, meta "actor · relative time", leading glyph by subject type from
`rowIcons.json`. Empty state "No Activity Yet". At 320 long summaries wrap
inside 200 characters.

### Tests And Laws

| Law | Plant |
|---|---|
| Every action in the call-site table writes exactly one `activity_log` row on success and none on refusal (`actionRun.test.ts` loop over recorded writes) | Remove one call; fails |
| `updateAthlete` with a status transition writes two rows, without one row | Log inside `data/enrollment.ts`; fails on double |
| A broken log write does not fail the business write (fake returns an error for `activity_log`) | Throw from `logActivity`; fails |
| The summary laws (a) to (f) above | Each planted |
| `pages.ts` entries for the two pages and the section; fixture `activity_log` rows on `IDS.athlete` with names and statuses only, none on the transfer so the empty state renders | Render law and the live "renders empty" audit |
| `qa/approved-values.json`: fixture summaries carry no birthdate, contact or school outside the approved set | Existing check |

### Existing Laws And Contract Lines This Phase Changes

| Where | Today | Becomes |
|---|---|---|
| `scripts/rls_test.sql:1170-1258` policy-shape check | | satisfied: SELECT and INSERT present, no `for all`, no exemption needed |
| `schemaLaws.test.ts:188, 275` | | core columns in a plain `create table`; every FK leads an index |
| `dataLaws.test.ts:86` a written table is read | | the two screens satisfy it; helper and reader ship together |
| `autofillLaws.test.ts:127-132` | family and member never name `athlete_notes` | plus `athlete_checkins` and `activity_log` |
| `docs/BUSINESS_RULES.md`, `docs/ARCHITECTURE.md` | | new "Activity log" rule: who reads, what a summary may carry |
| `docs/DECISIONS.md` | | entry: append only, security-definer family path, template summaries |
| `migrationLaws.test.ts` | | 0044 carries no data |

### Risks

- Double logging through shared data helpers; log at the action layer only.
- Failure coupling; swallow and warn.
- Volume from bulk assign and CSV import; one row per athlete, none per fit recompute.
- Actor names come from `users` via `users_in_my_orgs` (0031), readable to Admins only.
- Build order: if Phase 6 lands after 4 or 5, their RPCs need a follow-up migration to add the log insert.

### Open Questions For Tony

1. Org-wide Activity: spec says owner; after 0041 that is every Admin. Recommend every Admin (there is no narrower level).
2. Family athlete page shows none of it (recommended, per spec).
3. Also log `document_deleted`, `note_added`, `title_set`, `metric_logged`, contact and visit events: recommend not now; the enum stays open.
4. Search scope: summary plus actor text (recommended) versus filter chips by action and athlete.
5. Retention: append only forever (recommended); the service role is covered by the code law, not by a grant.

---

## Branch And Delivery Plan

| Phase | Branch | Migrations | Depends on | Merge order |
|---|---|---|---|---|
| 0 | none (done, `ca02966`; rewritten again at Stage 3) | | | |
| 1 | `claude/stage5-matches` | 0042 | roles merge | 1 |
| 2 | `claude/stage5-advisor` | 0043 | roles merge | 2 |
| 3 | `claude/stage5-more` | none | 2 (Advisors list) | 3 |
| 6 | `claude/stage5-activity` | 0044 | 3 (More row) | 4 |
| 4 | `claude/stage5-assignments` | 0045, 0046 | 3, 6 (log inside the RPC) | 5 |
| 5 | `claude/stage5-view-as` | 0047 | 3, 6 (start and end write the log); tested against 4 so a viewed Athlete login shows assignments | 6 |

Rules for every branch:

1. Cut from main after `claude/roles-admin-viewer-titles` merges. Migration
   numbers above are provisional in merge order; a branch renumbers on
   rebase if the order changes, and `scripts/run_rls_test.sh` lists every file.
2. Vercel preview per branch; the preview URL goes in the Stage 3 report.
3. QA gate green before the report: `npm run typecheck`, `npm test`,
   `npm run build`, `scripts/run_rls_test.sh` (real Postgres with the auth
   stub), `scripts/build_previews.sh` (audit exit code and findings),
   `scripts/live/check.sh` (drive, clickable, links at 320, 375, 390, both
   themes). Every SQL migration tested against real Postgres before it is called done.
4. Walk the preview at 320, 375 and 390, light and dark, as every role the
   phase touches (Admin always; Athlete login for 1, 4, 5; Viewer for 5 and
   to prove nothing changed for 3, 4, 6). Screenshots at 390 light and dark
   per screen into the QA report.
5. No artifact preview publish (Dave, 2026-09-26). `build_previews.sh` still runs as the audit.
6. STOP before merge. Tony reviews, Dave gives the go. Migrations apply to
   production only at merge, in file order, through the Supabase project,
   and the roles migration 0041 must already be there.
7. Each phase commits its DECISIONS.md entry, law README items and the
   contract amendments in the same branch. CURRENT_STATE.md is replaced
   once at Stage 3, not per phase.
8. Sequencing hazards: Phase 3's rows for Assignments, View As and Activity
   are added by those phases, never ahead of their pages. Phase 5 writes
   Phase 6's log and is tested with Phase 4's family screens under RLS.
   Phase 4's RPC logs inside its body, so 0044 precedes 0046.

## Global Rules Restated

- Kit only; no page styles itself; kitLaws pass.
- Every new table: `org_id`, RLS on, coherence trigger from the 0039
  pattern, planted-to-fail cases in `scripts/rls_test.sql` for Admin
  (owner), a leftover staff row, Athlete login (family), Viewer (member),
  and a second org.
- Viewer (member) reads nothing from any new table or column: `net_cost`,
  `advisor_assigned_at`, `assignments`, `view_as_sessions`, `activity_log`
  are all behind `_member_org_ids()`, `_staff_org_ids()` or owner helpers,
  and the suite asserts zero rows.
- Minors: synthetic test data only, name and role only, inside `qa/approved-values.json`.
- No em dashes anywhere: code, comments, strings, docs, SQL, templates.
- Title Case on every title, label, button, chip, tab; sentences stay sentences.
- Migrations from 0040 on carry no data; enum additions get their own file.
- No Doc AI call in any phase; `ANTHROPIC_API_KEY` never set.
- No real token for another user is minted without Tony's written sign-off on that design.
- Never push, and never merge, unless Dave says "push" or "go" in that session.

## Decisions For Tony, Collected

| # | Phase | Question | Recommendation |
|---|---|---|---|
| 1 | 1 | Partial label denominator | "N of M", M from the row |
| 2 | 1 | Target button text | "Add Target" |
| 3 | 1 | Net cost stored or computed | Stored, 0042 |
| 4 | 1 | Family Matches gets search and sort | Yes |
| 5 | 2 | "Owner only" Add Staff Member | Every Admin; no narrower level exists |
| 6 | 2 | Preset role | owner (Admin) |
| 7 | 2 | Button wording | "Add Admin" (Dave's call) |
| 8 | 2 | Recency source | Trigger-stamped column |
| 9 | 2 | Advisor select on Edit | Remove |
| 10 | 3 | Program > Assignments target | Org-wide list from Phase 4 |
| 11 | 4 | Family upload status | new `doc_status 'filed'` |
| 12 | 4 | Family opens its own upload | No |
| 13 | 4 | Due soon window | 7 days |
| 14 | 4 | Cancelled rows on the family screen | Hidden |
| 15 | 5 | Mechanism | D2 (helpers on effective uid, writes gated, equivalence loop); A not built |
| 16 | 5 | Targets | Athlete login, Viewer, and other Admins |
| 17 | 5 | Switch scope | Account-wide row, 30 minutes |
| 18 | 5 | Banner | In flow at top of Chrome, also on `/` and `/unauthorized` |
| 19 | 6 | Org-wide Activity reader | Every Admin |
| 20 | 6 | Extra events | Not now |
| 21 | all | Build order | 1, 2, 3, 6, 4, 5 |

## Sign-Off

Tony: [ ] approved / [ ] changes requested

Notes:

Dave: go / hold (date):
