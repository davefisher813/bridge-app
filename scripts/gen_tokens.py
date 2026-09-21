"""Generates the color token block in src/app/globals.css.

Two tiers, which is the whole point:

  1. Primitives. Apple's published iOS system colors, verbatim. These are
     the palette and nothing else may introduce a color.
  2. Roles. What each color MEANS in this app, derived from the
     primitives, with every fill and tint paired to a foreground that
     clears 4.5:1.

Tier 2 is derived, never hand-typed, so changing what a status means is a
one-line edit here rather than a contrast audit. Run:

    python3 scripts/gen_tokens.py --write

and it splices the result into globals.css between the generated markers.
Without --write it prints the block and a contrast report.
"""

import argparse
import colorsys
import re
import sys

# ---------------------------------------------------------------- primitives
# Apple's iOS system colors, light and dark. Verified against Apple's
# published values (Human Interface Guidelines). The org screens are forced
# dark, so the dark column is what almost everything here resolves to.
IOS = {
    "red":    ("#FF3B30", "#FF453A"),
    "orange": ("#FF9500", "#FF9F0A"),
    "yellow": ("#FFCC00", "#FFD60A"),
    "green":  ("#34C759", "#30D158"),
    "mint":   ("#00C7BE", "#63E6E2"),
    "teal":   ("#30B0C7", "#40CBE0"),
    "cyan":   ("#32ADE6", "#64D2FF"),
    "blue":   ("#007AFF", "#0A84FF"),
    "indigo": ("#5856D6", "#5E5CE6"),
    "purple": ("#AF52DE", "#BF5AF2"),
    "pink":   ("#FF2D55", "#FF375F"),
    "brown":  ("#A2845E", "#AC8E68"),
    "gray":   ("#8E8E93", "#8E8E93"),
}

# --------------------------------------------------------------------- roles
# What each color means. Grouped by axis: no screen mixes two axes at the
# same visual weight, which is what stops ten colors reading as noise.
#
# Stage axis (solid pills, the recruiting pipeline as one progression,
# cold to warm to green so the board reads as distance travelled):
STAGE = {
    "target":    "gray",
    "contact":   "blue",
    "visit":     "mint",
    "offer":     "orange",
    "committed": "green",
}
# Score axis (tints only, so a fit score never competes with a stage pill
# even where they share a hue):
SCORE = {"high": "green", "mid": "yellow", "low": "gray"}
# Field-type badge axis (small square badges on metadata rows):
FIELD = {"time": "yellow", "people": "teal", "place": "indigo"}
# Action axis. Red is the brand, the primary action and the destructive
# one. Danger used to be pink so Remove never looked like Add; Dave
# dropped the pink for the red he chose (2026-09-21). The two names
# stay separate so a destructive control is still marked in the code.
ACTION = {"accent": "red", "danger": "red", "neutral": "gray"}

PAPER = {"light": "#ffffff", "dark": "#1a1a1a"}
TARGET = 4.5


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return "#" + "".join(f"{max(0, min(255, round(c))):02x}" for c in rgb)


