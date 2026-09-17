# Styling catalog (LOCKED)

Status: **locked, 2026-09-15.** Dave selected all fourteen component
treatments from the visual catalog artifact. This document is the
contract. A screen that renders one of these components renders it the
way this file says, or the law tests in `src/laws/` fail.

**Amended 2026-09-16 (C2, the type glyph) and 2026-09-17 (the fill
removal and the type scale), both by Dave, both recorded below and in
docs/DECISIONS.md.** The lock is not broken by an amendment Dave asks
for; it is broken by a judgment call made mid-screen.

Changing a locked item is a conversation with Dave, not a judgment call
mid-screen. Adding a component type that is not in this file means
adding it here first.

## The selections

| Component | Code | Treatment |
| --- | --- | --- |
| Status pills | P1 | Glyph in the stage hue, plain label (was: solid fill) |
| Section headers | H1 | Colored dot, dotted rule, trailing count |
| Metadata icon badges | B1 | Bare glyph, one hue per field type (was: solid square) |
| Cards and rows | C2 | Paper card, colored type glyph; no rail (see below) |
| Fit score | S2 | The number alone in the band hue (was: tinted pill) |
| Avatars | AV1 | Gradient fill with initials |
| Primary buttons | BT3 | Solid rounded rectangle |
| Stat tiles | ST1 | Paper tile, value in the role hue (was: tinted background) |
| Bottom tab bar | TB1 | Active tab gets a solid pill behind the icon |
| Journey stepper | J1 | Connected dots, line fills as it completes |
| Form inputs | F3 | Filled, no border |
| Board group headers | G3 | Glyph and label, count after it (was: tinted pill tab) |
| Empty states | E1 | Icon, title, subtext, centered |
| Toasts | T3 | Solid pill |

## The fill removal, 2026-09-17

Dave, looking at the roster in the prototype: "let's make sure there's no
color highlights on the pills like in pic two, we said we were going with
icons, make sure it's consistent throughout."

The September 16 change put a type glyph on every record row and left the
fills on the pills, so for a day a row carried a bare coloured mark at one
end and a filled coloured block at the other, both meaning status. That is
the inconsistency he is pointing at, and he is right about it.

Then, an hour later, looking at the roster: "there's color right here."
The 5px coloured left rail was still on every card without a `kind`, and
on a roster row it was the third thing on one line saying status, after
the avatar and the stage pill. The earlier reasoning for keeping it, that
a prose row needs a colour because a glyph would be labelling a
paragraph, was wrong: what a prose row needs is no mark, not a coloured
one.

**The rule now, everywhere:** a card is paper. A pill, chip, badge or tab
is a glyph in the role's hue plus a label in `--ink`. No `bg-tint-*`, no
`bg-solid-*` and no `border-l-[5px]` behind any of them. `RAIL` is
deleted from `statusHue.ts` rather than left unused, so it cannot come
back by autocomplete. `Chip` in `src/components/catalog.tsx` is the one
implementation; `StatusPill`, `GroupTab` and the per-screen status chips
all render it.

Two things survive the rule, and both for a reason:

- **Primary and destructive buttons** keep `bg-solid-accent` and
  `bg-solid-danger`. Reserving red for the action is the oldest rule in
  this file, and an action that does not look like a button is not a
  style problem.
- **A selectable control** (a subject picker, a stage picker, the Doc AI
  category tabs) shows "chosen" with `ring-2 ring-accent` and a border,
  not a fill. A control has to show state; it does not have to show it
  with a coloured block.

**Colour on a glyph and colour on a word are different tokens.** `FG` is
the raw iOS hue, correct for a 2px stroke. As text it is 2.02:1 on paper.
The first pass at a bare coloured score number put twenty-six AA failures
on the board in one build, which is what `TEXT_ON` exists for: the tint
pairs' foregrounds, already tuned for both themes. A glyph takes `FG`, a
word or a number takes `TEXT_ON`, and three laws in
`src/laws/stylingLaws.test.ts` keep it that way.

## The type scale, 2026-09-17

Dave: "font size in the app is a little small as well."

Every `text-[Npx]` in the app and in the generators moved up one step, in
a single pass so nothing cascaded:

| Was | Now | | Was | Now |
| --- | --- | --- | --- | --- |
| 9.5 | 11 | | 13 | 14.5 |
| 10 | 11 | | 14 | 15 |
| 10.5 | 11.5 | | 15 | 16 |
| 11 | 12 | | 16 | 17 |
| 11.5 | 12.5 | | 18 | 20 |
| 12 | 13 | | 20 | 22 |
| 12.5 | 13.5 | | 24 | 26 |
|  |  | | 26 | 28 |

