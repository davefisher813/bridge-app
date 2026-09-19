# Setup checklist: what Dave has to do

Written 2026-09-19. Everything here is a step Claude cannot take alone,
either because it needs an account Claude has no access to, a secret
Claude must never see or store, or a product decision only Dave makes.

Ordered by what unblocks what. Steps 1 and 2 unblock everything else.

---

## What Claude found already in place

Two Supabase projects already exist in Dave's Supabase organization
(`davefisher813's Org`), read live from the connected Supabase tools on
2026-09-19:

| Project | Region | Created | Public tables |
|---|---|---|---|
| Bffsa Project | us-east-2 | 2026-03-30 | not inspected, assumed the existing BFFSA app |
| Bridge-app | us-west-2 | 2026-09-18 | zero, completely empty |

`Bridge-app` is empty. If it was created for this repo it can be used as
is. Claude did not touch either one.

## What Claude can do once told to, and what it cannot

Connected to this session, so Claude can do these itself:

- Supabase. Apply all 14 migrations, seed the Bridge org, create
  membership rows, read back the project URL and the publishable key.
- Vercel. Create the project and deploy it.

Not connected, so these are Dave's alone:

- GitHub. No GitHub tool and no `gh` CLI in this environment. Claude
  cannot create a remote or push to one.
- Any secret. The Supabase service role key and the Anthropic API key
  get pasted into a hosting dashboard by Dave, never into chat and never
  into the repo.
- The product name.

---

## 1. Confirm the name

Five minutes, and it gets more expensive every week it waits. The repo,
the Supabase project, the Vercel project and the eventual domain all
inherit whatever this ends up being. `recruiting-platform` is a
placeholder that has never been approved.

Nothing technical is blocked by this, but renaming after a deploy means
touching the domain and the OAuth redirect URLs.

## 2. Pick the database

Say which of these:

- Use the empty `Bridge-app` project.
- Have Claude create a new one, named after the answer to step 1.

Then Claude applies the 14 migrations, seeds the Bridge org with its
module flags and role labels, and reports back what the database
contains. Nothing in this repo has ever run against a real Postgres
outside a throwaway local test database, so this is the step that turns
585 passing tests into a working app.

Cost note: a second active Supabase project may move the account onto a
paid tier. Dave should check the plan before choosing "new one".

## 3. Get the first login working

After step 2, Claude needs one thing that only Dave can supply: the email
address that should be the owner account. Claude creates the `auth.users`
row and the `org_members` row with role `owner`.

`org_members` has no INSERT policy on purpose, so every member is added
by the service role until an invitation flow exists. That means adding
staff is a request to Claude, not a screen, for now.

## 4. Create the GitHub repo

Dave does this part.

1. On github.com, create a new **private** repo. Empty, no README, no
   .gitignore, no license. Any of those cause a merge conflict on the
   first push.
2. Copy the repo URL.

Then one of:

- **Connect a GitHub tool to this Claude session** (in the connectors
  list). Claude can then push the eight local commits directly.
- **Have Claude hand over a git bundle**, a single file containing the
  whole repo and its history, which Dave clones and pushes from a
  computer.

Either way, nothing gets pushed until Dave says the word "push" or "go"
in the session. That rule does not change.

## 5. Deploy

Once the repo exists, or immediately if skipping git for now, Claude
creates the Vercel project and deploys.

Dave then sets three environment variables in the Vercel dashboard
(Project Settings, Environment Variables). Two of them Claude can read
out of Supabase and tell Dave; the third is a secret Dave copies himself:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Claude reads it from Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Claude reads it from Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard, Project Settings, API. Dave pastes it straight into Vercel. Never into chat, never into the repo. |

The service role key bypasses every row-level security policy in the
database. Treat it like the master key to every org's data, because that
is what it is.

## 6. Doc AI: the Anthropic API key

Optional, and the app runs fine without it. Every screen that shows an
extraction result already says it came from a stand-in model.

When it is wanted:

1. console.anthropic.com, create an API key.
2. Paste it into Vercel as `ANTHROPIC_API_KEY`.

One piece of work is still owed before this is real: a per-org spending
budget. Bridge's original version tracked spend in the browser's
localStorage, which does not survive a multi-tenant server, so a real
budget table and a caller that refuses to run over it have to be built.
That is Claude's work, not Dave's, and it takes a session.

## 7. Domain, when ready

Not blocking. A subdomain on the existing BFFSA domain, or its own
domain, added in Vercel once step 5 is live.

---

## The short version

1. Say the name.
2. Say which database.
3. Say which email is the owner.
4. Make a private empty GitHub repo, and either connect GitHub here or
   ask for a bundle.
5. Paste the service role key into Vercel.
6. Anthropic key, whenever Doc AI matters.

Steps 1, 2 and 3 are three sentences and they unblock the entire rest of
the project.
