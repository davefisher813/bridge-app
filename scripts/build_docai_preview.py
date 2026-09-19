"""Preview for the Doc AI upload screen, before any of it is built.

Same honesty rule as scripts/build_preview.py: the CSS is the app's own
compiled Tailwind output and the colour maps are parsed out of
src/components/statusHue.ts, so a class that is wrong renders as nothing
rather than quietly looking fine.

What the screen has to express comes from src/lib/docai/pipeline.ts, which
is already built and tested: ingest, triage, extract, validate, route. The
route is one of auto_apply, review or reject, and there are five distinct
failure stages before it. A spinner and a tick would not be an honest
front end for that.

Run: npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify
then python3 scripts/build_docai_preview.py
"""

import json
import re
import os
# Where the generated pages land. The previous hardcoded path was one
# session's scratchpad and did not exist anywhere else.
OUT_DIR = os.environ.get("PREVIEW_OUT_DIR", "/tmp/previews")
os.makedirs(OUT_DIR, exist_ok=True)


CSS = re.sub(r"body\{[^}]*\}", "", open("/tmp/preview.css").read(), count=1)

HUE = open("src/components/statusHue.ts").read()


def parse_map(name):
    body = re.search(name + r"\s*(?::[^=]*)?=\s*\{(.*?)\n\}", HUE, re.S)
    # Keys carry their indentation out of the regex, so they are stripped
    # here. Forgetting that is what made the first run fail on "committed".
    return {k.strip(): v for k, v in re.findall(r'"?([A-Za-z ]+)"?\s*:\s*"([^"]+)"', body.group(1))}


SOLID = parse_map("SOLID")
TINT = parse_map("TINT")
DOT = parse_map("DOT")


FG = parse_map("FG")
ICONS = {k: v for k, v in json.load(open("src/components/rowIcons.json")).items() if k != "_comment"}


def glyph(kind, role="neutral", size=20):
    d = ICONS.get(kind, "")
    if not d:
        return ""
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 {FG[role]}" '
            f'style="width:{size}px;height:{size}px">{d}</svg>')


# No colour block, per 2026-09-17.
def pill(text, role, kind=None):
    return (f'<span class="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-ink">'
            f'{glyph(kind, role, 15) if kind else ""}{text}</span>')


def chip(text, role, kind=None):
    return pill(text, role, kind)


def header(label, count=None, role="accent"):
    c = f'<span class="text-[13px] font-extrabold tabular-nums text-ink">{count}</span>' if count is not None else ""
    return ('<div class="flex items-center gap-2">'
            f'<span class="h-[7px] w-[7px] flex-shrink-0 rounded-full {DOT[role]}"></span>'
            f'<span class="text-[13px] font-extrabold uppercase tracking-[0.04em] text-muted">{label}</span>'
            '<span class="h-px flex-1 border-b-2 border-dotted border-line"></span>'
            f'{c}</div>')


def badge(role, mark):
    return (f'<span class="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center '
            f'{FG[role]}">{mark}</span>')


def rail(role, inner):
    return f'<div class="rounded-[10px] bg-paper px-3.5 py-3">{inner}</div>'


FIELD = ('w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[15px] text-ink '
         'placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent')
LABEL = "mb-1.5 block text-[12px] font-bold text-muted"
BTN = "rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on"
BTN_QUIET = "rounded-[8px] bg-paper py-3 text-center text-[15px] font-bold text-ink"

CLOCK = "&#9200;"
PERSON = "&#128100;"
PIN = "&#128205;"

SCREENS = {}