Bigger at the bottom than the top. 10.5 and 11 were the sizes that
actually hurt on a phone; a 20px screen title going to 26 would have been
a redesign rather than a legibility fix. Body copy is now 13.5px and the
smallest label in the app is 11px.

## The icons, redrawn 2026-09-17

Dave: "let's improve the quality of the icons." Four things were wrong and
none of them was the choice of shape. The full account is in the header of
`src/components/rowIcons.json`; the short version:

1. **Stroke.** 1.75 on a 24 box at 18px is a 1.31px line, which falls
   between device pixels. Now 2.0 at 20px, a 1.67px line. That alone
   sharpened the set without a path changing.
2. **Safe area.** Several glyphs ran to the edge of the box, so they
   optically outsized their neighbours. Everything now sits inside 20x20.
3. **Detail below the resolution.** Trophy handles, megaphone arcs and a
   medal ribbon all carried features under 2 units, which merge at 18px.
4. **Two glyphs said the wrong thing.** `visit` was a calendar, which is a
   date and not a campus visit. `pledge` was the clock glyph exactly, so a
   promise and a deadline were one mark.

`board` was a bar chart doing duty for both the recruiting board and the
board of directors; the second now has its own `governance` glyph. A new
`stage_*` set carries the recruiting stages, which need shapes of their
own now that the pills have no fill to carry them.

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

## Component contracts

### P1, status pills (amended 2026-09-17)

`src/components/StatusPill.tsx` is the only implementation. Do not
re-style status text inline anywhere.

Rounded full, `px-2.5 py-1`, 11px, `font-bold`. Solid fill plus its
paired foreground. The status-to-role mapping lives in `src/components/statusHue.ts` and
nowhere else, so a status can never be one color as a pill and another as
a rail.

### H1, section headers

Colored dot, label, dotted rule filling the gap, count at the trailing
edge. Label is ALL CAPS, `font-extrabold`, `text-muted`. The count is
`text-ink`, not muted, because the number is the useful part. The dot takes the
section's role where it has one, and falls back to `accent`.

The rule is `border-bottom: 2px dotted var(--line)` on a flexed spacer,
never a background image or a row of typed characters.

### B1, metadata icon badges (amended 2026-09-17)

A 30px solid square, `rounded-[8px]`, icon centered, one hue per field
type. Three hues exist and they are named for their role:

- `time` (systemYellow): due dates, last contact, days idle.
- `people` (systemTeal): coaches, contacts, assigned staff.
- `place` (systemIndigo): schools, divisions, locations, visits.

Anything outside those three uses `neutral`. The status hues are never
reused as field badges, so a badge can never be mistaken for a status.
Adding a fourth field-type hue means adding a token pair here first,
with its contrast ratio recorded in the table above.

### C2, cards and rows

**Revised 2026-09-16.** Solid `bg-paper`, `rounded-[10px]`, with a
leading type glyph in a meaningful color: the row's stage for a target,
or its field role for a row that is not a pipeline item (contacts take
`people`, visits take `place`). Never red, which belongs to actions. Not
a glass surface, and not a hairline-divided full-bleed row.

The glyph replaced a 5px coloured left border. Dave, after clicking
through the prototype: "let's use icons like Jarvis does to identify
categories instead of the color highlight." The reasoning is the same
one JARVIS settled on: a stripe can only ever say status, so a list of
eight rows was eight coloured stripes and no indication of what any of
them was. The glyph says the KIND and keeps the status in its colour, so
a row answers both questions before it is read.

Form: a bare coloured glyph, 18px, 1.75 stroke, no tile behind it. This
is JARVIS's second form (`RowGlyph`, approved there 2026-08-18) rather
than its first (`RowIcon`, a tinted tile). A filled tile on every row of
a list reads heavier than the stripe it was meant to lighten; the tile
belongs on stat and banner surfaces, the same place JARVIS keeps it.

The stripe survives, and is still what `RailCard` renders when no `kind`
is passed, for rows that are a sentence rather than a record: a warning,
a note, a piece of prose. A type mark on a paragraph labels the wrong
thing.

Drawings live in `src/components/rowIcons.json`. One file, read by the
component and by every generator, because copies of a shared map drifted
three times in one sitting earlier in this project. Two laws in
`src/laws/stylingLaws.test.ts` hold it: every icon has a real drawing,
and no generator keeps its own copy.

