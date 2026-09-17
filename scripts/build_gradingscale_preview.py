"""Preview for the grading-scale screens, before any of them are built.

Same rule as the other generators: the CSS is the app's own compiled
Tailwind output and the colour maps are parsed out of
src/components/statusHue.ts, so a wrong class renders as nothing rather
than quietly looking fine. The letter rows and the weighted-bonus cap are
read out of src/lib/fit/ncaa/gradingScale.ts rather than retyped.

Why this screen exists at all. Dave's real transcripts print numbers, not
letters: Westminster reports an 86.2, Cardinal Hayes reports course
grades like 87 and 102. The NCAA converts those using the high school's
OWN published table, so without that table there is no core GPA for
essentially any Bridge athlete, and until now there was no way to supply
one. The shared table stays locked behind the service role; this writes
an org-scoped copy instead, so a wrong entry is wrong for one org and
nobody else. See migrations/0009_org_grading_scales.sql.

Run: npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify
then python3 scripts/build_gradingscale_preview.py
"""

import re

CSS = re.sub(r"body\{[^}]*\}", "", open("/tmp/preview.css").read(), count=1)
HUE = open("src/components/statusHue.ts").read()


def parse_map(name):
    body = re.search(name + r"\s*(?::[^=]*)?=\s*\{(.*?)\n\}", HUE, re.S)
    return {k.strip(): v for k, v in re.findall(r'"?([A-Za-z ]+)"?\s*:\s*"([^"]+)"', body.group(1))}


SOLID = parse_map("SOLID")
TINT = parse_map("TINT")
DOT = parse_map("DOT")

# Read out of the shipped module, not retyped.
GS = open("src/lib/fit/ncaa/gradingScale.ts").read()
LETTERS = re.search(r"SCALE_LETTERS\s*=\s*\[(.*?)\]", GS, re.S).group(1)
LETTERS = re.findall(r'"([A-F])"', LETTERS)
MAX_SPAN = re.search(r"MAX_BAND_SPAN\s*=\s*(\d+)", GS).group(1)


def header(label, count=None, role="accent"):
    c = f'<span class="text-[13px] font-extrabold tabular-nums text-ink">{count}</span>' if count is not None else ""
    return ('<div class="flex items-center gap-2">'
            f'<span class="h-[7px] w-[7px] flex-shrink-0 rounded-full {DOT[role]}"></span>'
            f'<span class="text-[13px] font-extrabold uppercase tracking-[0.04em] text-muted">{label}</span>'
            '<span class="h-px flex-1 border-b-2 border-dotted border-line"></span>'
            f'{c}</div>')


def rail(role, inner):
    return f'<div class="rounded-[10px] bg-paper px-3.5 py-3">{inner}</div>'


def chip(text, role):
    return (f'<span class="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] '
            f'font-bold {TINT[role]}">{text}</span>')


def note(text, role="contact"):
    return rail(role, f'<div class="text-[13.5px] leading-tight text-ink">{text}</div>')


def field(label, hint, inner):
    h = f'<div class="mb-1.5 text-[12.5px] leading-tight text-muted">{hint}</div>' if hint else ""
    return ('<div class="mb-4">'
            f'<label class="mb-1 block text-[13px] font-extrabold uppercase tracking-[0.03em] text-muted">{label}</label>'
            f'{h}{inner}</div>')


INPUT = ('w-full rounded-[10px] border border-line bg-paper px-3 py-2.5 '
         'text-[16px] text-ink placeholder:text-muted')


def band_row(letter, lo, hi, muted=False):
    """One letter's range. Five fixed rows, because the NCAA does not
    recognise plus or minus: a school publishing twelve bands collapses
    to these five without losing anything that changes a core GPA."""
    lo_v = f'value="{lo}"' if lo else 'placeholder="low"'
    hi_v = f'value="{hi}"' if hi else 'placeholder="high"'
    tone = "text-muted" if muted else "text-ink"
    return ('<div class="flex items-center gap-2">'
            f'<span class="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[9px] '
            f'text-[17px] font-black {TINT["neutral"] if muted else TINT["contact"]}">{letter}</span>'
            f'<input inputmode="numeric" {lo_v} class="{INPUT} {tone} text-center tabular-nums" />'
            '<span class="text-[14.5px] font-bold text-muted">to</span>'
            f'<input inputmode="numeric" {hi_v} class="{INPUT} {tone} text-center tabular-nums" />'
            '</div>')


