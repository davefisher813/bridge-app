# Styling catalog (LOCKED)

Status: **locked, 2026-09-15.** Dave selected all fourteen component
treatments from the visual catalog artifact. This document is the
contract. A screen that renders one of these components renders it the
way this file says, or the law tests in `src/laws/` fail.

Changing a locked item is a conversation with Dave, not a judgment call
mid-screen. Adding a component type that is not in this file means
adding it here first.

## The selections

| Component | Code | Treatment |
| --- | --- | --- |
| Status pills | P1 | Solid fill, paired foreground |
| Section headers | H1 | Colored dot, dotted rule, trailing count |
| Metadata icon badges | B1 | Solid square badge, one hue per field type |
| Cards and rows | C2 | Solid card, colored left border rail |
| Fit score | S2 | Solid numeric pill |
| Avatars | AV1 | Gradient fill with initials |
| Primary buttons | BT3 | Solid rounded rectangle |
| Stat tiles | ST1 | Tinted background |
| Bottom tab bar | TB1 | Active tab gets a solid pill behind the icon |
| Journey stepper | J1 | Connected dots, line fills as it completes |
| Form inputs | F3 | Filled, no border |
| Board group headers | G3 | Solid tinted pill tab |
| Empty states | E1 | Icon, title, subtext, centered |
| Toasts | T3 | Solid pill |

## The solid fill rule

Most of what Dave picked is solid saturated color rather than the tints
the app shipped with. Solid fills are the single biggest source of
unreadable text in a dark UI, so they are tokenized in pairs.

Every fill in `src/app/globals.css` ships as `--solid-X` (background)
and `--solid-X-on` (the only foreground allowed on it), exposed to
Tailwind as `bg-solid-X` and `text-solid-X-on`. Using a fill with any
other text color is a law violation.

| Pair | Fill | Foreground | Contrast |
| --- | --- | --- | --- |
| accent | `#d32011` | `#ffffff` | 5.27:1 |
| success | `#10b981` | `#052e21` | 5.83:1 |
| info | `#4f46e5` | `#ffffff` | 6.29:1 |
| neutral | `#3f3f46` | `#e4e4e7` | 8.23:1 |
| time | `#f59e0b` | `#3a2503` | 6.76:1 |
| people | `#14b8a6` | `#04302c` | 5.76:1 |
| place | `#9333ea` | `#ffffff` | 5.38:1 |

Every pair clears 4.5:1. The large-text exemption does not apply: pills
render at 11px bold, and WCAG large text starts at 14pt bold (about
18.7px). White on `--accent` itself is 3.4:1, which is why
`--solid-accent` is a deeper red than `--accent` rather than the same
value. They are two different jobs:

- `--accent` for borders, underlines, icons and text on a dark surface.
- `--solid-accent` only as a filled background, always with
  `--solid-accent-on` over it.

The solid pairs are not themed. Each pair is self-contained and reads
the same on the forced-dark org screens and the light login screen, so
there is no second set of values to drift.

**Fill versus background.** A fill also has to read as a shape against
the surface behind it. The colored fills all clear 3:1 against the dark
app background. `--solid-neutral` is 1.87:1, close in value to the
background by design, so anything using the neutral fill carries a
`border border-line` hairline. That is the one fill with an extra rule.

## The tint rule

Two items are tinted rather than solid, because they sit directly beside
surfaces carrying the same hue at full saturation: stat tiles (ST1) and
board group tabs (G3).

A tint has the same failure mode as a fill, just quieter. The first pass
used the hue at 15 percent over the page with the hue itself as text,
which measured 3.2:1 and, worse, barely registered as a surface at all:
the tiles read as floating numbers rather than tiles. So tints are
tokenized in pairs exactly like fills, at 22 percent of the hue over
`--paper`.

| Pair | Dark fill | Dark on | Ratio | Light fill | Light on | Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| accent | `#4c2321` | `#ffb4ae` | 7.89:1 | `#ffd4d1` | `#a11109` | 6.00:1 |
| success | `#183d31` | `#6ee7b7` | 7.87:1 | `#caf0e3` | `#065f46` | 6.25:1 |
| info | `#2a2b49` | `#a5b4fc` | 6.84:1 | `#ddddfc` | `#3730a3` | 7.48:1 |
| neutral | `#37383b` | `#e4e4e7` | 9.24:1 | `#dee0e3` | `#3f3f46` | 7.90:1 |

Unlike the solid pairs, tints **are** themed. A tint is defined against
the paper behind it, and that paper flips between themes, so a tint
declared in only one theme is wrong in the other. The law checks for
both.

Text inside a tinted surface uses that tint's own foreground, never
`text-muted`: muted is chosen against the page, not against a tint, and
lands near 3:1 on one. A secondary line inside a tint drops to
`opacity-80` of the paired foreground instead.

