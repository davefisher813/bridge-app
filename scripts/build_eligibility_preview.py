"""Preview for the NCAA eligibility screen, before any of it is built.

Same rule as the other generators: the CSS is the app's own compiled
Tailwind output and the colour maps are parsed out of
src/components/statusHue.ts, so a wrong class renders as nothing rather
than quietly looking fine.

What the screen has to express comes from src/lib/fit/ncaa/, which is
already built, tested and law-bound. Four things it must not do, all of
which come straight from the rules:

  1. Never show a core GPA next to a transcript GPA without saying they
     are different numbers. That divergence is the whole point.
  2. Never show an NCAA verdict for a D3 school. D3 sets its own
     standards; there is no NCAA core GPA to display.
  3. Never show a number the engine refused to compute. Numeric grades
     with no school conversion table on file, or no course list at all,
     produce a question, not a figure.
  4. Never use red for a status. Locked catalog: red is the primary
     action colour, and the eligibility verdict sits on the Score axis
     as a tint (green / yellow / gray) with the words carrying the
     severity.

Run: npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify
then python3 scripts/build_eligibility_preview.py
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

# The real thresholds, read out of the shipped module rather than
# retyped, so this preview cannot drift from the engine the way the
# earlier colour copies did.
IE = open("src/lib/fit/ncaa/initialEligibility.ts").read()
D1_QUAL = re.search(r"D1:\s*\{.*?qualifierGpa:\s*([\d.]+)", IE, re.S).group(1)
D1_RS = re.search(r"D1:\s*\{.*?secondTierGpa:\s*([\d.]+)", IE, re.S).group(1)
D2_QUAL = re.search(r"D2:\s*\{.*?qualifierGpa:\s*([\d.]+)", IE, re.S).group(1)


def chip(text, role):
    return (f'<span class="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] '
            f'font-bold {TINT[role]}">{text}</span>')


def pill(text, role):
    return (f'<span class="inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] '
            f'font-bold {SOLID[role]}">{text}</span>')


def header(label, count=None, role="accent"):
    c = f'<span class="text-[13px] font-extrabold tabular-nums text-ink">{count}</span>' if count is not None else ""
    return ('<div class="flex items-center gap-2">'
            f'<span class="h-[7px] w-[7px] flex-shrink-0 rounded-full {DOT[role]}"></span>'
            f'<span class="text-[13px] font-extrabold uppercase tracking-[0.04em] text-muted">{label}</span>'
            '<span class="h-px flex-1 border-b-2 border-dotted border-line"></span>'
            f'{c}</div>')


def rail(role, inner):
    return f'<div class="rounded-[10px] bg-paper px-3.5 py-3">{inner}</div>'


def badge(role, glyph):
    return (f'<span class="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center '
            f'rounded-[8px] {SOLID[role]}">{glyph}</span>')


def tile(label, value, sub=""):
    s = f'<div class="mt-0.5 text-[11.5px] text-muted">{sub}</div>' if sub else ""
    return ('<div class="rounded-[12px] bg-paper p-3.5">'
            f'<div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">{label}</div>'
            f'<div class="mt-1 text-[28px] font-black tabular-nums leading-tight text-ink">{value}</div>{s}</div>')


def verdict(status, role, line):
    """The status banner. Score axis, tint, never red."""
    return ('<div class="mb-4 rounded-[16px] bg-paper p-4">'
            f'<div class="mb-2">{chip(status, role)}</div>'
            f'<div class="text-[15px] font-bold leading-tight text-ink">{line}</div></div>')


def note(text, role="time"):
    return rail(role, f'<div class="text-[13.5px] leading-tight text-ink">{text}</div>')


CLOCK = "&#9200;"
BOOK = "&#128218;"
WARN = "&#9888;&#65039;"

SCREENS = {}

# ------------------------------------------------------------- 1 qualifier
SCREENS["qualifier"] = ("Qualifier", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Xavier I.</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
  <p class="mb-5 text-[13.5px] text-muted">Division I standard. Calculated from 16 approved core courses, not from the transcript average.</p>

  {verdict("Qualifier", "high", "On track to receive aid, practice and compete in year one.")}

  <div class="mb-4 grid grid-cols-2 gap-2">
    {tile("NCAA core", "2.71", f"needs {D1_QUAL} for D1")}
    {tile("Transcript", "3.10", "what the school reports")}
  </div>

  {note("These are meant to be different. The core GPA counts only the 16 approved core courses and uses A=4, B=3, with no plus or minus. Electives and PE lift a transcript average and are left out of this one.", "contact")}

  <div class="mb-2 mt-5">{header("Core courses", "16 of 16", "committed")}</div>
  <div class="flex flex-col gap-2">
    {rail("committed", f'''<div class="flex items-center justify-between gap-3">
      <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">English</div>
      <div class="text-[12.5px] text-muted">4 credits &middot; best grades used</div></div>
      <span class="text-[14.5px] font-extrabold tabular-nums text-ink">3.00</span></div>''')}
    {rail("committed", f'''<div class="flex items-center justify-between gap-3">
      <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">Math</div>
      <div class="text-[12.5px] text-muted">3 credits</div></div>
      <span class="text-[14.5px] font-extrabold tabular-nums text-ink">2.33</span></div>''')}
    {rail("committed", f'''<div class="flex items-center justify-between gap-3">
      <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">Science</div>
      <div class="text-[12.5px] text-muted">2 credits</div></div>
      <span class="text-[14.5px] font-extrabold tabular-nums text-ink">2.50</span></div>''')}
    {rail("committed", f'''<div class="flex items-center justify-between gap-3">
      <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">Social science</div>
      <div class="text-[12.5px] text-muted">2 credits</div></div>
      <span class="text-[14.5px] font-extrabold tabular-nums text-ink">3.00</span></div>''')}
    {rail("committed", f'''<div class="flex items-center justify-between gap-3">
      <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">Other academic</div>
      <div class="text-[12.5px] text-muted">5 credits</div></div>
      <span class="text-[14.5px] font-extrabold tabular-nums text-ink">2.80</span></div>''')}
  </div>

  <div class="mb-2 mt-5">{header("Timing", None, "time")}</div>
  {rail("committed", f'''<div class="flex items-center gap-3">{badge("time", CLOCK)}
    <div class="min-w-0 flex-1"><div class="text-[14.5px] font-bold text-ink">10/7 rule met</div>
    <div class="text-[12.5px] text-muted">11 core credits, 8 in English, math or science, before senior year</div></div></div>''')}
  <div class="mt-2">{rail("committed", f'''<div class="flex items-center gap-3">{badge("time", CLOCK)}
    <div class="min-w-0 flex-1"><div class="text-[14.5px] font-bold text-ink">Five-year clock starts at enrollment</div>
    <div class="text-[12.5px] text-muted">Turns 19 after September 1, so nothing starts early</div></div></div>''')}

  <p class="mt-5 text-[12px] leading-relaxed text-muted">Projection until all 16 credits are final. Confirm with the NCAA Eligibility Center before anyone signs anything.</p>
</main>
""")

