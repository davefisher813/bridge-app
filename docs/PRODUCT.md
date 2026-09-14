# Product

## What this is

A recruiting management and communication platform for youth/travel
sports organizations: rosters, recruiting targets, fit-to-school
scoring, document intake, and communication tracking, built generic
from day one so the same codebase runs more than one organization
without a rewrite.

## Why it exists

Bridge (the BFFSA platform, app.bffsa.org) is an 18,900-line single-file
app that has become buggy and hard to extend. Its most valuable feature
- matching a student athlete to a college fit - was also its most
frustrating, because the matching logic (`calcCollegeFit` and friends)
grew as a stack of sequential patches (FIT-2 through FIT-14) rather than
one coherent model. Dave wants that rebuilt properly, and wants the
rebuild to double as the foundation for a standalone recruiting product
usable by other organizations and coaches, not just Bridge.

## Who uses it

Two concrete organizations validate the generic model:

- **Bridge (BFFSA)**: a nonprofit. Owner role = Executive Director,
  staff role = Coordinator. Needs board/governance and donor/fundraising
  on top of the core recruiting product.
- **Elite Squad NY**: Dave's travel baseball organization. Owner role =
  Owner, staff role = Coach. Needs only the core recruiting product; no
  board, no donor tracking.

The org boundary, role model, and module toggles exist so a third
organization (any travel team, any coach, eventually college coaches on
the other side of the recruiting relationship) can be added without
touching code that Bridge or Elite Squad depend on.

## What's core vs. optional

Core, on for every org: rosters/athletes, recruiting targets and fit
scoring, document intake (Doc AI, not yet rebuilt), communication
tracking, calendar/events.

Optional, off by default, on only for orgs that opt in: board/governance
(Bridge-specific), donor/fundraising (Bridge-specific, smaller than
governance).

## Longer-term direction (not yet built)

A standalone recruiting product any coach or organization can use, and
eventually a two-sided marketplace where college coaches also have
accounts and can see fit signals from their side. Nothing in the current
build should make that harder later; see docs/ARCHITECTURE.md for how
the walled-off module boundary is meant to keep that option open.
