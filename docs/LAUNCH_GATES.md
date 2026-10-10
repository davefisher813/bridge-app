# Launch gates: engineering items

Status of the engineering gates that do not need Dave's decision, checked
2026-10-05 against production (Supabase project emllcefqxyxyhqolrllo, Vercel
project commit-app, https://commit-app-nu.vercel.app). Facts here were read
from production or from the code; anything not checked says so.

## 1. Test data cleanup: done

Removed from production, after a guarded dry check of every id:

- The three soft-deleted test athletes (AUDIT TEST, TEST AlfredQA, Alfred
  Test Athlete), their 21 activity entries, 2 test assignments, 1 metric and
  1 read marker.
- Two test donors in Bridge ("AUDIT TEST", "TEST Alfred QA Donor"). Neither
  had a gift or pledge.

Verified after: no removed athletes left, Bridge has 32 live athletes, Elite
Squad has 0, no row anywhere matches the test names (a name search across
every text and jsonb column, with the real schools "Alfred State" and
"Alfred University" and the real coach "Alfredo Carrillo" correctly left
alone). The two Sept 26 backup tables are still there.

Left alone on purpose, needs Dave: five activity entries on a REAL athlete
(Jeremias Perez) from the Oct 1 audit: a St. John's target added, moved and
removed, and a test assignment created and cancelled. They are accurate
history of test actions on a real record. Dave declined to authorize the
delete. One of those two assignment entries now points at an assignment row
that was removed in this cleanup (a test row titled "AUDIT TEST - safe to
delete" on that athlete).

The 17 Doc AI usage rows are real spend and stay (they count toward the
monthly budget).

## 2. Oct 2 QA upload check: clean

- `documents`: 0 rows. `storage.objects` in the documents bucket: 0. The QA
  uploads (2 in Bridge on Oct 2, 8 in Elite Squad on Oct 3) were deleted or
  discarded.
- `athlete_courses`: 0 rows ever, so no transcript was applied anywhere.
- No real athlete's record was touched since Sept 30. The only athlete
  changed after that is the one added by the sheet import on Oct 3, with no
  GPA and no test scores.
- Every Oct 1 to 3 edit in the activity log was on a test athlete.

## 3. Backups: daily backups on (Pro plan); PITR unconfirmed

Update 2026-10-10: the Supabase organization is on the Pro plan, which
includes daily backups. Point in time recovery is a separate add-on and
is still unconfirmed.


- Write-ahead-log archiving is on and current (487 segments, last archived
  2026-10-05 00:29 UTC). That is the mechanism backups and point-in-time
  recovery sit on, but it does not say which of them is switched on.
- The tools available to this session do not expose the plan, the backup
  schedule or PITR, and the organization lookup was refused (no permission).
  There are no database branches.
- Needs Dave, in the Supabase dashboard: Project Settings, Database,
  Backups. Confirm the plan includes daily backups and turn on PITR if the
  plan offers it. Until that is confirmed, treat the database as having no
  restore point.

## 4. Email configuration: default mailer, rate limit already hit

From production auth logs (last 24 hours), not from a settings screen:

- Mail sender: `noreply@mail.app.supabase.io`. That is Supabase's built-in
  mailer. Custom SMTP is NOT configured.
- 6 sign-in link requests: 2 sent, 4 refused with `over_email_send_rate_limit`
  (429). The built-in mailer allows only a few emails an hour for the whole
  project, so a handful of parent invitations on launch day would hit it.
- 7 logins in the window, all by password (plus token refreshes). No link was
  verified in the window (no call to the verify endpoint), so a sign-in from a
  link in a real inbox is not proven in production yet.

Could not read, needs Dave in Supabase, Authentication:
- URL Configuration: the Site URL, and whether the Redirect URLs list
  contains `https://commit-app-nu.vercel.app/**`. (This session's network
  policy blocks direct calls to supabase.co, so the auth settings could not
  be probed from outside either.)
- Email Templates: the Magic Link and Invite templates should link to
  `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink`
  (and `type=invite`). The callback reads that shape or a `?code=`. The
  default template link puts the session in the address after a `#`, which
  a server cannot read, so an invitation sent with the default template
  would fail on first sign-in.
- SMTP Settings: custom SMTP needs Dave's credentials (Resend, Postmark and
  similar). Not set up here, as instructed.

Fixed in code: when Supabase refuses to send, the person used to see
"email rate limit exceeded". They now see "Too many sign-in emails were sent
in a short time. Wait a few minutes and ask again." (sign-in link, resend,
invitation).

## 5. Account lifecycle: works in code, not provable end to end here

Tested in the repo (fixture harness, no email sent): see
`src/laws/lifecycleLaws.test.ts`, `src/laws/actionRun.test.ts`,
`src/laws/otherActions.test.ts` and `e2e/login.spec.ts`.

| Step | Result |
| --- | --- |
| Invitation sent | Passes. Link points at `/auth/callback` on the configured production address. |
| First sign-in | Passes for invite, magic link, recovery, email and signup links, and for a `?code=`. |
| Expired invitation | Passes. Lands on sign-in with "That sign-in link is not valid any more. Ask for a new one." and a new link works for an account that exists. |
| Password recovery | There is no reset-password screen. Recovery is the emailed sign-in link ("Email Me a Link Instead"), which works for accounts with a password. The app has no way to set or change a password. |
| Sign-out | Passes. Ends the session, lands on sign-in. |
| Revoked access | Passes. Removing a member removes the membership, their athlete links and their advisor assignments; every Admin, Viewer and Athlete screen then refuses them. The only Admin cannot be removed. |
| Mailer refusal | Fixed (item 4). |