SCREENS = {}

# --------------------------------------------------------------- 1 the list
SCREENS["list"] = ("Grading scales list", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; More</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Grading scales</h1>
  <p class="mb-5 text-[13.5px] text-muted">How each high school's numbers become letters. Used for every NCAA core GPA at that school, for this org only.</p>

  <div class="mb-2">{header("Needed now", "2", "offer")}</div>
  <p class="mb-3 text-[13px] leading-tight text-muted">Athletes on your roster whose transcripts print numbers, at schools with no table on file. Their core GPAs are running on the assumed ten-point scale until these are entered.</p>
  <div class="flex flex-col gap-2">
    {rail("offer", '''<div class="flex items-center justify-between gap-3">
      <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">Cardinal Hayes High School</div>
      <div class="text-[12.5px] text-muted">3 athletes &middot; 41 courses waiting</div></div>
      <span class="text-[13px] font-extrabold text-solid-accent">Add</span></div>''')}
    {rail("offer", '''<div class="flex items-center justify-between gap-3">
      <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">James Monroe High School</div>
      <div class="text-[12.5px] text-muted">1 athlete &middot; 18 courses waiting</div></div>
      <span class="text-[13px] font-extrabold text-solid-accent">Add</span></div>''')}
  </div>

  <div class="mb-2 mt-5">{header("On file", "3", "committed")}</div>
  <div class="flex flex-col gap-2">
    {rail("committed", f'''<div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[14.5px] font-bold text-ink">Westminster School</div>
        <div class="mt-0.5 text-[12.5px] leading-tight text-muted">A 93-100 &middot; B 85-92 &middot; C 77-84 &middot; D 70-76 &middot; F 0-69</div>
        <div class="mt-1.5">{chip("Confirmed with the school", "committed")}</div>
      </div></div>''')}
    {rail("contact", f'''<div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[14.5px] font-bold text-ink">Trinity Catholic</div>
        <div class="mt-0.5 text-[12.5px] leading-tight text-muted">A 90-100 &middot; B 80-89 &middot; C 70-79 &middot; F 0-69</div>
        <div class="mt-1.5">{chip("Typed from a transcript legend", "contact")}</div>
      </div></div>''')}
    {rail("contact", f'''<div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[14.5px] font-bold text-ink">Stamford High School</div>
        <div class="mt-0.5 text-[12.5px] leading-tight text-muted">A 90-100 &middot; B 80-89 &middot; C 75-79 &middot; D 70-74 &middot; F 0-69</div>
        <div class="mt-1.5">{chip("Weighted, adds 0.50", "place")}</div>
      </div></div>''')}
  </div>

  <div class="mt-4">{note("Only this org uses these. Another organization with an athlete at the same school keeps its own, so a mistake here cannot change anyone else's eligibility verdict.", "contact")}</div>

  <div class="mt-5">
    <button class="w-full rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Add a school's scale</button>
  </div>
</main>
""")

# --------------------------------------------------------------- 2 the form
SCREENS["form"] = ("Entry form", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Grading scales</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Cardinal Hayes High School</h1>
  <p class="mb-5 text-[13.5px] text-muted">Copy the table exactly as the school publishes it. Do not adjust it to look like other schools.</p>

  {field("School", "", f'<input value="Cardinal Hayes High School" class="{INPUT}" />')}

  <div class="mb-2">{header("The table", None, "contact")}</div>
  <p class="mb-3 text-[13px] leading-tight text-muted">
    Five rows, not twelve. The NCAA does not recognise plus or minus, so A+, A and A- are all worth the same four points and collapse into one band.
    Leave a letter blank if the school does not award it.
  </p>
  <div class="flex flex-col gap-2">
    {band_row(LETTERS[0], "85", "100")}
    {band_row(LETTERS[1], "75", "84")}
    {band_row(LETTERS[2], "65", "74")}
    {band_row(LETTERS[3], "", "", muted=True)}
    {band_row(LETTERS[4], "0", "64")}
  </div>

  <div class="mt-3">{note("This school's 65 is a C. On a ten-point scale it would be a D, worth one point instead of two. That difference is why the table is stored per school and never assumed.", "contact")}</div>

  <div class="mb-2 mt-5">{header("Weighted courses", None, "place")}</div>
  <div class="flex flex-col gap-2">
    {rail("place", '''<div class="flex items-start gap-3">
      <span class="mt-0.5 flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] bg-solid-place text-[14.5px] font-black text-solid-place-on">&#10003;</span>
      <div class="min-w-0 flex-1"><div class="text-[14.5px] font-bold text-ink">The school is on record with the Eligibility Center as awarding weighted grades</div>
      <div class="mt-0.5 text-[12.5px] leading-tight text-muted">Not "they offer AP". The school has to have told the NCAA.</div></div></div>''')}
    {rail("neutral", '''<div class="flex items-start gap-3">
      <span class="mt-0.5 h-[22px] w-[22px] flex-shrink-0 rounded-[6px] border-2 border-line"></span>
      <div class="min-w-0 flex-1"><div class="text-[14.5px] font-bold text-ink">The weighting only affects class rank, not the GPA</div>
      <div class="mt-0.5 text-[12.5px] leading-tight text-muted">If this is true the bonus does not apply at all.</div></div></div>''')}
  </div>
  <div class="mt-3">
    {field("Bonus per weighted course", f"What this school actually adds. The NCAA caps it at 1.00, and that cap is not the same as the amount: a school that adds 0.50 would have every AP athlete overstated if the cap were used.", f'<input value="0.50" inputmode="decimal" class="{INPUT} tabular-nums" />')}
  </div>

  <div class="mb-2 mt-1">{header("Where this came from", None, "people")}</div>
  <p class="mb-3 text-[13px] leading-tight text-muted">Required. This table governs every eligibility verdict for every athlete at this school in your org, and in six months nobody will remember who typed it.</p>
  <textarea rows="3" class="{INPUT}">Legend printed on page 2 of the official transcript, confirmed by phone with the counselor on 16 Sep.</textarea>

  <div class="mt-5 flex flex-col gap-2">
    <button class="rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Save and recalculate</button>
    <button class="rounded-[8px] bg-paper py-3 text-center text-[15px] font-bold text-ink">Cancel</button>
  </div>

  <p class="mt-5 text-[12px] leading-relaxed text-muted">Saving recalculates every athlete at this school immediately. Verdicts can move in either direction.</p>
</main>
""")