This is the one place the catalog departs from JARVIS's own "chassis,
not a card pile" rule in docs/DESIGN_SYSTEM.md. Dave picked the card
knowingly. The DESIGN_SYSTEM reference to full-bleed rows now describes
JARVIS, not this app.

### S2, fit score (amended 2026-09-17)

A TINT carrying the number alone, no label, no ring, no track. Banded
green above 70, yellow 40 to 69, gray below, by `scoreRole()` in
`statusHue.ts` and nowhere else. Tinted rather than solid so it never
competes with the stage pill beside it.

### AV1, avatars

36px circle, a fixed systemBlue-to-systemIndigo gradient, initials in white, `font-extrabold`. The gradient is fixed. Do not
rotate the gradient per person.

### BT3, primary buttons

Solid `bg-solid-accent text-solid-accent-on`, `rounded-[8px]`, not
`rounded-full`. One primary action per surface, per the button law in
docs/DESIGN_SYSTEM.md.

Buttons are the only rectangular element in the system while pills,
tabs and toasts are all fully rounded. That contrast is intentional and
is what separates a control you press from a label you read. Do not
"fix" it by rounding buttons fully.

### ST1, stat tiles (amended 2026-09-17)

`rounded-[12px]`, background is the stat's tint pair rather than a solid
fill, so a row of tiles does not compete with the pills next to it.
Number at 18px `font-extrabold`, label below at 10.5px ALL CAPS at
`opacity-80` of the tint's paired foreground.

### TB1, bottom tab bar

The active tab's icon sits on a solid `--solid-accent` pill,
`rounded-[8px]`, label below in `--ink`. Inactive tabs are `--muted`
with no pill. Only the icon gets the pill, never the whole tab column.

### J1, journey stepper

Four nodes for Profile, In Contact, Visits, Committed, joined by 2px
segments. Completed nodes and the segments behind them are `--success`.
The current node is `--accent` and renders larger (13px against 10px).
Nodes ahead are `--line`. Derived live from the athlete's targets by
`src/lib/journey.ts`, never stored.

### F3, form inputs

Filled `bg-paper`, no border, `rounded-[10px]`, `px-3 py-2.5`. Label
above at 11px `font-bold text-muted`. Focus state is a 2px `--accent`
ring, since there is no border to recolor. Error state adds a
`--danger` ring plus the message below at 11.5px.

Every form component in `src/components/` follows this. The current
`inputClass` constants use a border and need converting.

### G3, board group headers (amended 2026-09-17)

A solid tinted pill tab carrying the group name and its count, tinted
in the group's status hue rather than solid-filled, because a group
header sits directly above rows that use the same hue at full
saturation and would otherwise compete with them.

### E1, empty states

Centered icon, title at 13px `font-extrabold`, one line of subtext at
11.5px `text-muted`. The subtext names the next action in plain words.
Never an empty container, and never a bare muted sentence with no icon.

### T3, toasts

A solid pill, full width of the content column, centered text at 12.5px
`font-extrabold`. Success uses the success pair, errors use accent.
Toasts confirm that something happened and never carry an action.

## What is enforced by tests

`src/laws/stylingLaws.test.ts`:

1. No component pairs a `bg-solid-*` fill with anything but its own
   `text-solid-*-on`, and the same for `bg-tint-*`.
2. No raw hex color in any component or page. `globals.css` is the only
   place a literal color may live.
3. Every `--ios-*` primitive equals Apple's published value, so the
   palette cannot drift.
4. Every role has a solid pair, a tint pair in both themes, and an entry
   in the Tailwind role list.
5. Every solid pair clears 4.5:1 as shipped, checking the values and not
   just that both tokens exist, so a hand-edit that skips the generator
   gets caught.
6. Every solid fill clears 3:1 against the dark page, so a chip always
   reads as a shape.

Each has been proven to fail on a planted violation rather than just
asserted, per `src/laws/README.md`.

## State of the conversion

Applied: all fourteen items across Today, Athletes, athlete detail,
Board, More, login, every form, and every empty state, on the Apple
palette and the role map above. The shared
primitives live in `src/components/catalog.tsx` and the single
status-to-hue mapping in `src/components/statusHue.ts`.

Not yet applied: **T3 toasts.** The app has no toast anywhere yet, since
every write is a server action that redirects rather than confirming in
place. T3 is specified and waiting for the first surface that needs it.

The red-rail problem is resolved. C2 used to give a statusless row an
accent rail, which put a red rail next to a red "Remove" on every contact
card. Now that red is action-only, contacts take `people` and visits take
`place`.