# ------------------------------------------------------- 2 academic redshirt
SCREENS["redshirt"] = ("Academic redshirt", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Brandon J.</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
  <p class="mb-5 text-[13.5px] text-muted">Division I standard.</p>

  {verdict("Academic redshirt", "mid", "Can receive aid and practice in the first term, but cannot compete in year one.")}

  <div class="mb-4 grid grid-cols-2 gap-2">
    {tile("NCAA core", "2.12", f"needs {D1_QUAL} to compete")}
    {tile("Transcript", "2.95", "what the school reports")}
  </div>

  {note(f"The gap is the whole story here. Six A grades in PE and electives carry the transcript average, and none of them are NCAA core courses. On the core 16 he is 0.18 short of the {D1_QUAL} he needs to compete as a freshman.", "offer")}

  <div class="mt-3">{note(f"Above {D1_RS}, so he keeps the scholarship and can practice. Below {D1_QUAL}, so he sits out year one. Two more core courses at B or better would close it.", "contact")}</div>

  <div class="mb-2 mt-5">{header("Where it is short", None, "offer")}</div>
  <div class="flex flex-col gap-2">
    {rail("offer", '''<div class="flex items-center justify-between gap-3">
      <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">Math</div>
      <div class="text-[12.5px] text-muted">3 credits, all D or C</div></div>
      <span class="text-[14.5px] font-extrabold tabular-nums text-ink">1.33</span></div>''')}
    {rail("offer", '''<div class="flex items-center justify-between gap-3">
      <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">Science</div>
      <div class="text-[12.5px] text-muted">2 credits</div></div>
      <span class="text-[14.5px] font-extrabold tabular-nums text-ink">2.00</span></div>''')}
  </div>

  <div class="mb-2 mt-5">{header("Not counted", "6 courses", "target")}</div>
  {rail("target", '''<div class="text-[13.5px] leading-tight text-ink">Phys. Ed. 9, 10 and 11, Art 1, Music App., Graphic Design.
    <div class="mt-1 text-[12.5px] text-muted">Not on the school's NCAA-approved list, so they raise the transcript average and not this one.</div></div>''')}

  <p class="mt-5 text-[12px] leading-relaxed text-muted">Projection until all 16 credits are final. Confirm with the NCAA Eligibility Center before anyone signs anything.</p>
</main>
""")

# ------------------------------------------------------------- 3 age clock
SCREENS["ageclock"] = ("Age clock", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Kengri D.</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
  <p class="mb-5 text-[13.5px] text-muted">Division I standard.</p>

  {verdict("Qualifier, but losing years", "mid", "Academically clear. The five-year eligibility clock has already started.")}

  <div class="mb-4">{rail("offer", f'''<div class="flex items-start gap-3">{badge("time", WARN)}
    <div class="min-w-0 flex-1">
      <div class="text-[14.5px] font-bold text-ink">2.0 of 5 years gone before he enrolls</div>
      <div class="mt-1 text-[13px] leading-tight text-muted">He turns 19 on 15 March, before the September 1 cutoff, so the clock starts 1 August that year whether or not he has enrolled anywhere. A post-grad year spends eligibility while nobody is playing.</div>
    </div></div>''')}</div>

  <div class="mb-4 grid grid-cols-2 gap-2">
    {tile("Clock started", "Aug 2027", "the year he turns 19")}
    {tile("Years left", "3.0", "at intended enrollment")}
  </div>

  <div class="mb-2">{header("The clock", None, "time")}</div>
  <div class="flex flex-col gap-2">
    {rail("time", f'''<div class="flex items-center gap-3">{badge("time", CLOCK)}
      <div class="min-w-0 flex-1"><div class="text-[14.5px] font-bold text-ink">Runs continuously</div>
      <div class="text-[12.5px] text-muted">Does not pause for a redshirt, a transfer, a gap year or time away</div></div></div>''')}
    {rail("time", f'''<div class="flex items-center gap-3">{badge("time", CLOCK)}
      <div class="min-w-0 flex-1"><div class="text-[14.5px] font-bold text-ink">Expires Aug 2032</div>
      <div class="text-[12.5px] text-muted">Five years from the start, D1 and D2 only</div></div></div>''')}
  </div>

  <div class="mt-3">{note("New rule, adopted mid-2026. Anyone enrolling before fall 2027 can use whichever ruleset helps them, so this one is worth checking by hand with the Eligibility Center.", "contact")}</div>

  <p class="mt-5 text-[12px] leading-relaxed text-muted">Dates are approximate to within a term: the clock starts at the start of the academic year, which each school sets itself.</p>
</main>
""")