## Component contracts

### P1, status pills

`src/components/StatusPill.tsx` is the only implementation. Do not
re-style status text inline anywhere.

Rounded full, `px-2.5 py-1`, 11px, `font-bold`. Solid fill plus its
paired foreground. The status color language is unchanged from
docs/DESIGN_SYSTEM.md: success for Active and Offer, info for In
Contact and Visit, accent for Committed, neutral for everything else
including Target, Not Interested and any unrecognized value.

### H1, section headers

Colored dot, label, dotted rule filling the gap, count at the trailing
edge. Label is ALL CAPS, `font-extrabold`, `text-muted`. The count is
`text-ink`, not muted, because the number is the useful part. The dot
is `--accent` unless the section maps to a status, in which case it is
that status hue.

The rule is `border-bottom: 2px dotted var(--line)` on a flexed spacer,
never a background image or a row of typed characters.

### B1, metadata icon badges

A 30px solid square, `rounded-[8px]`, icon centered, one hue per field
type. Three hues exist and they are named for their role:

- `time` (amber): due dates, last contact, days idle, anything on a clock.
- `people` (teal): coaches, contacts, assigned staff.
- `place` (purple): schools, divisions, locations, visits.

Anything outside those three uses `neutral`. The status hues are never
reused as field badges, so a badge can never be mistaken for a status.
Adding a fourth field-type hue means adding a token pair here first,
with its contrast ratio recorded in the table above.

### C2, cards and rows

Solid `bg-paper`, `rounded-[10px]`, `border-left: 5px` in a meaningful
color, which means the row's status hue, or `--accent` for a row with no
status. Not a glass surface, and not a hairline-divided full-bleed row.

This is the one place the catalog departs from JARVIS's own "chassis,
not a card pile" rule in docs/DESIGN_SYSTEM.md. Dave picked the rail
card knowingly. The DESIGN_SYSTEM reference to full-bleed rows now
describes JARVIS, not this app.

### S2, fit score

A solid pill carrying the number alone, no label, no ring, no track.
Fill is picked by band: success at 70 and above, time at 40 to 69,
neutral below 40. The bands live in one place in code, never inline per
screen.

### AV1, avatars

36px circle, `linear-gradient(135deg, var(--info), var(--accent))`,
initials in white, `font-extrabold`. The gradient is fixed. Do not
rotate the gradient per person.

### BT3, primary buttons

Solid `bg-solid-accent text-solid-accent-on`, `rounded-[8px]`, not
`rounded-full`. One primary action per surface, per the button law in
docs/DESIGN_SYSTEM.md.

Buttons are the only rectangular element in the system while pills,
tabs and toasts are all fully rounded. That contrast is intentional and
is what separates a control you press from a label you read. Do not
"fix" it by rounding buttons fully.

### ST1, stat tiles

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

### G3, board group headers

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

`src/laws/stylingLaws.test.ts` checks the rules that can be checked
statically:

1. No component pairs a `bg-solid-*` fill with anything but its own
   `text-solid-*-on` foreground.
2. The same for `bg-tint-*` and `text-tint-*-on`.
3. The neutral fill always carries its `border-line` hairline.
4. No raw hex color in any component or page. Colors come from tokens.
5. Every `--solid-*` fill declared in `globals.css` has a matching `-on`
   token, and both are exposed in `tailwind.config.ts`.
6. Every `--tint-*` has its `-on`, is declared in **both** themes, and
   reaches Tailwind.

Each of those has been proven to fail on a planted violation rather than
just asserted, per `src/laws/README.md`. One of them, the both-themes
tint check, passed vacuously on the first attempt (it was scanning the
whole file rather than the dark blocks) and was only caught because the
planted violation did not fail. That is the entire argument for planting
one.

Rules that cannot be checked statically, such as whether a card's rail
color is meaningful, are reviewed against this document instead.

## State of the conversion

Applied: all fourteen items across Today, Athletes, athlete detail,
Board, More, login, every form, and every empty state. The shared
primitives live in `src/components/catalog.tsx` and the single
status-to-hue mapping in `src/components/statusHue.ts`.

Not yet applied: **T3 toasts.** The app has no toast anywhere yet, since
every write is a server action that redirects rather than confirming in
place. T3 is specified and waiting for the first surface that needs it.

One thing worth revisiting with Dave. C2 says a row with no status of its
own takes an accent rail. On the athlete detail screen that makes both
the contacts and the visits lists red-railed, and a contact card's
red rail sits next to its red "Remove" control. It reads fine, but the
field-type hues (`people` for contacts, `place` for visits) would read
better, and that would be a change to a locked item, so it is his call,
not a quiet fix.