# ------------------------------------------------------------ 3 the refusal
SCREENS["refused"] = ("A table that cannot be right", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Grading scales</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Cardinal Hayes High School</h1>
  <p class="mb-5 text-[13.5px] text-muted">Copy the table exactly as the school publishes it.</p>

  <div class="mb-4">{rail("offer", '''<div class="text-[14.5px] font-bold leading-tight text-ink">That table cannot be right: its B and C bands overlap.
    <div class="mt-1 text-[13px] font-normal leading-tight text-muted">A grade of 78 would be two different letters at once. Nothing has been saved.</div></div>''')}</div>

  {field("School", "", f'<input value="Cardinal Hayes High School" class="{INPUT}" />')}

  <div class="mb-2">{header("The table", None, "offer")}</div>
  <div class="flex flex-col gap-2">
    {band_row(LETTERS[0], "85", "100")}
    {band_row(LETTERS[1], "75", "84")}
    {band_row(LETTERS[2], "65", "78")}
    {band_row(LETTERS[3], "", "", muted=True)}
    {band_row(LETTERS[4], "0", "64")}
  </div>

  <div class="mt-3 flex flex-col gap-2">
    {note("A single band covering everything would turn every athlete at this school into a 4.00 or a 0.00, and it would read on screen as a confident verdict. So a band wider than " + MAX_SPAN + " points is refused, except the failing band, which is open-ended at the bottom by nature.", "contact")}
    {note("Letters have to run the right way too. A table where the A band sits below the C band converts every good grade into a bad one and produces a core GPA that looks perfectly ordinary.", "contact")}
  </div>

  <div class="mt-5 flex flex-col gap-2">
    <button class="rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Save and recalculate</button>
  </div>
</main>
""")

# ----------------------------------------------------- 4 attribution on the verdict
SCREENS["attribution"] = ("Where the number came from", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Johan D.</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
  <p class="mb-5 text-[13.5px] text-muted">Division I standard. Calculated from 16 approved core courses, not from the transcript average.</p>

  <div class="mb-4 rounded-[16px] bg-paper p-4">
    <div class="mb-2">{chip("Qualifier", "high")}</div>
    <div class="text-[15px] font-bold leading-tight text-ink">On track to receive aid, practice and compete in year one.</div>
  </div>

  <div class="mb-4 grid grid-cols-2 gap-2">
    <div class="rounded-[12px] bg-paper p-3.5">
      <div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">NCAA core</div>
      <div class="mt-1 text-[28px] font-black tabular-nums leading-tight text-ink">2.64</div>
      <div class="mt-0.5 text-[11.5px] text-muted">needs 2.30 for D1</div>
    </div>
    <div class="rounded-[12px] bg-paper p-3.5">
      <div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">Transcript</div>
      <div class="mt-1 text-[28px] font-black tabular-nums leading-tight text-ink">3.10</div>
      <div class="mt-0.5 text-[11.5px] text-muted">what the school reports</div>
    </div>
  </div>

  <div class="mb-2">{header("How the grades were converted", None, "people")}</div>
  <div class="flex flex-col gap-2">
    {rail("contact", '''<div class="text-[13.5px] leading-tight text-ink">Cardinal Hayes numbers converted through a table your org entered
      <div class="mt-1 text-[12.5px] leading-tight text-muted">"Legend printed on page 2 of the official transcript." Nobody has confirmed it with the school, so this core GPA is only as right as that table.</div>
      <div class="mt-2 text-[13px] font-extrabold text-solid-accent">Review the table</div></div>''')}
    {rail("contact", '''<div class="text-[13.5px] leading-tight text-ink">Westminster numbers converted through a confirmed table
      <div class="mt-1 text-[12.5px] leading-tight text-muted">Verified and shared across the platform. Your org cannot change this one.</div></div>''')}
    {rail("offer", '''<div class="text-[13.5px] leading-tight text-ink">James Monroe numbers converted on an assumed ten-point scale
      <div class="mt-1 text-[12.5px] leading-tight text-muted">Nothing from this school is on file. This is a placeholder conversion, not what the NCAA will use.</div>
      <div class="mt-2 text-[13px] font-extrabold text-solid-accent">Enter the grading scale</div></div>''')}
  </div>

  <div class="mt-4">{note("This section only appears when a numeric grade actually ran through a table. A transcript that prints letters converts the same either way, and a caveat that applies to nothing is worse than none.", "contact")}</div>
</main>
""")

