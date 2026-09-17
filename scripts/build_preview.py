"""Builds the full-app preview artifact.

The point of this script: the preview's CSS is the app's OWN compiled
Tailwind output, not a hand-written approximation and not the Play CDN.
Every class name in the markup below is copied from the real component or
page source, so if the preview looks right, the app looks right. If a
class were wrong, it would simply have no styling here rather than
silently looking fine.

The colour maps are PARSED OUT of src/components/statusHue.ts at build
time rather than copied here. They were copied at first, and drifted three
separate times in one sitting: a mint Visit pill on a blue rail, a red
"Fit" tag after red stopped being a rating, a red rail on a contact card.
A preview that lies about the app is worse than no preview.

Run: npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify
then python3 scripts/build_preview.py
"""

import json
import re

CSS = open("/tmp/preview.css").read()

# The app's own body rule hardcodes the light tokens onto body. This page
# has its own chrome that follows the viewer's theme, so that one rule is
# dropped here and each phone frame paints its own background instead.
CSS = re.sub(r"body\{[^}]*\}", "", CSS, count=1)

SCREENS = {}

# ----------------------------------------------------------------- Today
SCREENS["today"] = ("Today", "dark", """
<main class="px-4 pt-2">
  <h1 class="mb-4 text-[28px] font-black leading-tight text-ink">Good morning,<br>Dave.</h1>

  <div class="flex gap-2">
    <div class="flex-1 rounded-[12px] px-3 py-2.5 bg-tint-neutral text-tint-neutral-on">
      <div class="text-[20px] font-extrabold tabular-nums">24</div>
      <div class="mt-0.5 text-[11.5px] font-bold uppercase tracking-[0.03em] opacity-80">Athletes</div>
    </div>
    <div class="flex-1 rounded-[12px] px-3 py-2.5 bg-tint-contact text-tint-contact-on">
      <div class="text-[20px] font-extrabold tabular-nums">7</div>
      <div class="mt-0.5 text-[11.5px] font-bold uppercase tracking-[0.03em] opacity-80">In contact</div>
    </div>
    <div class="flex-1 rounded-[12px] px-3 py-2.5 bg-tint-committed text-tint-committed-on">
      <div class="text-[20px] font-extrabold tabular-nums">3</div>
      <div class="mt-0.5 text-[11.5px] font-bold uppercase tracking-[0.03em] opacity-80">Committed</div>
    </div>
  </div>
  <div class="mt-2 flex h-1 overflow-hidden rounded-full bg-line">
    <div class="bg-ios-blue" style="width:38%"></div>
    <div class="bg-ios-green" style="width:16%"></div>
  </div>

  <div class="mb-2 mt-6">__SH_FOLLOWUP__</div>
  <div class="flex flex-col gap-2">
    
    
    <a href="#" class="mt-1 self-end text-[13px] font-bold text-accent">View board &rarr;</a>
  </div>

  <div class="mb-2 mt-6">__SH_UPCOMING__</div>
  <div class="flex flex-col gap-2">
    <div class="rounded-[10px] bg-paper px-3.5 py-3">
      <div class="text-[15px] font-bold text-ink">Visit &middot; Fairview State</div>
      <div class="text-[12.5px] text-muted">Fri, Sep 19 &middot; Marcus Bell</div>
    </div>
    <div class="rounded-[10px] bg-paper px-3.5 py-3">
      <div class="text-[15px] font-bold text-ink">Transfer portal opens</div>
      <div class="text-[12.5px] text-muted">Baseball D1 &middot; Fall window &middot; in 42 days</div>
    </div>
  </div>
</main>
""")

# --------------------------------------------------------------- Athletes
SCREENS["roster"] = ("Athletes", "dark", """
<main>
  <div class="px-4 pt-4">
    <div class="mb-2 flex items-center justify-between">
      <div class="text-[22px] font-extrabold text-ink">Athletes</div>
      <a href="#" class="text-[13px] font-bold text-accent">+ Add</a>
    </div>
    <div class="flex flex-col gap-2">
      __ROW_MARCUS__
      __ROW_AVA__
      __ROW_DIEGO__
      __ROW_TYLER__
    </div>
  </div>
</main>
""")