# ------------------------------------------------------------------ 1 upload
SCREENS["upload"] = ("Upload", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4 flex items-center gap-3">
    <a href="#" class="text-[14.5px] font-bold text-muted">&larr; More</a>
  </div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Add a document</h1>
  <p class="mb-5 text-[13.5px] text-muted">A transcript, test scores, an offer letter. It gets read, matched to an athlete, and either applied or sent to review.</p>

  <div class="mb-4">
    <label class="{LABEL}">What is it</label>
    <div class="flex flex-wrap gap-1.5">
      {chip("Transcript", "committed")}
      {chip("Test Scores", "neutral")}
      {chip("Offer Letter", "neutral")}
      {chip("Recommendation", "neutral")}
      {chip("Financial Aid", "neutral")}
    </div>
    <p class="mt-2 text-[12px] text-muted">Film and highlights are not supported yet.</p>
  </div>

  <div class="mb-4">
    <label class="{LABEL}">Where it came from</label>
    <select class="{FIELD}"><option>Coordinator</option></select>
    <p class="mt-1 text-[12px] text-muted">Affects how much the result is trusted. A parent-supplied scan is weighted lower than one you uploaded.</p>
  </div>

  <div class="mb-5 rounded-[12px] border-2 border-dashed border-line bg-paper px-4 py-9 text-center">
    <div class="mb-2 flex justify-center text-muted">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="h-8 w-8">
        <path d="M12 16V4M7.5 8.5L12 4l4.5 4.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="text-[14.5px] font-extrabold text-ink">Take a photo or choose a file</div>
    <div class="mt-1 text-[12.5px] text-muted">PDF, JPEG, PNG or HEIC &middot; up to 10 pages</div>
  </div>

  <button class="{BTN} w-full" disabled style="opacity:.5">Read document</button>
</main>
""")

# -------------------------------------------------------------- 2 processing
SCREENS["processing"] = ("Reading", f"""
<main class="px-4 pt-2 pb-6">
  <h1 class="mb-4 text-[22px] font-extrabold text-ink">Reading document</h1>

  <div class="mb-4">{rail("visit", f'''
    <div class="flex items-center gap-3">
      {badge("place", PIN)}
      <div class="min-w-0 flex-1">
        <div class="truncate text-[15px] font-bold text-ink">marcus-transcript.pdf</div>
        <div class="text-[12.5px] text-muted">3 pages &middot; 1.2 MB</div>
      </div>
    </div>''')}</div>

  <div class="mb-2">{header("Progress", None, "contact")}</div>
  <div class="flex flex-col gap-2">
    {rail("committed", '''<div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] font-bold text-ink">Checked the file</div>
      <span class="text-[12px] font-bold text-ios-green">Done</span></div>
      <div class="mt-0.5 text-[12.5px] text-muted">Real PDF, 3 pages, within size</div>''')}
    {rail("committed", '''<div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] font-bold text-ink">Checked it is readable</div>
      <span class="text-[12px] font-bold text-ios-green">Done</span></div>
      <div class="mt-0.5 text-[12.5px] text-muted">Legibility 91% &middot; looks like a transcript</div>''')}
    {rail("contact", '''<div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] font-bold text-ink">Pulling the details out</div>
      <span class="text-[12px] font-bold text-ios-blue">Working</span></div>
      <div class="mt-2 h-1 overflow-hidden rounded-full bg-line"><div class="h-full w-2/5 rounded-full bg-ios-blue"></div></div>''')}
    {rail("target", '''<div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] font-bold text-muted">Matching to an athlete</div>
      <span class="text-[12px] font-bold text-muted">Waiting</span></div>''')}
  </div>
</main>
""")

# ------------------------------------------------------------ 3 auto-applied
SCREENS["applied"] = ("Applied", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4 flex items-center justify-between">
    <a href="#" class="text-[14.5px] font-bold text-muted">&larr; Documents</a>
    {pill("Applied", "committed")}
  </div>
  <h1 class="text-[22px] font-extrabold text-ink">Transcript read</h1>
  <div class="mt-1 text-[14.5px] text-muted">marcus-transcript.pdf &middot; 3 pages</div>

  <div class="mb-2 mt-6">{header("Matched to", None, "people")}</div>
  {rail("people", f'''<div class="flex items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <div class="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ios-blue to-ios-indigo text-[13px] font-extrabold text-white">MB</div>
      <div><div class="text-[15px] font-bold text-ink">Marcus Bell</div>
      <div class="text-[12.5px] text-muted">Name, school and grad year all matched</div></div>
    </div>
    <a href="#" class="flex-shrink-0 text-[13px] font-bold text-accent">Change</a>
  </div>''')}

  <div class="mb-2 mt-6">{header("What it says", 4, "committed")}</div>
  <div class="flex flex-col gap-2">
    {rail("committed", '''<div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] text-muted">GPA</div>
      <div class="text-[15px] font-extrabold tabular-nums text-ink">3.62 <span class="text-[12px] font-bold text-muted">was 3.41</span></div></div>''')}
    {rail("committed", '''<div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] text-muted">Grad year</div>
      <div class="text-[15px] font-extrabold tabular-nums text-ink">2027</div></div>''')}
    {rail("committed", '''<div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] text-muted">Course load</div>
      <div class="text-[14.5px] font-bold text-ink">Mostly Honors/AP</div></div>''')}
    {rail("committed", '''<div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] text-muted">AP / Honors</div>
      <div class="text-[15px] font-extrabold tabular-nums text-ink">4 / 3</div></div>''')}
  </div>

  <div class="mb-2 mt-6">{header("How sure", None, "committed")}</div>
  {rail("committed", f'''
    <div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] font-bold text-ink">High confidence</div>
      <div class="text-[16px] font-extrabold tabular-nums text-ink">88%</div>
    </div>
    <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-ios-green" style="width:88%"></div></div>
    <div class="mt-2 text-[12.5px] text-muted">The model was 94% sure, the scan was 91% legible, and you uploaded it yourself. Applied without asking.</div>''')}

  <div class="mt-6 flex gap-2">
    <button class="{BTN} flex-1">Done</button>
    <button class="{BTN_QUIET} flex-1">Undo</button>
  </div>
</main>
""")

