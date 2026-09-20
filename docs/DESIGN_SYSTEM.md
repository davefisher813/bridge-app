# Design system

This documents what was decided to carry over from JARVIS and from
Bridge, so a screen is built against a rule set instead of improvised
and then retrofitted. The rule set itself is the kit; see
docs/STYLING_CATALOG.md.

## What carries over from Bridge

Per Dave: "obviously, like, bridge has different logos, but, like, the
color scheme, we can keep pretty much the same... the styling, the
formatting, the flows... we can keep a lot of that the same." Bridge's
original locked tokens (bffsa-site/docs/DESIGN_SYSTEM.md): brand red
`#c8180c`, brand yellow `#ffd60a`, dark and light themes only (no third
theme), breakpoints at 767/768/1024. Structure, formatting, and flows
still carry over from these. Brand yellow still carries over as-is.

**Accent red superseded, 2026-09.** Dave redesigned the app himself in
ChatGPT and asked to match its styling; he then chose Apple's system
red over both the old Bridge red and the redesign's own red. This
repo's `--accent` token (`src/app/globals.css`) is now Apple's
`systemRed`: `#ff3b30` in light, `#ff453a` in dark (Apple's own
light/dark pair, not a single flat value). See docs/DECISIONS.md.
Elite Squad and future orgs still get their own `branding` config
(`orgs.branding` jsonb) rather than a new hardcoded palette per org -
this change only affects the shared default token.

## What carries over from JARVIS: structure, not product

JARVIS's `STYLING_CATALOG_V3.md` is mostly JARVIS-product-specific
(Email, Schedule, Reminders, Plan My Day, Notice Stream) and not a
portable design system as a whole. The genuinely portable subset - the
methodology, not JARVIS's own CSS class names or brand red - is what's
adopted here:

1. **A chassis, not a card pile** (JARVIS Section J). Full-bleed rows
   for navigation and plain lists (glyph, name, hairline divider), with
   cards reserved for a short, deliberate list: stat strips/heroes,
   banners/tips, sheets/overlays. Sections are always labeled with a
   bold Title Case head; whitespace is never the label.
2. **Every string has a role** (Section B): page title, section head,
   row name + meta, urgency span, pill, stat tile, empty-state
   title/sub. A string that fits none of these gets restructured, not
   styled in place - no floating explainer paragraphs outside of cards.
3. **Everything actionable is a control** (Section C): copy that names
   an action IS the button, never a sentence pointing at where the
   button is. Choices are chips. One primary action per surface.
4. **A button law, adapted, not copied verbatim.** JARVIS's exact slot
   names (`.barbtn`, `.pill-act`, etc.) are JARVIS's own tokens; what
   carries over is the concept - every tappable action renders as
   exactly one of a small, fixed set of button types chosen by its
   slot, never a bare unstyled `<button>` - defined against this repo's
   own token names once real screens exist.
5. **Copy laws** (Section G): no em dashes (already enforced,
   `src/laws/laws.test.ts`); no sentences in rendered strings (middle
   dots divide clauses instead); Title Case for titles/buttons/section
   heads with small words lowercase; ALL CAPS reserved for eyebrows,
   kickers, pills, urgency.
6. **An alignment grid** (Section H): fixed margin/tile/text-edge/
   trailing-edge columns, one text edge per card, tabular numerals
   wherever numbers stack.
7. **Laws-as-tests enforcement** (Section I): copy/casing rules, CSS-
   class existence, and any other style rule that can be checked
   statically belongs in `src/laws/`, not only in this document. See
   docs/DECISIONS.md and `src/laws/README.md`.

## Redesign pass, 2026-09

Dave built his own mockup of this app in ChatGPT and asked to match its
formatting/functionality/styling. After resolving conflicts with him
(docs/DECISIONS.md has the full history):

- **Typography**: Inter, self-hosted (`src/app/fonts/`, not
  `next/font/google`). Headlines use heavy weight -
  `font-extrabold`/`font-black` in Tailwind.
- **Navigation**: bottom tab bar (Today / Athletes / Board / More),
  not a top link row. No Tasks or Calendar tab - neither is a built
  feature and that pattern is JARVIS's life-management shape, not this
  product's.
- **Theme**: follows the phone. `data-theme` is stamped from
  `prefers-color-scheme` before first paint (`src/app/layout.tsx`) and
  nothing forces dark any more (Dave's selection, 2026-09-19).
- **Status color language**: green = active/on-track, blue-indigo
  (new `--info` token) = in contact, accent = committed/primary, muted
  = everything else. `src/components/StatusPill.tsx` renders a status
  through the kit's `Chip`; nothing re-styles status text inline.
- **Home screen content is Dave's call, not the redesign's**: pipeline
  snapshot, needs-follow-up, upcoming - see docs/DECISIONS.md for why
  the redesign's own task/event widgets didn't carry over.

## What does NOT carry over

JARVIS's specific screens and features (Email, Schedule, Reminders,
Plan My Day, Health, Notice Stream), its exact color token names and
values, its exact CSS class names, and anything specific to being a
single-user offline-capable personal app. This is a multi-tenant web
app with a different product entirely; only the structural rules above
transfer.

## Component-level treatments: see the kit contract

Every concrete treatment is the kit, `src/components/kit/`, and its
contract is **docs/STYLING_CATALOG.md**, locked 2026-09-19 from Dave's
selections in the clean-slate audit. Four text sizes, one spacing step,
one radius, paper surfaces with no border, filled inputs, a fixed tab
bar, and a theme that follows the phone. A page composes the kit and
writes layout classes only; `src/laws/kitLaws.test.ts` fails the build
on anything else. Read the contract before building or restyling any
screen.

One thing in the kit knowingly departs from the JARVIS structure above:
rows are paper cards, not the full-bleed hairline rows of point 1's
"chassis, not a card pile". Dave picked paper in the audit. The chassis
rule describes JARVIS, not this app.

## Not yet decided

How `orgs.branding` maps onto the token system for a third organization
that isn't Bridge or Elite Squad.
The `--solid-*` fill pairs are contrast-checked against each other
rather than against a page background, which is what lets an org's
branding replace a hue without re-auditing every screen, but no third
org has actually exercised that yet.
