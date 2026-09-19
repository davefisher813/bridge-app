# Handoff to Claude Code

For a fresh Claude Code session on Dave's Windows machine. Written
2026-09-19 by the Cowork session that built this.

Dave does not want to run scripts or click through dashboards. Take this
end to end and report back in plain language. Read `CLAUDE.md` at the
repo root first; it is the contract for everything below.

---

## Where the code is

`C:\Users\davef\Downloads\commit-app.bundle` is the entire repository
with all 67 commits of history. Nothing is lost and nothing is elsewhere:
the Cowork session built this in an ephemeral cloud container that no
longer needs to exist.

```
cd C:\Users\davef\code            # or wherever Dave keeps repos
git clone "C:\Users\davef\Downloads\commit-app.bundle" commit-app
cd commit-app
npm install
```

Verify before doing anything else. All three should be clean:

```
npm run typecheck
npm test          # 585 tests, 41 files
npm run build
```

Also in Downloads is `push-to-github.bat`. Ignore it and delete it. Dave
did not ask for it and it is not how he pushes.

## What already exists, so do not rebuild it

**Supabase.** Project `Bridge-app`, ref `emllcefqxyxyhqolrllo`, us-west-2,
in Dave's own Supabase org. Live and populated as of 2026-09-19:

- All 15 migrations applied. 27 tables, row level security on every one,
  84 policies.
- Two orgs seeded: Bridge (slug `bridge`, board governance and donor
  fundraising on) and Elite Squad NY (slug `elite-squad`, both off).
- One account: dave@bffsa.org, owner of both orgs, email pre-confirmed,
  no password, magic link. Created by SQL because `org_members` has no
  INSERT policy by design.
- Security advisor clean apart from leaked-password protection being off,
  which does not apply to magic link sign-in.

**Vercel.** Project `commit-app`, id `prj_Nqm2BxgyLmwYvHAA4Rkdl4COLHx7`,
team `team_jvvcxkhz7IWcPft97OKSRTu4` (scope
`davefisher813-3685s-projects`). Framework nextjs, Node 24. No deployment
yet, no git repo connected.

Already set on it for production, preview and development:

```
NEXT_PUBLIC_SUPABASE_URL       https://emllcefqxyxyhqolrllo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  (the anon key, already in place)
```

Still missing: `SUPABASE_SERVICE_ROLE_KEY`. Get it from the Supabase
dashboard under Project Settings, API, and set it with the Vercel CLI or
have Dave paste it. It must never be committed, never printed into chat,
and never written to a file in the repo. It bypasses every RLS policy in
the database.

## What to do

1. **Push to GitHub.** Private repo named `commit-app` under Dave's
   account, however he normally does it. `gh repo create` if the GitHub
   CLI is authenticated there. Empty repo, no README or .gitignore or
   license, then push `main`.
2. **Connect the repo to the existing Vercel project.** Do not create a
   second Vercel project; `commit-app` already exists with the env vars
   on it.
3. **Set `SUPABASE_SERVICE_ROLE_KEY`** on that project.
4. **Deploy to production.**
5. **Turn off Vercel Authentication** once sign-in is confirmed working.
   It is currently on (`all_except_custom_domains`), so the deployment
   URL asks for a Vercel login before it will open, which will otherwise
   look like the app is broken.
6. **Add the Supabase auth redirect URLs** for the deployed domain, or
   the magic link will bounce to localhost.
7. **Actually sign in as dave@bffsa.org and walk the app.** This is the
   important step. Every test so far ran against a fake Supabase client
   (`src/testing/fakeSupabase.ts`), which approximates PostgREST rather
   than being it. Expect embed-shape and column-name surprises on real
   data, and fix them with a test that would have caught them.

## Things that will bite

- **The fake client is not PostgREST.** Many-to-one embeds come back as
  an object, one-to-many as an array. `src/laws/pageRender.test.ts`
  exercises all 33 read screens and 15 forms against the fake; a screen
  that renders there can still throw against the real API.
- **`.or()` and `.ilike()` are unimplemented in the fake** and one server
  action uses each. Those two paths have never executed.
- **The database is empty of real records.** Two org rows and one
  account. Every screen will be an empty state until something is
  entered. That is correct, not a bug.
- **`org_members` has no INSERT policy on purpose.** Adding a person is a
  service-role operation until an invitation flow exists. Do not "fix"
  this with a policy keyed off staff: a staff member could then write
  themselves in as owner. See docs/DECISIONS.md.
- **Migration 0015 exists because a real Supabase project found what
  local Postgres could not.** PostgREST publishes every function in an
  exposed schema as an RPC endpoint, so both SECURITY DEFINER membership
  helpers were answering HTTP from anon. They now live in an unexposed
  `private` schema and `scripts/rls_test.sql` asserts they stayed there.
  Keep that in mind before adding a helper to `public`.

## Rules that are not negotiable

From `CLAUDE.md`, the ones easiest to trip over:

- No em dashes anywhere, including comments and strings. Enforced by
  `src/laws/laws.test.ts`.
- Never commit secrets.
- Every new hard rule becomes a law in `src/laws/`, and the law gets
  planted, watched to fail, and reverted before it counts.
- Every migration is tested against a real Postgres before it is done.
  `scripts/run_rls_test.sh` does this and needs a local Postgres.
- A new screen gets a visual preview Dave approves before its real code
  is written.
- No real athlete, donor or board record goes into a prototype, a
  fixture, or the repo. Every name in there is invented.

## The name

`recruiting-platform` is the repo's working name and has never been
confirmed. The Cowork session recommended **Commit** and used it for the
Vercel project and the suggested repo name. Dave has not said yes. It can
still change; the Supabase project keeps its own name either way.

## How Dave wants to be talked to

Short paragraphs. What happened, whether it works, what he needs to know.
No preamble, no filler, no unsolicited praise. He works from an iPhone, so
do not hand him scripts to run or dashboards to click unless there is no
alternative, and say so plainly when there is not. All caps means he is
frustrated: fix the thing, skip the explanation.