# --------------------------------------------------------------- 4 review
SCREENS["review"] = ("Needs review", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4 flex items-center justify-between">
    <a href="#" class="text-[14.5px] font-bold text-muted">&larr; Documents</a>
    {pill("Needs review", "offer")}
  </div>
  <h1 class="text-[22px] font-extrabold text-ink">Not sure who this is</h1>
  <div class="mt-1 text-[14.5px] text-muted">parent-upload-3.jpg &middot; 1 page</div>

  <div class="mb-2 mt-6">{header("Pick the athlete", 2, "offer")}</div>
  <div class="flex flex-col gap-2">
    {rail("offer", f'''<div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ios-blue to-ios-indigo text-[13px] font-extrabold text-white">MB</div>
        <div><div class="text-[15px] font-bold text-ink">Marcus Bell</div>
        <div class="text-[12.5px] text-muted">Name match &middot; grad year match</div></div>
      </div>
      {chip("71%", "mid")}
    </div>''')}
    {rail("target", f'''<div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ios-blue to-ios-indigo text-[13px] font-extrabold text-white">MB</div>
        <div><div class="text-[15px] font-bold text-ink">Marcus Bellamy</div>
        <div class="text-[12.5px] text-muted">Name match</div></div>
      </div>
      {chip("44%", "low")}
    </div>''')}
    <button class="{BTN_QUIET} w-full">Someone else</button>
  </div>

  <div class="mb-2 mt-6">{header("Check these", 2, "offer")}</div>
  <div class="flex flex-col gap-3">
    <div>
      <label class="{LABEL}">GPA</label>
      <input class="{FIELD}" value="3.62">
      <p class="mt-1 text-[12px] text-muted">Read from a 4.0 scale</p>
    </div>
    <div>
      <label class="{LABEL}">Grad year</label>
      <input class="{FIELD}" value="2027">
    </div>
  </div>

  <div class="mb-2 mt-6">{header("Why it stopped", None, "offer")}</div>
  {rail("offer", f'''
    <div class="flex items-center justify-between gap-3">
      <div class="text-[14.5px] font-bold text-ink">Medium confidence</div>
      <div class="text-[16px] font-extrabold tabular-nums text-ink">54%</div>
    </div>
    <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full bg-ios-orange" style="width:54%"></div></div>
    <div class="mt-2 text-[12.5px] text-muted">A parent sent this one and the photo is soft, so it needs a look before anything changes.</div>''')}

  <div class="mt-6 flex gap-2">
    <button class="{BTN} flex-1">Apply to Marcus Bell</button>
    <button class="{BTN_QUIET} flex-1">Discard</button>
  </div>
</main>
""")

# --------------------------------------------------------------- 5 rejected
SCREENS["rejected"] = ("Can't read it", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4 flex items-center justify-between">
    <a href="#" class="text-[14.5px] font-bold text-muted">&larr; Documents</a>
    {pill("Not used", "danger")}
  </div>
  <h1 class="text-[22px] font-extrabold text-ink">Could not read this</h1>
  <div class="mt-1 text-[14.5px] text-muted">IMG_4821.HEIC &middot; 1 page</div>

  <div class="mb-2 mt-6">{header("What went wrong", 3, "danger")}</div>
  <div class="flex flex-col gap-2">
    {rail("danger", '''<div class="text-[14.5px] font-bold text-ink">Too blurry to trust</div>
      <div class="mt-0.5 text-[12.5px] text-muted">Legibility 34%</div>''')}
    {rail("danger", '''<div class="text-[14.5px] font-bold text-ink">The GPA line is cut off</div>
      <div class="mt-0.5 text-[12.5px] text-muted">Right edge of the page is missing</div>''')}
    {rail("danger", '''<div class="text-[14.5px] font-bold text-ink">Glare across the middle</div>''')}
  </div>

  <div class="mt-6 rounded-[12px] bg-paper px-4 py-5">
    <div class="text-[14.5px] font-extrabold text-ink">Try again</div>
    <div class="mt-1 text-[12.5px] text-muted">Lay it flat, avoid a window behind you, and get the whole page in frame. Nothing was changed on any athlete.</div>
  </div>

  <div class="mt-5 flex gap-2">
    <button class="{BTN} flex-1">Take another photo</button>
    <button class="{BTN_QUIET} flex-1">Cancel</button>
  </div>
</main>
""")

