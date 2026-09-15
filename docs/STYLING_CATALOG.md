# Styling catalog (DRAFT, not yet locked)

Status: **draft**. Dave is choosing between the three options below.
Nothing here is built into real components yet. Once he picks one (or a
mix), this document gets rewritten as the locked contract and
docs/DESIGN_SYSTEM.md's "Not yet decided" section gets closed out
against it.

## Why this document exists

JARVIS's `STYLING_CATALOG_V3.md` is a locked, written contract: a fixed
set of component-level rules (chip law, button law, card treatment,
status vocabulary) that every screen is built against, checked by
`src/laws/`. This repo adopted JARVIS's *structure* early
(docs/DESIGN_SYSTEM.md, "What carries over from JARVIS") but explicitly
left the concrete visual decisions open.

The first full-app preview (Artifact, two revisions) showed why that
gap matters: round one was judged too flat, round two added glass
surfaces and tinted chips but was still short of what Dave wanted,
which turned out to be JARVIS's actual visual language, saturated
solid-fill pills and badges, colored-dot section headers, progress
bars, not just "more color" in the abstract. Guessing a single
direction and revising it in place wasn't converging. This document and
the paired visual catalog (Artifact: "Styling Catalog") exist so Dave
picks a direction from real side-by-side options instead.

## How to read the options

All three options render the same sample content (same athlete, same
school, same score, same follow-up case) so the only variable is the
styling treatment. All three stay inside the forced-dark `/org/[slug]/*`
theme already locked in docs/DESIGN_SYSTEM.md; none of them touch
navigation, typography, or copy rules, which are already decided.

### Option A: JARVIS Mirror

Closest to the literal JARVIS screens Dave sent. Introduces three new
solid hues on top of this repo's existing five tokens: orange, teal,
purple, used as **solid-fill square icon badges** per metadata field
type (mirroring JARVIS's Due/Repeat/Length/Area/Person/Project/Where
badges). Status pills are solid saturated fills with white text, not
tints. Section headers use a colored dot, a dotted rule, and a count
("BRIDGE ⋯⋯⋯ 7"). Progress bars are thick and solid.

Tradeoff: most visually bold, closest match to what Dave pointed at in
the screenshots, but it's the only option that adds new color tokens
beyond `--accent`/`--success`/`--danger`/`--info`, which is a bigger
change to `tailwind.config.ts` and `globals.css` than the other two.

### Option B: Refined Bridge

The v2 preview Dave already saw and said was "better but" not enough.
Translucent 15%-tint chips, SVG ring gauges for fit scores, colored
left-rail accents on cards, glass surfaces. Zero new hues, stays
strictly inside the five existing tokens.

Tradeoff: smallest change to the real token system, but this is the
direction Dave already flagged as too soft relative to JARVIS. Listed
here for completeness and as a baseline, not a recommendation.

### Option C: Bold Bridge

A middle ground. Solid-fill status pills like Option A (not tints), but
built entirely from the five existing tokens, no new hues. Cards use a
5px solid colored left border instead of icon badges. Fit score renders
as a solid numeric pill instead of a ring. Section headers use the same
colored-dot-plus-dotted-rule-plus-count pattern as Option A, with the
dot always accent red rather than varying per section.

Tradeoff: gets the saturated, high-contrast JARVIS feel Dave is asking
for without introducing new color tokens or new badge iconography, so
it is the smallest real change that still addresses the "too dull"
feedback. Doesn't have JARVIS's per-field-type icon badges, since that
needs the extra hues.

## What happens after Dave picks

1. This file gets rewritten: the chosen option's rules become the
   locked contract, the other two get cut, and the "not yet locked"
   status above goes away.
2. docs/DESIGN_SYSTEM.md's "Not yet decided" line is updated to point
   here instead of remaining an open question.
3. If new tokens are introduced (Option A, or a custom mix that adds
   any), they're added to `src/app/globals.css` and
   `tailwind.config.ts` following the same light/dark-pair pattern as
   the existing tokens.
4. Shared components (`StatusPill.tsx`, card wrappers, section headers)
   get built or updated to match, and a law goes into `src/laws/` for
   anything checkable statically (pill fill vs. tint, badge shape),
   matching the "Laws as tests" pattern already in place.
5. Only after that does any existing screen get restyled to match.
   Nothing existing changes until the contract is locked.