# ------------------------------------------------------- 5 the default in use
SCREENS["default"] = ("No table on file", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Johan D.</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
  <p class="mb-5 text-[13.5px] text-muted">Division I standard. Calculated from 16 approved core courses, not from the transcript average.</p>

  <div class="mb-4 rounded-[16px] bg-paper p-4">
    <div class="mb-2">{chip("Qualifier", "high")}</div>
    <div class="text-[15px] font-bold leading-tight text-ink">On track to receive aid, practice and compete in year one.</div>
  </div>

  <div class="mb-4 grid grid-cols-2 gap-2">
    <div class="rounded-[12px] bg-paper p-3.5">
      <div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">NCAA core</div>
      <div class="mt-1 text-[28px] font-black tabular-nums leading-tight text-ink">2.81</div>
      <div class="mt-0.5 text-[11.5px] text-muted">needs 2.30 for D1</div>
    </div>
    <div class="rounded-[12px] bg-paper p-3.5">
      <div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">Transcript</div>
      <div class="mt-1 text-[28px] font-black tabular-nums leading-tight text-ink">3.40</div>
      <div class="mt-0.5 text-[11.5px] text-muted">what the school reports</div>
    </div>
  </div>

  <div class="mt-3">{rail("offer", '''<div class="text-[13.5px] font-bold leading-tight text-ink">James Monroe High School has no grading scale on file
    <div class="mt-1 text-[13px] font-normal leading-tight text-muted">Those grades are numbers, and the number above was produced by assuming the standard ten-point scale. The NCAA uses the school's own published table, so an 85 is not automatically a B. Enter the real table and this recalculates.</div>
    <div class="mt-2 text-[13px] font-extrabold text-solid-accent">Enter the grading scale</div></div>''')}</div>

  <div class="mt-3">{note("James Monroe grades were converted on the standard ten-point scale, because that school's own table is not on file. The NCAA uses the school's published table, so this core GPA is an estimate and can move once the real one is entered.", "offer")}</div>
</main>
""")

order = ["list", "form", "refused", "attribution", "default"]
options = [f'<option value="{k}">{SCREENS[k][0]}</option>' for k in order]
blocks = [f'<div class="screen" data-screen="{k}" hidden><div class="phone">{SCREENS[k][1]}</div></div>' for k in order]

HTML = f"""<title>Grading Scales Preview</title>
<style>
{CSS}
:root {{ --page-bg:#f5f5f7; --page-fg:#1c1c1e; --page-muted:#6e6e73; --page-line:#d8d8dc; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --page-bg:#0b0b0d; --page-fg:#f2f2f4; --page-muted:#9a9aa2; --page-line:#2a2a2e; }} }}
:root[data-theme="dark"] {{ --page-bg:#0b0b0d; --page-fg:#f2f2f4; --page-muted:#9a9aa2; --page-line:#2a2a2e; }}
body {{ background:var(--page-bg); color:var(--page-fg);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  max-width:720px; margin:0 auto; padding:18px 16px 60px; }}
h1.pg {{ font-size:21px; font-weight:800; margin:0 0 5px; }}
p.lede {{ color:var(--page-muted); font-size:13.5px; line-height:1.5; margin:0 0 14px; }}
.controls {{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:16px; }}
.controls select {{ font:inherit; font-size:13px; font-weight:700; padding:8px 12px;
  border-radius:10px; border:1px solid var(--page-line); background:var(--page-bg); color:var(--page-fg); }}
.hint {{ font-size:11.5px; color:var(--page-muted); }}
.phone {{ width:390px; max-width:100%; margin:0 auto; border-radius:22px; overflow:hidden;
  border:1px solid var(--page-line); background:var(--bg); }}
.screen[hidden] {{ display:none !important; }}
.note {{ margin-top:22px; font-size:12.5px; line-height:1.6; color:var(--page-muted);
  border-top:1px solid var(--page-line); padding-top:14px; }}
.note b {{ color:var(--page-fg); }}
code {{ font-size:11.5px; }}
</style>

<h1 class="pg">Grading scales</h1>
<p class="lede">Five states, at phone width, using the app's own compiled CSS and the locked catalog. Nothing here is built yet. React before I write it.</p>

<div class="controls">
  <select id="picker" onchange="show(this.value)">{"".join(options)}</select>
  <span class="hint">Mockup. Nothing here works.</span>
</div>

{"".join(blocks)}

<p class="note">
  <b>What this unblocks.</b> Your real transcripts print numbers. Westminster reports an 86.2,
  Cardinal Hayes reports course grades like 87 and 102. The NCAA converts those using the school's
  own published table, never a generic curve, so until one is on file the eligibility screen has
  no honest number to show for essentially any Bridge athlete. This is the screen that supplies it.
  <br><br>
  <b>Why staff can type this in when they cannot add a school.</b> The shared table stays locked
  behind the service role, because a wrong entry there would rewrite other organizations' verdicts.
  What this screen writes is scoped to your org, so a mistake is wrong for you and nobody else,
  which is the same blast radius as an athlete's GPA or a course grade that staff already type in.
  A confirmed shared table still wins where one exists, and the verdict says which one it used.
  <br><br>
  <b>Why five rows and not twelve.</b> The NCAA does not recognise plus or minus. B+, B and B- are
  all three quality points, so a school publishing twelve bands collapses to five without losing
  anything that can change a core GPA.
  <br><br>
  <b>When nothing is on file at all.</b> The last screen is your call: rather than a blank, the app
  converts on the standard ten-point scale and shows a number, with the assumption attached to it in
  three places, a warning, an attribution line, and the prompt to enter the real table. An assumed
  conversion never earns the weighted-grade bonus, and a real table always overrides it.
  <br><br>
  <b>The refusal screen is the important one.</b> A table that overlaps, runs backwards, or covers
  everything in one band produces a core GPA that looks completely ordinary and is wrong for every
  athlete at that school. Those are refused rather than warned about. The same check now runs on
  tables read off a scan by Doc AI, which is where it originally lived.
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
show("list");
</script>
"""

out = "/tmp/claude-0/-home-claude/29e8f462-8fb8-51f4-a493-bd698cb56848/scratchpad/gradingscale_preview.html"
open(out, "w").write(HTML)
print(f"wrote {out} ({len(HTML)} bytes)")