def luminance(h):
    def chan(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (chan(c) for c in hex_to_rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def shift(h, delta):
    r, g, b = (c / 255 for c in hex_to_rgb(h))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    return rgb_to_hex(tuple(c * 255 for c in colorsys.hls_to_rgb(hh, max(0.0, min(1.0, ll + delta)), ss)))


def mix(a, b, pct):
    ra, rb = hex_to_rgb(a), hex_to_rgb(b)
    return rgb_to_hex(tuple(ra[i] * pct + rb[i] * (1 - pct) for i in range(3)))


# Which way a filled chip reads is a convention, not just a contrast
# calculation. Apple puts white on red, pink, blue, indigo and purple, and
# dark text on yellow, orange, green, mint, teal and cyan. Following that
# matters more than preserving the exact hex: a red button with dark
# maroon text passes contrast and still looks wrong.
WHITE_TEXT_HUES = {"red", "pink", "blue", "indigo", "purple", "brown", "gray"}


def solid_pair(hue, prim=None):
    """A filled background and the only foreground allowed on it.

    White-text hues keep white and the FILL darkens until it clears, which
    is why the filled red is deeper than systemRed: white on systemRed is
    3.4:1 and fails. Dark-text hues keep their exact Apple value and the
    FOREGROUND darkens instead, so yellow stays yellow and mint stays mint.
    """
    if prim not in WHITE_TEXT_HUES:
        fg = hue
        for _ in range(80):
            fg = shift(fg, -0.03)
            if contrast(hue, fg) >= TARGET:
                return hue, fg
    fill = hue
    for _ in range(80):
        if contrast(fill, "#ffffff") >= TARGET:
            return fill, "#ffffff"
        fill = shift(fill, -0.02)
    return fill, "#ffffff"


def tint_pair(hue, paper):
    """The hue at 22 percent over the paper, plus a foreground for it.

    The direction comes from how light the resulting tint actually is, not
    from which theme it was declared in.
    """
    bg = mix(hue, paper, 0.22)
    step = 0.04 if luminance(bg) < 0.4 else -0.04
    fg = hue
    for _ in range(60):
        if contrast(bg, fg) >= TARGET:
            return bg, fg
        fg = shift(fg, step)
    return bg, fg


def build():
    roles = {}
    for group in (STAGE, SCORE, FIELD, ACTION):
        for role, prim in group.items():
            roles[role] = prim

    lines, report = [], []
    lines.append("  /* Primitives: Apple's iOS system colors, dark values. */")
    for name in ("red", "orange", "yellow", "green", "mint", "teal", "cyan", "blue", "indigo", "purple", "pink", "brown", "gray"):
        lines.append(f"  --ios-{name}: {IOS[name][1]};")

    lines.append("")
    lines.append("  /* Roles: solid fill plus its only legal foreground. */")
    for role, prim in roles.items():
        hue = IOS[prim][1]
        bg, fg = solid_pair(hue, prim)
        lines.append(f"  --solid-{role}: {bg};")
        lines.append(f"  --solid-{role}-on: {fg};")
        report.append((f"solid {role} ({prim})", bg, fg, contrast(bg, fg)))

    for theme in ("light", "dark"):
        block = []
        for role, prim in roles.items():
            hue = IOS[prim][1 if theme == "dark" else 0]
            bg, fg = tint_pair(hue, PAPER[theme])
            block.append(f"  --tint-{role}: {bg};")
            block.append(f"  --tint-{role}-on: {fg};")
            report.append((f"tint {theme} {role}", bg, fg, contrast(bg, fg)))
        lines.append("")
        lines.append(f"  /* __TINTS_{theme.upper()}__ */")
        lines.extend(block)
    return "\n".join(lines), report


def split_themes(block):
    """The tints are themed; everything else is not. Returns (root, dark)."""
    root, dark, cur = [], [], None
    for line in block.split("\n"):
        if "__TINTS_LIGHT__" in line:
            cur = "light"
            continue
        if "__TINTS_DARK__" in line:
            cur = "dark"
            continue
        if cur == "dark":
            dark.append(line)
        else:
            root.append(line)
    return "\n".join(root).rstrip(), "\n".join(dark).strip()


BEGIN = "  /* BEGIN GENERATED TOKENS - scripts/gen_tokens.py */"
END = "  /* END GENERATED TOKENS */"

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    block, report = build()
    root, dark = split_themes(block)

    worst = min(r[3] for r in report)
    failures = [r for r in report if r[3] < TARGET]
    for label, bg, fg, c in report:
        if c < TARGET:
            print(f"FAIL {label}: {bg} on {fg} = {c:.2f}:1", file=sys.stderr)
    print(f"{len(report)} pairs, worst {worst:.2f}:1, {len(failures)} failures")

    if failures:
        sys.exit(1)

    if not args.write:
        print(root)
        print("\n--- dark overrides ---")
        print(dark)
        sys.exit(0)

    path = "src/app/globals.css"
    css = open(path).read()
    new_root = f"{BEGIN}\n{root}\n{END}"
    css = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), new_root, css, flags=re.S)
    dark_begin = "  /* BEGIN GENERATED DARK TINTS - scripts/gen_tokens.py */"
    dark_end = "  /* END GENERATED DARK TINTS */"
    css = re.sub(
        re.escape(dark_begin) + r".*?" + re.escape(dark_end),
        f"{dark_begin}\n{dark}\n{dark_end}",
        css,
        flags=re.S,
    )
    open(path, "w").write(css)
    print(f"wrote {path}")
