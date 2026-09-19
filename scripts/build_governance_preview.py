"""Preview for the board governance screens, before any are built.

Same rule as every other generator: the app's own compiled CSS, colour
maps parsed out of statusHue.ts, and the tier amounts read out of the
shipped module rather than retyped.

The structure is Bridge's own governance document, not a guess: five
tiers with a give/get amount each, sport boards starting at three seats
and growing to five with a Sport Director, Board Chair and Recruiting
Lead. Every person and figure below is invented.

Run: npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify
then python3 scripts/build_governance_preview.py
"""

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
    return {k.strip(): v for k, v in re.findall(r'"?([A-Za-z ]+)"?\s*:\s*"([^"]+)"', body.group(1))}


SOLID = parse_map("SOLID")
TINT = parse_map("TINT")
DOT = parse_map("DOT")

# The tier amounts, read out of the shipped module.
GG = open("src/lib/governance/giveGet.ts").read()
AMOUNTS = dict(re.findall(r"(\w+):\s*([\d_]+),", re.search(r"DEFAULT_GIVE_GET_CENTS[^{]*\{(.*?)\n\}", GG, re.S).group(1)))
def dollars(kind):
    cents = int(AMOUNTS[kind].replace("_", ""))
    return f"${cents // 100:,}"


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


def bar(pct, role):
    return ('<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line">'
            f'<div class="h-full rounded-full {DOT[role]}" style="width:{min(100, pct)}%"></div></div>')


def board_card(name, amount, seats, pct, role, sub=""):
    s = f'<div class="mt-0.5 text-[12.5px] leading-tight text-muted">{sub}</div>' if sub else ""
    return rail(role, f'''<div class="min-w-0">
      <div class="flex items-start justify-between gap-3">
        <div class="text-[14.5px] font-bold text-ink">{name}</div>
        <span class="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">{pct}%</span>
      </div>
      <div class="mt-0.5 text-[12.5px] text-muted">{amount} give/get &middot; {seats}</div>
      {s}
      {bar(pct, role)}
    </div>''')


def member_row(name, title, given, raised, pct, role, extra=""):
    e = f'<div class="mt-1 text-[12.5px] leading-tight text-muted">{extra}</div>' if extra else ""
    return rail(role, f'''<div class="min-w-0">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-[14.5px] font-bold text-ink">{name}</div>
          <div class="mt-0.5 text-[12.5px] text-muted">{title}</div>
        </div>
        <span class="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">{pct}%</span>
      </div>
      <div class="mt-1.5 text-[12.5px] text-muted">{given} given &middot; {raised} brought in</div>
      {e}
      {bar(pct, role)}
    </div>''')


INPUT = ('w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 '
         'text-[15px] text-ink placeholder:text-muted')

SCREENS = {}

# ------------------------------------------------------------- 1 overview
SCREENS["boards"] = ("Boards", f"""
<main class="px-4 pt-2 pb-6">
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Board</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">Five tiers, each with a give/get commitment. Progress is cash in the door, given or brought in.</p>

  <div class="mb-3 grid grid-cols-2 gap-2">
    <div class="rounded-[12px] bg-paper p-3.5">
      <div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">Committed</div>
      <div class="mt-1 text-[26px] font-black tabular-nums leading-tight text-ink">$127,500</div>
      <div class="mt-0.5 text-[11.5px] text-muted">across 24 active seats</div>
    </div>
    <div class="rounded-[12px] bg-paper p-3.5">
      <div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">Delivered</div>
      <div class="mt-1 text-[26px] font-black tabular-nums leading-tight text-ink">$71,200</div>
      <div class="mt-0.5 text-[11.5px] text-muted">56% &middot; 9 of 24 fully met</div>
    </div>
  </div>

  <div class="mb-4">{note("Give/get counts both halves. A member meets their number by giving it or by bringing it in, and a gift is never counted twice when they did both.", "contact")}</div>

  <div class="mb-2">{header("Boards", "6", "committed")}</div>
  <div class="flex flex-col gap-2">
    {board_card("Executive Board", dollars("executive"), "6 of 15 seats", 72, "committed")}
    {board_card("General Board", dollars("general"), "9 of 30 seats", 61, "offer")}
    {board_card("Baseball Board", dollars("sport"), "3 of 5 seats", 48, "offer")}
    {board_card("Basketball Board", dollars("sport"), "2 of 5 seats", 30, "target", "Below the floor of 3. The governance doc sets three as the starting point.")}
    {board_card("Development Board", dollars("development"), "3 of 30 seats", 67, "offer")}
    {board_card("Junior Board", dollars("junior"), "1 of 30 seats", 100, "committed")}
  </div>

  <div class="mt-5 flex flex-col gap-2">
    <button class="rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Add a seat</button>
    <button class="rounded-[8px] bg-paper py-3 text-center text-[15px] font-bold text-ink">New board</button>
  </div>
</main>
""")