# --------------------------------------------------------- Athlete detail
SCREENS["athlete"] = ("Athlete detail", "dark", """
<main class="px-4 pt-2 pb-6">
  <div class="mb-4 flex items-center justify-between">
    <a href="#" class="text-[14.5px] font-bold text-muted">&larr; Athletes</a>
    <a href="#" class="text-[13px] font-bold text-accent">Edit</a>
  </div>
  <h1 class="text-[22px] font-extrabold text-ink">Marcus Bell</h1>
  <div class="mt-1 text-[14.5px] text-muted">Baseball &middot; SS &middot; High School &middot; 3.62 GPA</div>

  <div class="mt-6 rounded-[12px] bg-paper p-4">
    <div>
      <div class="flex items-center">
        __STEP_1__ __STEP_2__ __STEP_3__ __STEP_4__
      </div>
      <p class="mt-2.5 text-[12px] text-muted">Furthest stage: Visit (Fairview State)</p>
    </div>
  </div>

  <div class="mt-8">
    <div class="mb-2">__SH_COLLEGES__</div>
    <div class="flex flex-col gap-2">
      <div class="rounded-[10px] bg-paper px-3.5 py-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-[15px] font-semibold text-ink">Fairview State</div>
            <div class="text-[13px] text-muted">D2</div>
          </div>
          __PILL_VISIT__
        </div>
      </div>
      <div class="rounded-[10px] bg-paper px-3.5 py-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-[15px] font-semibold text-ink">Northgate College</div>
            <div class="text-[13px] text-muted">D3 &middot; preferred offer</div>
          </div>
          __PILL_OFFER__
        </div>
      </div>
    </div>
  </div>

  <div class="mt-8">
    <div class="mb-2">__SH_CONTACTS__</div>
    <div class="flex flex-col gap-2">
      <div class="rounded-[10px] bg-paper px-3.5 py-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-[14.5px] font-bold text-ink">Coach Rivera</div>
            <div class="text-[12.5px] text-muted">HS coach</div>
            <div class="mt-1 text-[13px] text-muted">rivera@example.edu &middot; 203 555 0148</div>
          </div>
          <button class="text-[12.5px] font-bold text-danger">Remove</button>
        </div>
      </div>
    </div>
  </div>
</main>
""")

# ------------------------------------------------------------------ Board
SCREENS["board"] = ("Board", "dark", """
<main>
  <div class="px-4 pt-4">
    <div class="mb-2 flex items-center justify-end">
      <a href="#" class="text-[13px] font-bold text-accent">+ Add target</a>
    </div>

    <div class="mb-6">
      <div class="mb-2">__TAB_INCONTACT__</div>
      <div class="flex flex-col gap-2">
        __BOARD_MARCUS__
        __BOARD_AVA__
      </div>
    </div>

    <div class="mb-6">
      <div class="mb-2">__TAB_COMMITTED__</div>
      <div class="flex flex-col gap-2">
        __BOARD_DIEGO__
      </div>
    </div>
  </div>
</main>
""")

# ------------------------------------------------------------------- Form
SCREENS["form"] = ("Add athlete", "dark", """
<main class="px-4 pt-2 pb-6">
  <div class="mb-4 flex items-center gap-3">
    <a href="#" class="text-[14.5px] font-bold text-muted">&larr; Athletes</a>
  </div>
  <h1 class="mb-4 text-[22px] font-extrabold text-ink">Add athlete</h1>
  <form class="flex flex-col gap-4">
    <div>
      <label class="mb-1.5 block text-[12px] font-bold text-muted">Name</label>
      <input class="w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" placeholder="Jose Ulloa">
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="mb-1.5 block text-[12px] font-bold text-muted">Sport</label>
        <input class="w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" value="Baseball">
      </div>
      <div>
        <label class="mb-1.5 block text-[12px] font-bold text-muted">Position</label>
        <input class="w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" placeholder="RHP">
      </div>
    </div>
    <div>
      <label class="mb-1.5 block text-[12px] font-bold text-muted">GPA</label>
      <input class="w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[15px] text-ink placeholder:text-muted ring-2 ring-danger focus:outline-none focus:ring-2 focus:ring-danger" value="5.2">
      <p class="mt-1 text-[12.5px] font-semibold text-danger">GPA must be between 0 and 4.</p>
    </div>
    <div>
      <label class="mb-1.5 block text-[12px] font-bold text-muted">Recruit type</label>
      <select class="w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-accent">
        <option>High School</option>
      </select>
    </div>
    <button class="mt-1 rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Add athlete</button>
  </form>
</main>
""")

