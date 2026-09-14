# Roadmap

Not a committed timeline - Dave hasn't scoped dates for any of this yet.
Ordered by what naturally follows what's already built.

## Next up

1. **Verify RLS enforcement for real**, not just schema shape, before
   building anything on top of it that would be painful to redo. See
   docs/CURRENT_STATE.md's known gaps.
2. **Doc AI redesign.** Bridge's real `Engine`/`EngineBridge` system has
   been read in full; it needs the same treatment the fit engine got -
   understand what's genuinely good (this is real, working extraction
   logic) vs. what's accumulated as patches, then rebuild the coherent
   version against the same org-scoped, walled-off-module principles.
3. **First real screens**, built against docs/DESIGN_SYSTEM.md's rules:
   likely roster/athletes list first, since the fit engine has nothing
   to score without athlete and school data actually in the database.
4. **Auth flow**: sign-in, org switching for a user who belongs to more
   than one org, and wiring `getCurrentUser`/`requireRole` into real
   pages instead of just existing as helpers.

## After that

- Recruiting board (targets, statuses, communication log) - the screen
  the fit engine actually feeds.
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