# --------------------------------------------------------- 4 cannot compute
SCREENS["cannot"] = ("Not enough yet", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Johan D.</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
  <p class="mb-5 text-[13.5px] text-muted">Division I standard.</p>

  {verdict("Cannot be calculated yet", "low", "Two things are missing, and neither should be guessed.")}

  <div class="flex flex-col gap-2">
    {rail("target", f'''<div class="flex items-start gap-3">{badge("place", BOOK)}
      <div class="min-w-0 flex-1">
        <div class="text-[14.5px] font-bold text-ink">James Monroe's grading scale is not on file</div>
        <div class="mt-1 text-[13px] leading-tight text-muted">His grades are numbers, not letters. The NCAA converts them using the school's own published table, so an 85 is not automatically a B. Ask the counselor for the conversion table, or upload a transcript that prints it.</div>
      </div></div>''')}
    {rail("target", f'''<div class="flex items-start gap-3">{badge("place", BOOK)}
      <div class="min-w-0 flex-1">
        <div class="text-[14.5px] font-bold text-ink">No NCAA-approved course list checked</div>
        <div class="mt-1 text-[13px] leading-tight text-muted">18 courses read off the transcript, none yet matched against what this school has approved with the Eligibility Center.</div>
      </div></div>''')}
  </div>

  <div class="mt-4">{note("The transcript says 3.4. That number is not an NCAA core GPA and should not be quoted to a coach as one.", "offer")}</div>

  <div class="mt-5 flex flex-col gap-2">
    <button class="rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Add the school's grading scale</button>
    <button class="rounded-[8px] bg-paper py-3 text-center text-[15px] font-bold text-ink">Review the 18 courses</button>
  </div>

  <div class="mb-2 mt-6">{header("Add another transcript", None, "contact")}</div>
  <p class="mb-3 text-[13px] leading-tight text-muted">Goes straight onto Johan's record. A transfer student legitimately has two, and the second does not replace the first.</p>
  <div class="rounded-[12px] border-2 border-dashed border-line bg-paper px-4 py-8 text-center">
    <div class="text-[14.5px] font-extrabold text-ink">Take a photo or choose a file</div>
    <div class="mt-1 text-[12.5px] text-muted">PDF, JPEG or PNG &middot; read for its course list</div>
  </div>
</main>
""")

# ---------------------------------------------------------------- 5 d3
SCREENS["d3"] = ("Division III", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Angel V.</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
  <p class="mb-5 text-[13.5px] text-muted">Target school is Division III.</p>

  {verdict("Does not apply", "low", "Division III sets its own academic standards on each campus.")}

  <div class="flex flex-col gap-2">
    {rail("contact", '''<div class="text-[13.5px] leading-tight text-ink">There is no NCAA core-course GPA for Division III.
      <div class="mt-1 text-[12.5px] text-muted">No 16-course requirement, no qualifier status, no minimum. Admission and eligibility are the school's decision, so the number to talk about is whatever that school's admissions office uses.</div></div>''')}
    {rail("contact", '''<div class="text-[13.5px] leading-tight text-ink">He still needs an NCAA ID.
      <div class="mt-1 text-[12.5px] text-muted">Division III athletes register with the Eligibility Center for the ID. Certification is only required for international athletes.</div></div>''')}
  </div>

  <div class="mt-4">{note("If he adds a D1 or D2 target later, this screen starts calculating. The engine keys off the target school's division, not the athlete.", "contact")}</div>

  <div class="mb-2 mt-5">{header("What does apply", None, "contact")}</div>
  {rail("target", '''<div class="flex items-center justify-between gap-3">
    <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">Transcript GPA</div>
    <div class="text-[12.5px] text-muted">The school's own number, unconverted</div></div>
    <span class="text-[14.5px] font-extrabold tabular-nums text-ink">3.40</span></div>''')}
</main>
""")

