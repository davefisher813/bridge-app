# Current state

Last updated: 2026-09-19, evening.
Replaced wholesale when this changes meaningfully, never appended to.

**One-line summary.** The app is deployed and signed into for the first
time. The code is on GitHub, production is on Vercel, the schema is live
on Supabase with both orgs seeded, and the first day of real
infrastructure found four things the six local layers could not: an
upload path that could never carry a real scan, a profile table nothing
wrote to, nineteen unindexed foreign keys, and no way for a second
person to get in.

---

## Where everything is

- **Code:** `github.com/davefisher813/bridge-app`, branch `main`. The
  repo name is a stand-in like the product name; GitHub redirects after
  a rename, and Vercel tracks the repo by id.
- **Production:** Vercel project `commit-app`, URL
  `https://commit-app-nu.vercel.app`, deployed from `main`. Vercel
  Authentication is off; the app's own sign-in is the gate.
- **Database:** Supabase project `Bridge-app` (ref `emllcefqxyxyhqolrllo`,
  us-west-2). 17 migrations applied. 27 tables, RLS on every one, 84 table
  policies plus 3 on the `documents` storage bucket.
- **Accounts:** dave@bffsa.org, owner of both orgs, signs in with a
  password today. Magic link is built and becomes the default once the
  sign-in screen ships (see below).

## What exists

**50 pages**, 17 migrations, 617 tests in 42 files, 10 law files.

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
docs/BUSINESS_RULES.md against NCAA-published documents. Core-course GPA,
qualifier status, the D1 10/7 rule, the age-based five-year clock.
Screens: the verdict, the transcript, per-course approvals, the caveats.

**Grading scales and approved-course lists** are the two inputs that make
a core GPA real rather than assumed. Shared reference data behind the
service role, plus an org-scoped table the org writes itself.

### Fundraising and board governance (module-gated, off by default)

Gifts, pledges, donors, campaigns, grants, budget; boards, seats,
give/get. Bridge has both on, Elite Squad neither.

### Doc AI

Ingest in the browser, upload to a private Storage bucket under the
org's folder, then triage, extraction, Zod validation, roster matching,
confidence, routing, versioning, undo on the server. Runs end to end on
a scripted stand-in model, and every screen showing a result says so.

### Around the pages

Error, not-found and loading screens at the root and inside the org
chrome. Viewport and Apple web app metadata, a manifest, and icons
generated at build from the stylesheet's own tokens, so Add to Home
Screen on an iPhone installs a dark, chromeless app.

### Membership, half built

The actions exist and are tested: an owner invites by email (an existing
account is added directly, a new address gets Supabase's invitation),
changes a role, removes a membership, and can never leave the org
without an owner. `sendMagicLink` and `/auth/callback` exist. The
members screen and the magic link sign-in form are drawn in a preview
and wait on Dave's reaction before their code is written, per CLAUDE.md.

---

## How it is verified

Seven layers, and each exists because something got through the ones
above it.

1. **Unit tests** over the pure modules.
2. **Laws** (`src/laws/`, 10 files) encode the rules from CLAUDE.md and
   BUSINESS_RULES.md as executable checks, each planted, watched to fail,
   and reverted before it counts. New today: every foreign key is the
   leading column of an index; no server action accepts file bytes.
3. **The RLS suite** (`scripts/run_rls_test.sh`) applies all 17
   migrations to a real Postgres and runs its assertions as a
   non-superuser role, now including the profile trigger and the storage
   bucket's policies.
4. **The page render harness** executes every page, plus the error,
   not-found and loading screens, against a fake client.
5. **The action harness** executes every server action and asserts what
   it wrote, including the Storage read-back, the membership writes and
   the auth callback's redirects.
6. **The click-through prototype and its audit** walk every screen in
   headless Chromium and inspect what the browser computed.
7. **The real project.** Supabase's advisors and a real deployment found
   what none of the above could. Both advisors are clean apart from one
   Auth setting listed under "Owed by Dave".

---

## What does not exist

### Owed by Dave (dashboard settings no tool here can reach)

- **`SUPABASE_SERVICE_ROLE_KEY` on Vercel.** Without it, invites, role
  changes, removals and the schools admin form refuse with a message
  saying so. docs/SETUP_CHECKLIST.md has the steps.
- **Supabase Auth URL configuration.** Site URL and the redirect
  allowlist must include `https://commit-app-nu.vercel.app/auth/callback`
  or magic links and invitations bounce to localhost. The magic link
  and invite email templates should link with `token_hash` rather than
  the default confirmation URL so a link opened in Mail on an iPhone
  works. Steps in docs/SETUP_CHECKLIST.md.
- **Leaked-password protection** in Supabase Auth, now relevant because
  a password exists. One toggle.

### Blocked on Dave

- **No API key for Doc AI.** The model caller is a stand-in. Note that
  `isStubbedModel()` keys off `ANTHROPIC_API_KEY` while no real
  `ModelCaller` exists: setting the key alone would hide the stand-in
  notice without changing what runs. Wire the caller first.
- **The name.** "recruiting-platform", "commit-app" and "bridge-app" all
  appear; none is confirmed.

### Known and deliberate

- **`org_members` has no write policy.** Every membership write goes
  through the service role behind `requireOwner()`. See
  docs/DECISIONS.md.
- **`schools` is writable only by the service role**, with
  `requireOwner()` as the actual gate.

### Not yet done, not blocked

- The database has no schools, no transfer windows and no benchmark
  sets. Until schools exist the board and Today are empty by
  construction; a CSV import is the next piece of work.
- `benchmark_sets` is never read; athletic scoring uses the tables in
  `src/lib/fit/benchmarks.ts`.
- No search or filter on any list.
- The light theme exists in `globals.css` and is unreachable: the org
  layout forces dark.
- The fake client does not implement `.or()` or `.ilike()`; one action
  uses each.
- `middleware.ts` is the deprecated name in Next 16; rename to
  `proxy.ts`.
- `@supabase/ssr` 0.5 and `zod` 3 are both a major behind.

---

## Immediate next steps

1. Dave reacts to the members preview; the members screen and the magic
   link sign-in form get built, on the actions that already exist.
2. Dave sets the three dashboard items above.
3. School CSV import, so the board has something to target.
4. Cleanup pass: one page loader, `cache()` on the org and user lookups,
   shared icons, split `documents.ts`, then the `@supabase/ssr` and `zod`
   bumps.

See docs/ROADMAP.md for the rest.