# --------------------------------------------------------------- 6 the queue
SCREENS["queue"] = ("Documents", f"""
<main class="px-4 pt-4 pb-6">
  <div class="mb-3 flex items-center justify-between">
    <div class="text-[22px] font-extrabold text-ink">Documents</div>
    <a href="#" class="text-[13px] font-bold text-accent">+ Add</a>
  </div>

  <div class="mb-2">{header("Needs review", 2, "offer")}</div>
  <div class="mb-6 flex flex-col gap-2">
    {rail("offer", f'''<div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">{badge("time", CLOCK)}
        <div><div class="text-[15px] font-bold text-ink">Transcript &middot; Marcus Bell?</div>
        <div class="text-[12.5px] text-muted">From a parent &middot; 2 days ago</div></div>
      </div>{chip("54%", "mid")}
    </div>''')}
    {rail("offer", f'''<div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">{badge("time", CLOCK)}
        <div><div class="text-[15px] font-bold text-ink">Test Scores &middot; no match</div>
        <div class="text-[12.5px] text-muted">From email &middot; 4 days ago</div></div>
      </div>{chip("38%", "low")}
    </div>''')}
  </div>

  <div class="mb-2">{header("Applied", 3, "committed")}</div>
  <div class="flex flex-col gap-2">
    {rail("committed", f'''<div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">{badge("people", PERSON)}
        <div><div class="text-[15px] font-bold text-ink">Transcript &middot; Ava Thompson</div>
        <div class="text-[12.5px] text-muted">GPA 3.91 &middot; yesterday</div></div>
      </div>{chip("92%", "high")}
    </div>''')}
    {rail("committed", f'''<div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">{badge("people", PERSON)}
        <div><div class="text-[15px] font-bold text-ink">Offer Letter &middot; Diego Marin</div>
        <div class="text-[12.5px] text-muted">Northgate, preferred &middot; 3 days ago</div></div>
      </div>{chip("88%", "high")}
    </div>''')}
  </div>
</main>
""")