# -------------------------------------------------------------- 2 one board
SCREENS["board"] = ("One board", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Board</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Baseball Board</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">{dollars("sport")} give/get per seat. Starts at three seats and can grow to five.</p>

  <div class="mb-4">{rail("offer", f'''<div class="min-w-0">
    <div class="flex items-start justify-between gap-3">
      <div class="text-[14.5px] font-bold text-ink">$7,200 of $15,000</div>
      <span class="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">48%</span>
    </div>
    <div class="mt-0.5 text-[12.5px] text-muted">3 seats filled &middot; 2 open &middot; 1 of 3 fully met</div>
    {bar(48, "offer")}
  </div>''')}</div>

  <div class="mb-2">{header("Seats", "3", "contact")}</div>
  <div class="flex flex-col gap-2">
    {member_row("A. Placeholder", "Sport Director", "$5,000", "$0", 100, "committed")}
    {member_row("B. Placeholder", "Board Chair", "$1,000", "$1,200", 44, "offer", "$2,000 pledged, not yet received")}
    {member_row("C. Placeholder", "Recruiting Lead", "$0", "$0", 0, "target", "Term started 1 Sep")}
  </div>

  <div class="mb-2 mt-5">{header("Open seats", "2", "target")}</div>
  {rail("target", '''<div class="text-[13.5px] leading-tight text-ink">Two seats to fill, up to the cap of five.
    <div class="mt-1 text-[12.5px] leading-tight text-muted">The three core roles are filled. Anything beyond them is at the board's discretion.</div></div>''')}

  <div class="mt-3">{note("A pledge sits beside the progress, never inside it, exactly as on the fundraising screens. A promise does not discharge a commitment.", "contact")}</div>
</main>
""")

# -------------------------------------------------------------- 3 add a seat
SCREENS["seat"] = ("Add a seat", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Baseball Board</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Add a seat</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">Baseball Board. Two seats open of five.</p>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Name</label>
    <input value="D. Placeholder" class="{INPUT}" />
  </div>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Role</label>
    <input value="Recruiting Lead" class="{INPUT}" />
    <p class="mt-1 text-[12.5px] leading-tight text-muted">The sport boards' three core roles are Sport Director, Board Chair and Recruiting Lead. Anything else is fine too.</p>
  </div>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Status</label>
    <input value="Prospect" class="{INPUT}" />
    <p class="mt-1 text-[12.5px] leading-tight text-muted">Only an active seat counts toward the board's committed total. A prospect has not joined yet.</p>
  </div>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Commitment</label>
    <input value="{dollars('sport')}" class="{INPUT} tabular-nums" />
    <p class="mt-1 text-[12.5px] leading-tight text-muted">Copied from the board so that changing the tier later does not rewrite what a sitting member agreed to.</p>
  </div>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Donor record</label>
    <input value="Not linked" class="{INPUT}" />
    <p class="mt-1 text-[12.5px] leading-tight text-muted">Linking finds their own giving automatically. Without it, only what they bring in can be credited.</p>
  </div>

  <div class="mb-4 grid grid-cols-2 gap-2">
    <div>
      <label class="mb-1.5 block text-[12px] font-bold text-muted">Term starts</label>
      <input value="2026-09-01" class="{INPUT} tabular-nums" />
    </div>
    <div>
      <label class="mb-1.5 block text-[12px] font-bold text-muted">Term ends</label>
      <input placeholder="optional" class="{INPUT} tabular-nums" />
    </div>
  </div>

  <button class="w-full rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Add the seat</button>
</main>
""")

# ------------------------------------------------------- 4 crediting a gift
SCREENS["credit"] = ("Crediting the get", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Fundraising</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Record a gift</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">One extra field once the board module is on.</p>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Amount</label>
    <input value="$6,000.00" class="{INPUT} text-[20px] font-bold tabular-nums" />
  </div>
  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Donor</label>
    <input value="Example Corp" class="{INPUT}" />
  </div>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Brought in by</label>
    <input value="B. Placeholder, Baseball Board" class="{INPUT}" />
    <p class="mt-1 text-[12.5px] leading-tight text-muted">Credits this toward their give/get. This is the "get" half, and it is the thing most board software cannot record at all.</p>
  </div>

  <div class="mb-4">{note("If the donor and the person who brought it in are the same, it counts once. A member cannot clear a $10,000 commitment with $5,000 by being credited twice.", "contact")}</div>

  <button class="w-full rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Record it</button>
</main>
""")

order = ["boards", "board", "seat", "credit"]
options = [f'<option value="{k}">{SCREENS[k][0]}</option>' for k in order]
blocks = [f'<div class="screen" data-screen="{k}" hidden><div class="phone">{SCREENS[k][1]}</div></div>' for k in order]

HTML = f"""<title>Board Governance Preview</title>
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

<h1 class="pg">Board governance</h1>
<p class="lede">Four screens at phone width, using the app's own compiled CSS and the locked catalog. Nothing here is built yet. React before I write it. Every name and figure is made up.</p>

<div class="controls">
  <select id="picker" onchange="show(this.value)">{"".join(options)}</select>
  <span class="hint">Mockup. Nothing here works.</span>
</div>

{"".join(blocks)}

<p class="note">
  <b>The structure is yours.</b> Five tiers from your governance document, with its amounts:
  Executive {dollars("executive")}, General {dollars("general")}, Sport {dollars("sport")},
  Development {dollars("development")}, Junior {dollars("junior")}. Sport boards start at three seats
  and grow to five, with a Sport Director, a Board Chair and a Recruiting Lead.
  <br><br>
  <b>Give/get means both halves, and that is the whole feature.</b> A member meets their number by
  giving it or by bringing it in from somebody else. Most board software counts only personal giving,
  which understates everyone who is good at fundraising and tells you the wrong people are behind.
  That is why recording a gift gains a "brought in by" field. A gift somebody both made and brought
  in counts once.
  <br><br>
  <b>Two rules carried over from fundraising.</b> A pledge sits beside progress, never inside it. An
  in-kind gift does not discharge a cash commitment, because a donated case of food is not $10,000.
  <br><br>
  <b>Only active seats count.</b> A prospect has not joined and an emeritus member is not on the hook,
  so neither is counted against the board's total. Counting them would make the board look further
  behind than it is.
  <br><br>
  <b>Gated.</b> All of this sits behind <code>board_governance</code>, off by default. Elite Squad
  never sees it.
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
show("boards");
</script>
"""

out = os.path.join(OUT_DIR, "governance_preview.html")
open(out, "w").write(HTML)
print(f"wrote {out} ({len(HTML)} bytes)")
