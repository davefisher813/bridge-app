# Styling contract: the kit (LOCKED)

Status: **locked, 2026-09-19.** Dave ran a systemic audit of the live
app ("screens slide all over the place, typing is glitchy, cursors are
no good, visuals are not uniform, borders and spacing clearly have not
been established") and selected every decision in the clean-slate
artifact. This document is the contract those selections produce. A
screen that draws anything the kit does not provide fails the build.

The catalog locked on 2026-09-15 (fourteen component treatments, the
fills removal, the glyphs) is superseded by this file. What survives
from it is the palette, the two-tier colour system and the icon set,
kept below verbatim. What is gone is the idea that a page styles
itself: fourteen text sizes, seven radii and seventeen paddings had
accumulated across 53 screens, each one a judgment call made
mid-screen, and that is what Dave was looking at.

Changing a locked item is a conversation with Dave, not a judgment call
mid-screen. Adding a component means adding it to the kit first, with
its contract written here.

## Dave's selections

The first round, 2026-09-19, set the scale; the second, 2026-09-20,
went through twenty-five decisions in the kit catalog artifact. Every
rendering in that catalog was drawn with the app's own stylesheet and
every pick is recorded here.

| Decision | Selection |
| --- | --- |
| Type scale | Four sizes: 13 label, 16 body, 20 heading, 28 title. Titles extrabold |
| Spacing | One step: 12 / 16 / 24, 16px gutter, 56px rows, 12px is the one radius |
| Surface | Paper with a hairline border in the line token. Dark paper is #202024 |
| Subtext | The first fact on a meta line reads in ink, the rest muted |
| Inputs | Filled paper, no border, red focus ring, 16px, no placeholders; the example goes in the hint below |
| Buttons | Primary solid accent, 12px radius. Secondary and destructive are outlined. The header add action is a 44px accent disc |
| Colours | Apple red accent. Stages and scores keep their hues |
| Sections | Dot, caps label, dotted rule, count. Stat labels in sentence case |
| Writing | No explanatory line under a title; a factual one stays. Every title is Title Case |
| Empty states | Glyph, title, one line, and the next action inside |
| Modules off | Hidden from More entirely |
| Flows | A save lands on the record. The back arrow goes to the parent screen. A delete asks in a sheet first. A loading screen is a skeleton |
| Theme | System. The app follows the phone |
| Tab bar | Four tabs with labels, fixed above the home indicator |
| Wide screens | One column, 672 wide |

## The scale

`tailwind.config.ts` replaces Tailwind's theme rather than extending it,
so a class outside the scale does not exist.

**Type.** `text-label` 13/16, `text-body` 16/22, `text-heading` 20/26,
`text-title` 28/34. Weights: normal, `font-semibold` for a row title,
`font-bold` for a figure or a control, `font-extrabold` for a screen
title. Numbers stack with `tabular-nums`.

**Space.** 4, 8, 12, 16, 24, 32, 44, 48, 56, 64, 80, 96. A screen has a
16px gutter, sections sit 24 apart, rows 12 apart, a row is 16 inside.
44 is the smallest tappable thing, 48 an input, 56 a list row.

**Shape.** `rounded` is 12px and is the only radius. `rounded-full` is
for a dot, a disc and a meter track, never a pill with a fill.

**Colour.** The palette below, unchanged. Text is `text-ink` or
`text-muted`; coloured text takes a `text-tint-*-on` token (the AA-safe
pair), never the raw hue, so a text link is `text-tint-accent-on` and a
destructive button `text-tint-danger-on`. A glyph takes the raw hue
(`FG`). A page background is `bg-bg`, a card `bg-paper`.

## The kit

`src/components/kit/index.tsx` and `TabBar.tsx`. Everything below is
the whole vocabulary a screen has.

**Type:** `Title`, `Heading`, `Body` (weight, tone, numeric, truncate),
`Label` (caps, numeric, tone), `Prose` (a muted paragraph), `Figure` (a
big number).

**Layout:** `Screen` (title, back link, lede, one header action; pads
its bottom for the tab bar), `Panel` (a centred paper card for sign-in
and the error pages), `Section` (caps label with a glyph or dot, a
dotted rule, a count), `Stack`, `Inline`, `Grid2`.

**Surfaces:** `Card` (paper, optionally a link), `Row` (56px, a glyph or
avatar, a title, a meta line, something on the right; `href` makes the
whole row the link; `wrap` lets the meta run on when the second line is
the point), `Stat` and `StatRow`, `Meter` (a stacked share bar),
`EmptyState` (glyph, title, one line naming the next action), `Notice`
(success, danger, warning, info), `Skeleton` (loading).

**Marks:** `Chip` (a glyph in the role hue and a word in ink; the one
pill, and it has no fill), `Score` (the fit number in its band colour),
`Avatar` (initials on one fixed indigo), `Chevron`.

**Controls:** `Button` (primary solid accent, secondary outlined,
destructive outlined with danger text, quiet text only; full width
unless `inline`), `LinkButton`, `AddButton` (the 44px accent disc in a
screen header), `TextLink` (a small accent link under a list),
`ConfirmButton` (a destructive action that opens a confirm sheet).

**Fields:** `Field`, `SelectField`, `TextAreaField` (label above, hint
or error below, filled paper, 16px, 48px tall), `CheckField`,
`FileField`, `Hidden`, `Option` (a tappable choice that submits),
`ChoiceRow` and `Choice` (chips, chosen one carries a ring), `Form`
(the stack, with the whole-form error on top).

**Chrome:** `Chrome` (org name above, `TabBar` fixed below).

The eligibility verdict (`VerdictCard`, `GpaPair`, `SubjectRow`, `Note`)
and the `JourneyStepper` are composed from the kit in
`src/components/` and are the only screen-specific pieces.

## Titles are Title Case

Dave, 2026-09-20: "make sure everything is title cased as well, I saw a
bunch that wasn't." A screen title, a section label, a field label, a
button, a chip, a stat label, a tab and an empty-state title are
titles: `Needs Follow-Up`, `Add a School's Scale`, `NCAA Eligibility`.
Small words stay lowercase inside a title. A lede, a meta line, a hint
and a notice body are sentences and stay sentences.
`src/lib/copy/titleCase.ts` is the one implementation and
`src/laws/copyLaws.test.ts` reads every literal title in the UI through
it.

## What a page may write

A page file composes the kit. Its own `className` may carry layout
only: flex and grid, gap, alignment, `min-w-0`, `w-full`, `text-right`,
`truncate`. The exact list is the `ALLOWED` pattern in
`src/laws/kitLaws.test.ts`. No page styles text, colour, radius or
padding, and no page renders a raw input, button, anchor or SVG.

## What is enforced by tests

`src/laws/kitLaws.test.ts`, each proven to bite on a planted violation:

1. No arbitrary value (`text-[15px]`, `rounded-[10px]`) anywhere in the
   UI. The one exception is the accent colour on a native checkbox,
   which has no utility, and it lives in the kit.
2. A page file uses only layout classes.
3. Every input, select and textarea is a kit field.
4. No raw button or anchor with its own styling outside the kit.
5. Nothing is sticky, and only the kit is fixed.

`src/laws/stylingLaws.test.ts` carries over: fills only with their
paired foreground, no raw hex outside `globals.css`, the palette equals
Apple's published values, every role has its pairs and they clear
4.5:1, one icon set that nothing copies, no solid fill used as a text
colour, muted text clears AA on both surfaces, every tappable kit shape
carries the 44px minimum, no coloured rail, no filled pill.

`scripts/audit_preview.mjs` checks what the browser computed on every
screen in both themes: every class in the markup exists in the
stylesheet, every glyph has a drawing, nothing scrolls sideways at 390,
text clears AA against the surface it sits on, every link and button is
44px, no screen renders empty.

## iOS

Three things that were bugs on Dave's phone and are now rules. Inputs
are 16px, because Safari zooms the page on focus of anything smaller
and does not always zoom back. The tab bar is `position: fixed` with
`env(safe-area-inset-bottom)` padding, because a sticky one rode
Safari's own bar up and down. `touch-action: manipulation` and no tap
highlight on every control, and `overscroll-behavior-y: none` on the
body, so the page holds still.

## The palette: Apple's, exactly

Dave picked the colors from a set he was already using, and the indigo in
it landed on Apple's systemIndigo almost exactly, so the palette is
**Apple's iOS system colors, verbatim**. They are declared once as
`--ios-*` in `src/app/globals.css` and nothing in the app may introduce a
color that is not one of them. A law checks each primitive against Apple's
published value, so the palette cannot drift.

## Two tiers, and only tier one is a color

Tier one is the palette above. Tier two is what a color MEANS here:
`--solid-<role>` and `--tint-<role>`, each paired with the only foreground
allowed on it.

Tier two is **generated**. The role map lives in `scripts/gen_tokens.py`;
running it with `--write` splices the derived tokens into `globals.css`
between the generated markers. Changing what a status means is a one-line
edit there rather than a contrast audit, and hand-editing a fill without
its foreground is the exact failure the pairing exists to prevent.

## What each color means

Four axes. No screen mixes two of them at the same visual weight, which is
what stops ten colors reading as noise.

**Stage** (solid pills) is the recruiting pipeline as a single
progression, cold to warm to green, so a board reads as distance travelled
rather than five unrelated labels:

| Stage | Color |
| --- | --- |
| Target | systemGray |
| In Contact | systemBlue |
| Visit | systemMint |
| Offer | systemOrange |
| Committed | systemGreen |

**Score** (tints only) is green above 70, yellow 40 to 69, gray below.
Rendered as a tint rather than a solid because stage and score are two
different questions about the same row: if both were solid pills, green
would mean Committed and also "good score". Weight carries the axis, so
color stays free to mean one thing inside each.

**Field badges** (B1 square badges) are systemYellow for anything on a
clock, systemTeal for people, systemIndigo for places.

**Action** is systemRed for the primary action and systemPink for
destructive ones, kept deliberately apart so Remove never looks like Add.
**Red is not a status.** It was previously both the brand action color and
the Committed stage, which is why the Add button did not stand out. Giving
the win to green and reserving red for action fixed both ends of that.

## Pairing and contrast

A solid fill is only legible with its own `-on` token over it: white on
systemRed is 3.4:1 and fails, and pills render at 11px bold, below the
WCAG large-text threshold, so the exemption does not apply. Every fill and
every tint therefore ships as a pair and clears 4.5:1. The current set is
42 pairs at a worst case of 4.52:1.

Which way a pair resolves follows Apple's own convention rather than pure
math: white text on red, pink, blue, indigo and purple, with the fill
darkened until white clears; dark text on yellow, orange, green, mint,
teal and cyan, with the fill keeping its exact Apple value and the
foreground darkened instead. That is why the filled red is deeper than
systemRed while systemMint is untouched. An earlier pass did the opposite
for mint and turned it into a dark teal with no mint left in it.

Tints are the hue at 22 percent over `--paper`. Unlike the solid pairs they
**are** themed, because a tint is defined against the paper behind it and
that paper flips. Text inside a tint uses that tint's own foreground, never
`text-muted`, which is chosen against the page and lands near 3:1 on a tint.

A fill also has to read as a shape against the page. Every one clears 3:1
against the dark background, systemGray included, which retired an earlier
hairline-border rule that existed only because the old neutral fill sat at
1.87:1.