Not proven, and why:
- A real invitation email delivered and tapped, because of the template and
  redirect questions in item 4. This is the biggest open lifecycle risk and
  the first thing to try in the real-account test below.
- A removed person's existing browser session. Their data access ends at
  once (every policy reads the membership), but their sign-in itself is not
  ended; they land on the "not a member of any organization" screen.

## Security check (not asked for, read from production)

- Row level security is ON for all 35 data tables. The Supabase security
  advisor reports no table without it.
- Six functions run with elevated rights and are callable by signed-in users
  (`create_org`, `log_family_message`, `member_giving`, `member_program`,
  `member_program_schools`, `submit_assignment`). That is by design. The
  bodies were read: each checks the caller's membership or athlete link
  before returning anything, and `create_org` has its own refusals.
- The anon role has table grants (Supabase's default) but every table has
  row level security on, so it reads nothing without a policy that allows it.

## 6. Real-account access test: plan (needs Dave's approval to run)

Goal: prove, against production, that each role sees only what it should,
using accounts that belong to no real family and a synthetic athlete.

Rule: no real minor's data is used. The role tests run in a separate test
organization. The same accounts are then used as outsiders to Bridge, which
must return nothing.

Accounts (Dave's own mailboxes; a `+` address delivers to the same inbox):

| Role | Example address | Where it belongs |
| --- | --- | --- |
| Admin | dave+access-admin@... | Owner of the test org |
| Advisor (Admin who advises) | dave+access-advisor@... | Admin in the test org, assigned the synthetic athlete |
| Viewer | dave+access-viewer@... | Viewer in the test org |
| Athlete login | dave+access-athlete@... | Athlete login linked to the synthetic athlete only |

Setup (in the app, as Dave, about ten minutes):

1. More, Start Another Organization: "Access Test" (slug `access-test`).
2. Add Athlete: "Test Athlete (synthetic)". Add one note, one donor
   ("Test Donor") under Fundraising if the module is on.
3. Members, Invite: the four addresses above with the roles in the table;
   open each invitation email on the iPhone and finish the sign-in. This is
   the real first-sign-in test (item 5, item 4).
4. Set the advisor account as the athlete's Advisor from the athlete page.

Checks by role (UI, on the iPhone, one role at a time):

| Check | Admin | Advisor | Viewer | Athlete |
| --- | --- | --- | --- | --- |
| Lands on the right home after sign-in | Today | Today | Home | Athlete page |
| Sees the synthetic athlete | yes | yes | name and stage only | yes, own only |
| Sees notes, donors, giving detail | yes | yes | no | no |
| Can edit the athlete | yes | yes | no | no |
| Opens `/org/bridge` | Nothing Here | Nothing Here | Nothing Here | Nothing Here |
| Opens `/org/access-test/members` | yes | yes | refused | refused |
| After removal, any screen of the org | refused | refused | refused | refused |

Checks at the database (the part the screens cannot prove). A probe script,
`scripts/access/probe.mjs`, signs in as each test account and tries reads
and writes straight against the API with that account's own session:

- With no environment set it prints the plan and exits (dry run).
- It refuses to run unless `CONFIRM_PROD_ACCESS_TEST=yes` is set, and it
  only ever touches the test org's id and, read-only, Bridge's id.
- It needs the project URL, the publishable key and the service role key in
  the environment of whoever runs it. The service role key is used only to
  mint a sign-in for each test address. It is never printed or stored.
- Expected: every table returns zero rows for Bridge to all four accounts;
  Admin reads the synthetic data; Viewer and Athlete read no notes, donors
  or gifts; Viewer reads nothing from `athletes` directly but gets the
  program summary function; Athlete reads exactly its one athlete; every
  write by Viewer or Athlete is refused; a signed-out client reads nothing.

Teardown, after the test (also needs Dave's word): delete the
`access-test` organization (its rows cascade), remove the four test users in
Supabase, Authentication, Users.

Needs Dave: approval to run the above, and the mailboxes. The probe cannot
be run from this session at all (outbound calls to supabase.co are blocked
by the session's network policy), so it runs on Dave's computer or in a CI
job that holds the keys.

## Needs Dave (collected)

1. Backups: daily backups confirmed by the Pro plan; PITR is optional and unconfirmed (item 3).
2. Supabase Authentication: Site URL, Redirect URLs with the production
   address, Magic Link and Invite templates in token-hash form (item 4).
3. Custom SMTP credentials, so invitations and sign-in links stop hitting
   the built-in limit (item 4).
4. Whether the five Oct 1 test entries on Jeremias Perez's activity page may
   be deleted (item 1).
5. Dropping the two Sept 26 backup tables (his word).
6. Approval and mailboxes for the real-account test (item 6).
7. Done 2026-10-10: `dave@bffsa.org` is a Bridge Admin. The Gmail account
   is still on Bridge until Dave removes it in Members.
