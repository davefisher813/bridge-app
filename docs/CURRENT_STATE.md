# Current state

Last updated: 2026-09-20, after the clean slate.
Replaced wholesale when this changes meaningfully, never appended to.

**One-line summary.** Every one of the 53 screens is rebuilt on one
kit with the scale Dave selected on 2026-09-19, the laws that keep a
page from styling itself are green, the preview is the real pages
rendered on the fixture, and the deployed app is waiting on Dave's
page-by-page audit.

---

## Where everything is

- **Code:** `github.com/davefisher813/bridge-app`, branch `main`. The
  repo name is a stand-in like the product name.
- **Production:** Vercel project `commit-app`, URL
  `https://commit-app-nu.vercel.app`, deployed from `main`. Vercel
  Authentication is off; the app's own sign-in is the gate.
- **Database:** Supabase project `Bridge-app` (ref `emllcefqxyxyhqolrllo`,
  us-west-2). 18 migrations applied. 27 tables, RLS on every one.
- **Accounts:** dave@bffsa.org and davefisher813@gmail.com, both owners
  of both orgs, both with the same password. Password is the first
  screen; the magic link sits behind "Email me a link instead".

## What exists

**53 pages**, 18 migrations, 636 tests in 43 files, 11 law files.

### The kit, 2026-09-19, and the catalog picks, 2026-09-20

`src/components/kit/` is the whole vocabulary a screen has: four text
sizes, one spacing step, one radius, paper surfaces with a hairline
border, filled 16px inputs with hints instead of placeholders, outlined
secondary buttons, a confirm sheet before a delete, a fixed tab bar, a
theme that follows the phone, Title Case on every title. The contract
is docs/STYLING_CATALOG.md; `src/laws/kitLaws.test.ts` fails the build
on a page that styles anything itself. `tailwind.config.ts` replaces
the theme, so a class outside the scale does not exist. The old
catalog, the form style constants and the six preview generators are
deleted.

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
generated at build from the stylesheet's own tokens. `src/proxy.ts`
(Next 16's name for the middleware) refreshes the session.

### Membership

Owner-only, under More. The members list, an invite form, and a
one-person screen to change a role or remove access. An org can never
be left without an owner. "Invited" is read off a mirror of
`auth.users.last_sign_in_at` kept by the profile trigger.

---

## How it is verified

1. **Unit tests** over the pure modules.
2. **Laws** (`src/laws/`, 11 files) encode the rules from CLAUDE.md,
   BUSINESS_RULES.md and STYLING_CATALOG.md as executable checks, each
   planted, watched to fail, and reverted before it counts. New: the
   five kit laws.
3. **The RLS suite** (`scripts/run_rls_test.sh`) applies every migration
   to a real Postgres and runs its assertions as a non-superuser role.
4. **The page render harness** executes every page in
   `src/testing/pages.ts` against a fake client.
5. **The action harness** executes every server action and asserts what
   it wrote.
6. **The preview and its audit** render the same page list on the
   fixture into one tappable file and inspect what a browser computed on
   every screen in both themes: classes that exist, glyphs that draw, AA
   contrast on the real surface, 44px targets, no sideways scroll.
7. **The test bench** runs the shipped engine modules in a browser and
   proves its own checks.
8. **The real project.** Supabase's advisors and the deployment.

---

## What does not exist

### Owed by Dave (dashboard settings no tool here can reach)

- **Supabase Auth URL configuration** for magic links and invitations,
  and the email templates on `token_hash`. Steps in
  docs/SETUP_CHECKLIST.md. Password sign-in does not need them.
- **Leaked-password protection** in Supabase Auth. One toggle.

### Blocked on Dave

- **The page-by-page audit** of the rebuilt app on his phone, now with
  his twenty-five catalog picks applied.
- **No API key for Doc AI.** The model caller is a stand-in.
- **The name.** "BFFSA" is what the app calls itself for now.

### Known and deliberate

- **`org_members` has no write policy.** Every membership write goes
  through the service role behind `requireOwner()`.
- **`schools` is writable only by the service role**, with
  `requireOwner()` as the actual gate.
- **The preview shows fixture data and does not post forms.** What a
  render cannot show, the bench does with the real modules.

### Not yet done, not blocked

- The database has no schools, no transfer windows and no benchmark
  sets. Until schools exist the board and Today are empty by
  construction; a CSV import is the next piece of work.
- No search or filter on any list.
- The fake client does not implement `.or()` or `.ilike()`; one action
  uses each.
- `@supabase/ssr` 0.5 and `zod` 3 are both a major behind.
- A stat tile has no sub-line and a row has two lines; the few captions
  that lost a home moved into a meta line or a note beside them. Worth a
  look during the audit.

---

## Immediate next steps

1. Dave's page-by-page audit. Findings go through the kit, not the page.
2. School CSV import, so the board has something to target.
3. Cleanup pass: one page loader, `cache()` on the org and user lookups,
   split `documents.ts`, then the `@supabase/ssr` and `zod` bumps.

See docs/ROADMAP.md for the rest.
