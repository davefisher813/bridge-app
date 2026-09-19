# Setup checklist: what Dave has to do

Written 2026-09-19. Two things, both on an iPhone, both about ten
minutes. Everything else Claude does itself.

An earlier version of this file asked Dave to supply a name, a database
and an owner email. That was wrong: those are decisions, and making
decisions is not Dave's job here. They are decided below, with defaults
that hold unless Dave says otherwise.

---

## Decisions already made, no action needed

**Name.** Recommended: **Commit**. It is the word the whole product
turns on, it reads right for a nonprofit and for a travel baseball org,
and it is short enough to live in a domain. Alternates offered: Verbal,
Signing Day. If Dave says nothing, Commit is what gets used and it can
still be changed before anything is deployed.

**Database.** The existing empty `Bridge-app` Supabase project
(us-west-2, created 2026-09-18, zero tables). It is already paid for and
already empty, so it costs nothing and risks nothing. Not a new project,
which might push the account to a paid tier.

**Owner account.** dave@bffsa.org, confirmed by Dave 2026-09-19. The
address on the Claude account is an iCloud one he does not use; do not
reach for it again.

**Push.** Nothing is pushed anywhere until Dave says "push" or "go".
That rule does not change.

## What Claude does, once Dave says go

1. Apply the 14 migrations to `Bridge-app`.
2. Seed the Bridge org with its module flags and role labels.
3. Create the owner account and membership row.
4. Read back the Supabase URL and publishable key.
5. Create the Vercel project and deploy.
6. Report what the database actually contains, screen by screen.

---

## Task 1: make the GitHub repo

Ten taps. Safari on the iPhone is fine, the app works too.

1. Open **github.com** and sign in.
2. Tap the **+** at the top right, then **New repository**.
3. Repository name: **commit-app** (or whatever the name ends up being).
4. Select **Private**.
5. Leave **Add a README**, **.gitignore** and **license** all OFF. Any
   one of them causes a conflict on the first push.
6. Tap **Create repository**.
7. Copy the URL from the address bar and paste it into the chat.

Then one of two things, Dave's pick:

- Connect a GitHub connector to the Claude session, and Claude pushes
  the nine commits itself.
- Ask Claude for a git bundle, a single file holding the whole repo and
  its history, which gets pushed from a computer later.

Claude cannot create a GitHub repo or push to one from here. There is no
GitHub tool connected and no `gh` command in this environment.

## Task 2: copy the service role key into Vercel

Only after Claude has created the Vercel project, so this one waits.

1. **supabase.com** on the phone, sign in, open the **Bridge-app**
   project.
2. **Project Settings**, then **API**.
3. Under **Project API keys**, find **service_role**. Tap **Reveal**,
   then copy it.
4. **vercel.com**, open the project, **Settings**, then **Environment
   Variables**.
5. Name: `SUPABASE_SERVICE_ROLE_KEY`. Value: paste. Save.

Do not paste that key into the chat and do not put it in the repo. It
bypasses every row-level security policy in the database, which means it
can read and write every org's data regardless of who is signed in.

The other two variables, `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, are not secret. Claude reads them out of
Supabase and sets them.

## Later, not now: the Anthropic API key

Doc AI runs on a scripted stand-in model today and every screen showing
a result says so. The app works without this.

When it is wanted: **console.anthropic.com**, create an API key, add it
in Vercel as `ANTHROPIC_API_KEY`.

One thing is owed first and it is Claude's work, not Dave's: a per-org
spending budget. Bridge's original version tracked spend in the
browser's localStorage, which does not survive a multi-tenant server, so
a budget table and a caller that refuses to run past it have to exist
before a real key is wired in. About a session.

## Later, not now: the domain

A subdomain of the BFFSA domain, or its own. Added in Vercel once the
deploy is live. Not blocking anything.
