# Roadmap

Not a committed timeline - Dave hasn't scoped dates for any of this yet.
Ordered by what naturally follows what's already built.

## Done from the original "next up" list

1. ~~Verify RLS enforcement for real~~ - done, found and fixed a real
   infinite-recursion bug. See docs/DECISIONS.md.
2. ~~Doc AI redesign~~ - core logic done (categories, schemas, GPA
   normalization, resolver, provenance/routing, versioning, pipeline
   orchestration), found and fixed a real double-penalty bug in the
   confidence math. Ingest and the real API call are not done - see
   below.
3. ~~Auth flow~~ - sign-in, sign-out, session-refresh middleware, and
   multi-org membership resolution (0/1/many orgs) are wired up and
   built against `requireRole`. Structurally verified (typecheck, tests,
   build); not yet runtime-verified against a real Supabase project,
   since none exists.
4. ~~First real screen: roster~~ - read-only athletes list, gated
   through `requireRole`. Add/edit still not built.

## Next up

1. **Doc AI file ingest**, ported from Bridge's `Engine.ingest`, once
   there's a browser available to actually exercise
   `File`/`Image`/`canvas`/`FileReader` code against - not worth porting
   blind with no way to verify it. Likely bundled with the first real
   upload screen rather than built standalone.
2. **Wire a real `ModelCaller`** against the Anthropic API: needs an API
   key (none exists in this environment) and a persistent per-org budget
   table, since Bridge's localStorage-based daily budget tracking has no
   multi-tenant, server-side equivalent yet.
3. **Recruiting board** (targets, statuses, communication log) - the
   screen the fit engine actually feeds, and the natural next screen
   now that roster exists.
4. **Athlete add/edit**, since roster is read-only today and the fit
   engine has nothing real to score without a way to get athlete data
   in.

## After that
- Board/governance and donor/fundraising modules, gated behind
  `orgs.modules`, built only once the core product works for both
  Bridge and Elite Squad.
- Elite Squad onboarding as the second real org - this is the actual
  test of whether "generic from day one" held up, not just a design
  intention.
- Create a real GitHub repo (name TBD - "recruiting-platform" is a
  placeholder) with write access, once Dave wants to push.

## Longer-term, not yet scoped

- Standalone recruiting product for other organizations/coaches.
- Two-sided marketplace including college coach accounts.
- Deployment/hosting decision (Vercel, matching tucci-admin, is the
  likely default but hasn't been discussed).