order = ["qualifier", "redshirt", "ageclock", "cannot", "d3"]
options = [f'<option value="{k}">{SCREENS[k][0]}</option>' for k in order]
blocks = [f'<div class="screen" data-screen="{k}" hidden><div class="phone">{SCREENS[k][1]}</div></div>' for k in order]

HTML = f"""<title>Eligibility Preview</title>
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

<h1 class="pg">NCAA eligibility screen</h1>
<p class="lede">Five states of one screen, at phone width, using the app's own compiled CSS and the locked catalog. Nothing here is built yet. React before I write it.</p>

<div class="controls">
  <select id="picker" onchange="show(this.value)">{"".join(options)}</select>
  <span class="hint">Mockup. Nothing here works.</span>
</div>

{"".join(blocks)}

<p class="note">
  <b>Why two GPAs are always on screen together.</b> The core GPA and the transcript GPA are
  different numbers and are routinely a point apart, because the core one counts only the 16
  approved courses and scores A=4, B=3 with no plus or minus. Showing one without the other is
  how a family gets told their kid is fine when he is not. The Academic redshirt screen is that
  case: a 2.95 transcript and a 2.12 core.
  <br><br>
  <b>Why two screens refuse to show a number.</b> The engine will not convert a numeric grade
  without the school's own published conversion table, and will not treat an unchecked course as
  NCAA-approved. Both are real gaps on your current athletes, so the screen has to be able to say
  "not yet" without looking broken.
  <br><br>
  <b>Colour.</b> The verdict sits on the Score axis as a tint, green then yellow then gray, never
  red, because the locked catalog reserves red for the primary action. Severity is carried by the
  words. Yellow badges are the clock, per the same contract.
  <br><br>
  <b>Thresholds shown here are read out of <code>src/lib/fit/ncaa/initialEligibility.ts</code></b>
  at build time rather than retyped, so this preview cannot drift from the engine.
  D1 qualifier {D1_QUAL}, D1 academic redshirt {D1_RS}, D2 qualifier {D2_QUAL}.
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
show("qualifier");
</script>
"""

out = "/tmp/claude-0/-home-claude/29e8f462-8fb8-51f4-a493-bd698cb56848/scratchpad/eligibility_preview.html"
open(out, "w").write(HTML)
print(f"wrote {out} ({len(HTML)} bytes)")