# ------------------------------------------------------------ Empty state
SCREENS["empty"] = ("Empty state", "dark", """
<main>
  <div class="px-4 pt-4">
    <div class="mb-2 flex items-center justify-between">
      <div class="text-[22px] font-extrabold text-ink">Athletes</div>
      <a href="#" class="text-[13px] font-bold text-accent">+ Add</a>
    </div>
    <div class="rounded-[12px] bg-paper px-4 py-8 text-center">
      <div class="mb-2 flex justify-center text-muted">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="h-7 w-7">
          <circle cx="12" cy="8" r="3.4"></circle>
          <path d="M5 20c1-4 4-6 7-6s6 2 7 6" stroke-linecap="round"></path>
        </svg>
      </div>
      <div class="text-[14.5px] font-extrabold text-ink">No athletes yet</div>
      <div class="mt-1 text-[12.5px] text-muted"><a href="#" class="font-bold text-accent">Add your first athlete &rarr;</a></div>
    </div>
  </div>
</main>
""")

# ------------------------------------------------------------------- More
SCREENS["more"] = ("More", "dark", """
<main class="px-4 pt-2">
  <div class="mb-3">__SH_MORE__</div>
  <div class="flex flex-col gap-2">
    <div class="rounded-[10px] bg-paper px-3.5 py-3">
      <div class="text-[15px] font-semibold text-ink">Dave Fisher</div>
      <div class="text-[13px] text-muted">Bridge Foundation for Student Athletes</div>
    </div>
    <button class="w-full rounded-[10px] bg-paper px-3.5 py-3 text-left text-[15px] font-semibold text-danger">Sign out</button>
  </div>
</main>
""")

# ------------------------------------------------------------------ Login
SCREENS["login"] = ("Login", "light", """
<main class="flex min-h-full items-center justify-center px-5 py-10">
  <div class="w-full max-w-[340px]">
    <div class="rounded-[16px] bg-paper p-5">
      <h1 class="mb-1 text-[22px] font-extrabold text-ink">Sign in</h1>
      <p class="mb-5 text-[13.5px] text-muted">Bridge Foundation for Student Athletes</p>
      <form class="flex flex-col gap-4">
        <div class="flex flex-col gap-[6px]">
          <label class="text-[13px] font-semibold text-muted">Email</label>
          <input class="rounded-[10px] border-0 bg-bg px-3 py-2.5 text-[16px] text-ink outline-none focus:ring-2 focus:ring-accent" value="dave@bffsa.org">
        </div>
        <div class="flex flex-col gap-[6px]">
          <label class="text-[13px] font-semibold text-muted">Password</label>
          <input type="password" class="rounded-[10px] border-0 bg-bg px-3 py-2.5 text-[16px] text-ink outline-none focus:ring-2 focus:ring-accent" value="passwordvalue">
        </div>
        <button class="mt-1 rounded-[8px] bg-solid-accent py-[13px] text-[15px] font-extrabold tracking-[0.02em] text-solid-accent-on">Sign In</button>
      </form>
    </div>
    <p class="mt-4 text-center text-[12.5px] text-muted">Accounts are created by your organization, not self-service.</p>
  </div>
</main>
""")


# --------------------------------------------------------------- fragments
def section_header(label, count=None, dot="bg-accent"):
    c = (
        f'<span class="text-[13px] font-extrabold tabular-nums text-ink">{count}</span>'
        if count is not None
        else ""
    )
    return (
        '<div class="flex items-center gap-2">'
        f'<span class="h-[7px] w-[7px] flex-shrink-0 rounded-full {dot}"></span>'
        f'<span class="text-[13px] font-extrabold uppercase tracking-[0.04em] text-muted">{label}</span>'
        '<span class="h-px flex-1 border-b-2 border-dotted border-line"></span>'
        f"{c}</div>"
    )


# Parsed from the real component, so the preview cannot disagree with it.
def _parse_ts_map(source, name):
    body = re.search(name + r"\s*(?::[^=]*)?=\s*\{(.*?)\n\}", source, re.S)
    if not body:
        raise SystemExit(f"could not find {name} in statusHue.ts")
    out = {}
    for k, v in re.findall(r'"?([A-Za-z ]+)"?\s*:\s*"([^"]+)"', body.group(1)):
        out[k.strip()] = v
    return out


