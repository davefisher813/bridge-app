# Runbook

How to redeploy, where the logs live, and who owns what. Written
2026-10-10. Anything marked **Unknown** could not be read from the tools
available to the builder and needs Dave to fill it in.

## Where it runs

| Piece | Where | Account |
|---|---|---|
| App hosting | Vercel project `commit-app`, team `davefisher813-3685s-projects` | Vercel login of davefisher813-3685 |
| Live URL | https://commit-app-nu.vercel.app | Vercel's own domain, nothing to renew |
| Custom domain | None yet | n/a |
| Database, sign-in, file storage | Supabase project `Bridge-app`, ref `emllcefqxyxyhqolrllo`, region us-west-2 | Supabase organization `tjgwjwitnkqbltzoimob` |
| Code | GitHub `davefisher813/bridge-app`, branch `main` | GitHub account davefisher813 |
| Document reading (AI) | Anthropic API, key in Vercel as `ANTHROPIC_API_KEY` | **Unknown**: which Anthropic account the key belongs to |
| QA evidence | GitHub `davefisher813/basecode-qa` (public, artifacts only) | GitHub account davefisher813 |

Railway and Netlify are not used by this app today. Moving there is a
decision for Dave (see the go-live status).

## Environment variables (Vercel, production)

Names only. Values are never written into the repo.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public by design)
- `SUPABASE_SERVICE_ROLE_KEY` (secret: server only)
- `ANTHROPIC_API_KEY` (secret)
- `NEXT_PUBLIC_SITE_URL` = `https://commit-app-nu.vercel.app` (where sign-in and invite links point)
- `DATABASE_URL` (secret; not read by the app today)

## Redeploy

1. **Normal path.** Merge to `main` on GitHub. Vercel builds and deploys
   on its own, in about a minute. Nothing else to do.
2. **Redeploy the same code** (say after changing an environment
   variable): Vercel dashboard, project `commit-app`, Deployments, the top
   Production deployment, menu, Redeploy.
3. **Roll back:** Vercel dashboard, Deployments, pick the last good
   Production deployment, menu, Promote to Production. Takes seconds. The
   database is not rolled back by this.
4. **Database changes** are migrations in `migrations/`, numbered. Each
   is tested against a local Postgres first (`bash scripts/run_rls_test.sh`).
   Apply to production only after a backup or point in time recovery is
   confirmed, then record it in `docs/CURRENT_STATE.md`.

## Before any merge

```
npm test
npm run typecheck
npm run build
npm run qa:check
PW_CHROMIUM=/opt/pw-browsers/chromium bash scripts/live/check.sh
```

## Logs and health

- **Build logs:** Vercel, project `commit-app`, Deployments, the deployment, Build Logs.
- **Runtime errors and server logs:** Vercel, project `commit-app`, Logs (filter Errors).
- **Database and auth logs:** Supabase, project `Bridge-app`, Logs.
- **Who did what in the app:** the Activity screen (More, Activity), Admins only.
- **Files nobody points at:** `node scripts/list_unregistered_uploads.mjs` (read only, needs the service role key in the shell).

## Recovery

- **App broken after a deploy:** roll back in Vercel (step 3 above).
- **Data lost or damaged:** Supabase backups. **Unknown**: whether the
  plan includes daily backups and whether point in time recovery is on.
  This has been open since 2026-10-05. Dave needs to check Supabase,
  project settings, Database, Backups.
- **Locked out of the app:** "Email Me a Link Instead" on the sign-in
  screen sends a sign-in link. There is no password reset screen.
- **Locked out of an account (Vercel, Supabase, GitHub):** **Unknown**:
  recovery email and second factor for each. Dave to record them in his
  password manager, not here.

## Who owns what

| Area | Owner today | Backup |
|---|---|---|
| Hosting (Vercel) | Dave | **Unknown** |
| Database (Supabase) | Dave | **Unknown** |
| Code (GitHub) | Dave | **Unknown** |
| Billing for Vercel, Supabase, Anthropic | **Unknown** | **Unknown** |
| App maintainer | Open decision (Gate 1, item 5) | |
| Support inbox | Open decision (Gate 1, item 3) | |