TABS = [
    ("Today", '<path d="M3 11l9-7 9 7M5 10v9h5v-5h4v5h5v-9" stroke-linecap="round" stroke-linejoin="round"/>'),
    ("Athletes", '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6" stroke-linecap="round"/>'),
    ("Board", '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4" stroke-linecap="round"/>'),
    ("More", '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
]
tabbar = ('<nav class="sticky bottom-0 flex border-t border-line bg-paper/90 px-1.5 pb-3.5 pt-2 backdrop-blur">'
          + "".join(
              f'<span class="flex flex-1 flex-col items-center gap-1 text-[11px] font-bold '
              f'{"text-ink" if label == "More" else "text-muted"}">'
              f'<span class="{"flex h-[26px] w-[38px] items-center justify-center rounded-[8px] bg-solid-accent text-solid-accent-on" if label == "More" else "flex h-[26px] w-[38px] items-center justify-center"}">'
              f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-5 w-5">{icon}</svg>'
              f"</span>{label}</span>"
              for label, icon in TABS
          )
          + "</nav>")

blocks, options = [], []
for key, (title, body) in SCREENS.items():
    chrome = ('<div class="flex items-center justify-between border-b border-line px-4 py-2.5">'
              '<span class="text-[14.5px] font-extrabold text-ink">Bridge</span>'
              '<span class="text-[12px] text-muted">Executive Director</span></div>')
    blocks.append(
        f'<div class="screen" data-screen="{key}" hidden><div class="phone" data-theme="dark">'
        f'<div class="phone-inner">{chrome}<div class="phone-scroll">{body}</div>{tabbar}</div></div></div>'
    )
    options.append(f'<option value="{key}">{title}</option>')

HTML = f"""<title>Doc AI Upload</title>
<style>
{CSS}
:root {{ --page-bg:#f5f5f7; --page-fg:#1c1c1e; --page-muted:#6e6e73; --page-line:#d8d8dc; --page-card:#fff; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --page-bg:#0b0b0d; --page-fg:#f2f2f4; --page-muted:#9a9aa2; --page-line:#2a2a2e; --page-card:#17171a; }} }}
:root[data-theme="dark"] {{ --page-bg:#0b0b0d; --page-fg:#f2f2f4; --page-muted:#9a9aa2; --page-line:#2a2a2e; --page-card:#17171a; }}
body {{ background:var(--page-bg); color:var(--page-fg);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  max-width:760px; margin:0 auto; padding:18px 16px 60px; }}
h1.pg {{ font-size:20px; font-weight:800; margin:0 0 4px; }}
p.lede {{ color:var(--page-muted); font-size:13.5px; line-height:1.5; margin:0 0 14px; }}
.controls {{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:16px; }}
select#picker {{ font:inherit; font-size:13px; font-weight:600; padding:7px 10px; border-radius:9px;
  border:1px solid var(--page-line); background:var(--page-card); color:var(--page-fg); }}
.hint {{ font-size:11.5px; color:var(--page-muted); }}
.phone {{ width:100%; max-width:390px; margin:0 auto; border-radius:26px; overflow:hidden;
  border:1px solid var(--page-line); box-shadow:0 10px 34px rgba(0,0,0,.22); background:#0c0c0c; }}
.phone-inner {{ display:flex; flex-direction:column; height:760px; }}
.phone-scroll {{ flex:1; overflow-y:auto; }}
.screen[hidden] {{ display:none !important; }}
.note {{ margin-top:18px; font-size:12.5px; line-height:1.6; color:var(--page-muted);
  border-top:1px solid var(--page-line); padding-top:14px; }}
.note b {{ color:var(--page-fg); }}
</style>

<h1 class="pg">Doc AI upload, before it gets built</h1>
<p class="lede">Six states of one flow. Rendered with the app's own compiled CSS and the locked catalog, so this is what it would actually look like. React before I write it.</p>

<div class="controls">
  <select id="picker" onchange="show(this.value)">{"".join(options)}</select>
  <span class="hint">Mockup. Nothing here works.</span>
</div>

{"".join(blocks)}

<p class="note">
  <b>Why it is six screens and not a spinner.</b> The pipeline in
  <code>src/lib/docai/pipeline.ts</code> is already built and tested, and it does not just
  succeed or fail. It checks the file, checks the scan is readable, extracts, validates
  against a schema, matches to an athlete, and then routes to one of three places:
  applied on its own, held for review, or refused. There are five distinct ways it can
  stop early. The screen has to say which happened and what to do about it, or the
  confidence scoring underneath is wasted.
  <br><br>
  <b>The one number worth arguing about.</b> Confidence is the model's own certainty
  multiplied by how legible the scan was and how much the source is trusted, so a
  parent's blurry photo lands in review while your own clean upload applies itself. The
  Applied screen spells that out in words rather than showing a bare percentage.
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
show("upload");
</script>
"""

out = os.path.join(OUT_DIR, "docai_preview.html")
open(out, "w").write(HTML)
print(f"wrote {out} ({len(HTML)} bytes)")
