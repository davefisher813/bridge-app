# Current state

Last updated: 2026-09-19.
Replaced wholesale when this changes meaningfully, never appended to.

**One-line summary.** Every screen in the approved prototype exists in the
real app, every page and every server action is executed by a test, and
as of 2026-09-19 the schema is live on a real Supabase project with both
orgs seeded and an owner account created.

---

## What exists

**50 pages**, 15 migrations, 585 tests, 10 law files.

### Recruiting

The core of the product and the part that would lift out into a
standalone app. `src/lib/fit/` is walled off from Next and Supabase and
scores a target on four dimensions with a shared result shape, where a
veto overrides the blend rather than averaging into it.

Screens: roster and athlete profile, the board grouped by stage, a target
read view with its score broken down, one dimension in full, the contact
log, the school list and a school profile. Add and edit for athletes,
targets and schools.

**NCAA eligibility** is researched rather than recalled, cited in
docs/BUSINESS_RULES.md against NCAA-published documents, which found the
app's original GPA maths wrong in five ways at once. Core-course GPA,
qualifier status, the D1 10/7 rule, the age-based five-year clock.
Screens: the verdict, the transcript, per-course approvals, and the
caveats in full.

**Grading scales and approved-course lists** are the two inputs that make
a core GPA real rather than assumed. Both use the same shape: shared
reference data behind the service role, plus an org-scoped table the org
writes itself, shared row winning. A partial approved list can confirm a
course and never exclude one, which is the distinction the whole module
exists for.

### Fundraising (module-gated, off by default)

Gifts, pledges, donors, campaigns, grants, budget. Modelled on Bridge's
own P&L rather than a guess. Three rules hold throughout and each one
makes a board report quietly wrong if it slips: a pledge is never inside
a total, in-kind is support and never cash, and integer cents everywhere.

### Board governance (module-gated, off by default)

Boards, seats, give/get. From Bridge's governance document: five tiers
with an amount each. Both halves of give/get count, which most board
software gets wrong by recording only personal giving. A gift somebody
both made and solicited counts once.

### Doc AI

Ingest, triage, extraction, Zod validation, roster matching, confidence,
routing, versioning, undo. Runs end to end today on a scripted stand-in
model, and every screen showing a result says so.

---

## How it is verified

Six layers, and each exists because something got through the ones above
it.

1. **Unit tests** over the pure modules.
2. **Laws** (`src/laws/`, 10 files) encode the rules from CLAUDE.md and
   BUSINESS_RULES.md as executable checks. Every law is planted, watched
   to fail, and reverted before it counts.
3. **The RLS suite** (`scripts/run_rls_test.sh`) applies all 15
   migrations to a real Postgres and runs ~70 assertions as a
   non-superuser role: cross-org reads, cross-org writes, member versus
   staff, anonymous sessions, and a structural check that every
   org-scoped table separates read-by-member from write-by-staff.
4. **The page render harness** (`src/laws/pageRender.test.ts`) executes
   all 33 read screens and 15 form screens against a fake client and an
   invented fixture. Nothing had ever run a page before this.
5. **The action harness** (`src/laws/actionRun.test.ts`) executes the
   server actions and asserts what they wrote: the org stamp, the role
   check, the module gate, the cross-org foreign-key guard, the error
   branch, and the revalidate.
6. **The click-through prototype and its audit** (`scripts/`) bundle the
   shipped engine modules into a tappable app on invented data, walk
   every screen in headless Chromium, and inspect what the browser
   COMPUTED in both themes and both orgs: contrast, touch targets,
   unresolved classes, sideways scroll.

---

## The live database

Supabase project `Bridge-app` (ref `emllcefqxyxyhqolrllo`, us-west-2),
in Dave's own Supabase organization. Applied 2026-09-19.

- All 15 migrations. 27 tables, row level security on every one of them,
  84 policies.
- Both orgs seeded. Bridge (slug `bridge`) with board governance and
  donor fundraising on, Elite Squad NY (slug `elite-squad`) with both
  off, which is the shape an ordinary travel org gets by default.
- One account: dave@bffsa.org, owner of both orgs, email pre-confirmed,
  no password (magic link). Created by SQL because `org_members` has no
  INSERT policy on purpose, so the first member cannot be created any
  other way.
- Supabase's security advisor is clean apart from one Auth dashboard
  setting (leaked-password protection, off), which does not apply while
  sign-in is by magic link.

Migration 0015 exists because of this project. Applying the schema to a
real Supabase instance surfaced something local Postgres structurally
cannot: PostgREST publishes every function in an exposed schema as an
RPC endpoint, so both SECURITY DEFINER membership helpers were answering
HTTP requests from anon. They now live in an unexposed `private` schema,
and `scripts/rls_test.sql` asserts they stayed there.

No real athlete, donor or board record is in this database. It holds two
org rows and one account.

---

## What does not exist

### Blocked on Dave

- **No deployment, no environment file, no git remote.** Local commits
  only, per the never-push-without-a-word rule. The database exists but
  no running app has ever connected to it, so the auth flow is still
  structurally verified rather than exercised: nobody has signed in.
- **No API key for Doc AI**, so the model caller is a stand-in. Wiring a
  real one also needs a per-org budget store, since Bridge's
  localStorage-based tracking does not carry to a multi-tenant server.
- **The name.** "recruiting-platform" is a placeholder Dave has never
  confirmed.

### Known and deliberate

- **`org_members` has no INSERT policy.** Membership grants access to
  everything else and the row carries its own `role`, so a policy keyed
  off staff would let a staff member write themselves in as owner. When
  an invitation flow exists it belongs behind the service role or a
  SECURITY DEFINER function that cannot be handed a role. Recorded in
  docs/DECISIONS.md and exempted by name in the RLS suite.
- **`schools` is writable only by the service role**, with
  `requireOwner()` as the actual gate. Schools are shared reference data
  across orgs.

### Not yet done, not blocked

- The fake client covers the subset of the query builder the app uses and
  throws on anything else. `.or()` and `.ilike()` are unimplemented; one
  action uses each.
- A real rendering harness against a seeded Postgres would catch what the
  fake cannot, which is anything PostgREST does differently from the
  fake's approximation of it.

---

## Immediate next steps

See docs/ROADMAP.md. The prototype-to-app gap list is empty as of
2026-09-17; what remains there is not screens.