_HUE_SRC = open("src/components/statusHue.ts").read()
STATUS_ROLE = _parse_ts_map(_HUE_SRC, "STATUS_ROLE")
SOLID = _parse_ts_map(_HUE_SRC, "SOLID")
TINT = _parse_ts_map(_HUE_SRC, "TINT")
DOT_MAP = _parse_ts_map(_HUE_SRC, "DOT")

STAGE_KIND = _parse_ts_map(_HUE_SRC, "STAGE_KIND")
FG = _parse_ts_map(_HUE_SRC, "FG")
ICONS = {k: v for k, v in json.load(open("src/components/rowIcons.json")).items() if k != "_comment"}


def glyph(kind, role="neutral", size=20):
    d = ICONS.get(kind, "")
    if not d:
        return ""
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 {FG[role]}" '
            f'style="width:{size}px;height:{size}px">{d}</svg>')

HUE_OF = STATUS_ROLE


# No colour block, per 2026-09-17: a glyph in the stage's hue and a plain
# label, the same anatomy as the type mark on the row.
def pill(status):
    return (f'<span class="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-ink">'
            f'{glyph(STAGE_KIND.get(status, "stage_none"), STATUS_ROLE.get(status, "neutral"), 15)}{status}</span>')


def avatar(name):
    parts = name.split()
    ini = (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()
    return (
        '<div class="flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br '
        'from-ios-blue to-ios-indigo font-extrabold text-white" style="width:34px;height:34px;font-size:12px">'
        f"{ini}</div>"
    )


HUE_OF = {"Active": "committed", "In Contact": "contact", "Visit": "visit",
          "Offer": "offer", "Committed": "committed", "Target": "target"}


def roster_row(name, meta, gpa, status):
    return f"""<a href="#" class="block"><div class="rounded-[10px] bg-paper px-3.5 py-3">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">{avatar(name)}
      <div><div class="text-[16px] font-semibold text-ink">{name}</div>
      <div class="text-[13px] text-muted">{meta}</div></div>
    </div>
    <div class="flex flex-col items-end gap-1">
      <div class="text-[14.5px] font-semibold tabular-nums text-ink">{gpa}</div>{pill(status)}
    </div>
  </div></div></a>"""


def score_pill(score):
    # Tint, not solid: stage and score are different axes and must not
    # compete for the same colour. See ScorePill in catalog.tsx.
    cls = (
        "bg-tint-high text-tint-high-on"
        if score >= 70
        else "bg-tint-mid text-tint-mid-on"
        if score >= 40
        else "bg-tint-low text-tint-low-on"
    )
    return f'<span class="inline-flex items-center rounded-full px-3 py-1 text-[14.5px] font-extrabold tabular-nums {cls}">{score}</span>'


TAG_STYLE = {"Safety": "text-ios-green", "Fit": "text-ink", "Reach": "text-muted", "Conflict": "text-ios-pink", "Unknown": "text-muted"}


def board_row(athlete, school, meta, score, tag, status):
    return f"""<a href="#" class="block"><div class="rounded-[10px] bg-paper px-3.5 py-3">
  <div class="flex items-center justify-between gap-3">
    <div>
      <div class="text-[16px] font-semibold text-ink">{athlete} <span class="font-normal text-muted">to</span> {school}</div>
      <div class="text-[13px] text-muted">{meta}</div>
    </div>
    <div class="flex flex-shrink-0 flex-col items-end gap-1">{score_pill(score)}
      <div class="text-[12px] font-bold {TAG_STYLE[tag]}">{tag}</div>
    </div>
  </div></div></a>"""


def group_tab(label, count, hue):
    return (f'<span class="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-ink">'
            f'{glyph(STAGE_KIND.get(label, "stage_none"), hue, 15)}{label} &middot; {count}</span>')


def rail_card(hue, inner):
    return f'<div class="rounded-[10px] bg-paper px-3.5 py-3">{inner}</div>'


def followup(name, sub, status):
    inner = f"""<div class="flex items-center justify-between gap-3">
  <div><div class="text-[15px] font-bold text-ink">{name}</div>
  <div class="text-[12.5px] text-muted">{sub}</div></div>{pill(status)}</div>"""
    return rail_card(HUE_OF[status], inner)


def step(kind, label, first=False):
    seg = ""
    if not first:
        color = "bg-ios-green" if kind in ("done", "current") else "bg-line"
        seg = f'<div class="absolute left-[-50%] top-[6px] h-0.5 w-full {color}"></div>'
    dot = {
        "done": "h-[10px] w-[10px] bg-ios-green",
        "current": "h-[13px] w-[13px] bg-ios-red",
        "todo": "h-[10px] w-[10px] bg-line",
    }[kind]
    text = "text-ink" if kind in ("done", "current") else "text-muted"
    return f"""<div class="relative flex flex-1 flex-col items-center gap-2">{seg}
  <div class="z-10 flex h-[14px] items-center"><div class="rounded-full {dot}"></div></div>
  <div class="text-center text-[11px] font-bold {text}">{label}</div></div>"""


FRAGMENTS = {
    "__SH_FOLLOWUP__": section_header("Needs follow-up", 2),
    "__SH_UPCOMING__": section_header("Upcoming", 2),
    "__SH_COLLEGES__": section_header("Colleges", 2),
    "__SH_CONTACTS__": section_header("Contacts", 1),
    "__SH_MORE__": section_header("More"),
    "": followup("Ava Thompson", "Riverside University &middot; no update in 14 days", "In Contact"),
    "": followup("Marcus Bell", "Fairview State &middot; no update in 9 days", "Visit"),
    "__ROW_MARCUS__": roster_row("Marcus Bell", "Baseball &middot; SS &middot; High School", "3.62", "Active"),
    "__ROW_AVA__": roster_row("Ava Thompson", "Softball &middot; OF &middot; High School", "3.91", "Active"),
    "__ROW_DIEGO__": roster_row("Diego Marin", "Baseball &middot; RHP &middot; Transfer (JUCO)", "3.10", "Committed"),
    "__ROW_TYLER__": roster_row("Tyler Nwosu", "Baseball &middot; C &middot; High School", "2.84", "Target"),
    "__BOARD_MARCUS__": board_row("Marcus Bell", "Fairview State", "Baseball &middot; D2 &middot; Coach Rivera", 78, "Fit", "In Contact"),
    "__BOARD_AVA__": board_row("Ava Thompson", "Riverside University", "Softball &middot; D1", 54, "Reach", "In Contact"),
    "__BOARD_DIEGO__": board_row("Diego Marin", "Northgate College", "Baseball &middot; D3", 88, "Safety", "Committed"),
    "__TAB_INCONTACT__": group_tab("In Contact", 2, "contact"),
    "__TAB_COMMITTED__": group_tab("Committed", 1, "committed"),
    "__PILL_VISIT__": pill("Visit"),
    "__PILL_OFFER__": pill("Offer"),
    "__STEP_1__": step("done", "Profile", first=True),
    "__STEP_2__": step("done", "In Contact"),
    "__STEP_3__": step("current", "Visits"),
    "__STEP_4__": step("todo", "Committed"),
}

TABS = [
    ("today", "Today", '<path d="M3 11l9-7 9 7M5 10v9h5v-5h4v5h5v-9" stroke-linecap="round" stroke-linejoin="round"/>'),
    ("roster", "Athletes", '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6" stroke-linecap="round"/>'),
    ("board", "Board", '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4" stroke-linecap="round"/>'),
    ("more", "More", '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
]


def tab_bar(active):
    items = []
    for key, label, icon in TABS:
        on = key == active
        wrap = (
            "flex h-[26px] w-[38px] items-center justify-center rounded-[8px] bg-solid-accent text-solid-accent-on"
            if on
            else "flex h-[26px] w-[38px] items-center justify-center"
        )
        items.append(
            f'<a href="#" data-goto="{key}" class="flex flex-1 flex-col items-center gap-1 text-[11px] font-bold '
            f'{"text-ink" if on else "text-muted"}"><span class="{wrap}">'
            f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-5 w-5">{icon}</svg>'
            f"</span>{label}</a>"
        )
    return (
        '<nav class="sticky bottom-0 flex border-t border-line bg-paper/90 px-1.5 pb-3.5 pt-2 backdrop-blur">'
        + "".join(items)
        + "</nav>"
    )


TAB_FOR = {"today": "today", "roster": "roster", "athlete": "roster", "board": "board", "form": "roster", "empty": "roster", "more": "more"}

blocks = []
options = []
for key, (title, theme, body) in SCREENS.items():
    for marker, frag in FRAGMENTS.items():
        body = body.replace(marker, frag)
    chrome = ""
    if key != "login":
        chrome = (
            '<div class="flex items-center justify-between border-b border-line px-4 py-2.5">'
            '<span class="text-[14.5px] font-extrabold text-ink">Bridge</span>'
            '<span class="text-[12px] text-muted">Executive Director</span></div>'
        )
    bar = tab_bar(TAB_FOR[key]) if key != "login" else ""
    theme_attr = ' data-theme="dark"' if theme == "dark" else ""
    blocks.append(
        f'<div class="screen" data-screen="{key}" hidden>'
        f'<div class="phone {"phone-dark" if theme == "dark" else "phone-light"}"{theme_attr}>'
        f'<div class="phone-inner">{chrome}<div class="phone-scroll">{body}</div>{bar}</div></div></div>'
    )
    options.append(f'<option value="{key}">{title}</option>')

HTML = f"""<title>Bridge App Preview</title>
<style>
{CSS}

:root {{
  --page-bg: #f5f5f7; --page-fg: #1c1c1e; --page-muted: #6e6e73; --page-line: #d8d8dc; --page-card: #fff;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --page-bg: #0b0b0d; --page-fg: #f2f2f4; --page-muted: #9a9aa2; --page-line: #2a2a2e; --page-card: #17171a;
  }}
}}
:root[data-theme="dark"] {{
  --page-bg: #0b0b0d; --page-fg: #f2f2f4; --page-muted: #9a9aa2; --page-line: #2a2a2e; --page-card: #17171a;
}}
body {{
  background: var(--page-bg); color: var(--page-fg);
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  max-width: 760px; margin: 0 auto; padding: 18px 16px 60px;
}}
h1.page {{ font-size: 20px; font-weight: 800; margin: 0 0 4px; }}
p.lede {{ color: var(--page-muted); font-size: 13.5px; line-height: 1.5; margin: 0 0 16px; }}
.controls {{ display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }}
select {{
  font: inherit; font-size: 13px; font-weight: 600; padding: 7px 10px; border-radius: 9px;
  border: 1px solid var(--page-line); background: var(--page-card); color: var(--page-fg);
}}
.hint {{ font-size: 11.5px; color: var(--page-muted); }}
.phone {{
  width: 100%; max-width: 390px; margin: 0 auto; border-radius: 26px; overflow: hidden;
  border: 1px solid var(--page-line); box-shadow: 0 10px 34px rgba(0,0,0,.22);
}}
.phone-dark {{ background: #0c0c0c; }}
.phone-light {{ background: #f4f4f5; }}
.phone-inner {{ display: flex; flex-direction: column; height: 720px; }}
.phone-scroll {{ flex: 1; overflow-y: auto; }}
.screen[hidden] {{ display: none !important; }}
.note {{
  margin-top: 18px; font-size: 12.5px; line-height: 1.55; color: var(--page-muted);
  border-top: 1px solid var(--page-line); padding-top: 14px;
}}
</style>

<h1 class="page">Bridge app, in the locked styling</h1>
<p class="lede">Every screen rendered with the app's own compiled CSS and the real class names from the components, not a mockup of them. Tap the tab bar or use the picker.</p>

<div class="controls">
  <select id="picker" onchange="show(this.value)">
    {"".join(options)}
  </select>
  <span class="hint">Preview only. Nothing here saves.</span>
</div>

{"".join(blocks)}

<p class="note">
  The one difference from the running app: the app's own <code>body</code> rule hardcodes the light
  tokens, so it is stripped here and each frame paints its own background instead. Everything else,
  every color, radius, weight and spacing value, is the compiled output of
  <code>globals.css</code> and <code>tailwind.config.ts</code> as they stand in the repo right now.
</p>

<script>
function show(name) {{
  document.querySelectorAll(".screen").forEach(function (s) {{
    s.hidden = s.getAttribute("data-screen") !== name;
  }});
  var p = document.getElementById("picker");
  if (p.value !== name) p.value = name;
  window.scrollTo({{ top: 0, behavior: "smooth" }});
}}
document.body.addEventListener("click", function (e) {{
  var a = e.target.closest("[data-goto]");
  if (!a) return;
  e.preventDefault();
  show(a.getAttribute("data-goto"));
}});
show("today");
</script>
"""

out = "/tmp/claude-0/-home-claude/29e8f462-8fb8-51f4-a493-bd698cb56848/scratchpad/full_app_preview.html"
open(out, "w").write(HTML)
print(f"wrote {out} ({len(HTML)} bytes, css {len(CSS)} bytes)")
