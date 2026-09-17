"""The click-through prototype: the whole app, clickable, on mock data.

Different from the static previews and from the test bench, and worth
having alongside both:

  - A preview shows what one screen looks like. It is a picture.
  - The bench runs the pure modules against inputs you type. It is a lab.
  - This is the app. You tap through it, change things, and watch the
    real engines respond.

The numbers are not written into the mock data. They are computed by the
SHIPPED code: src/lib/fit/ for the fit scores, src/lib/fit/ncaa/ for the
core GPAs and eligibility verdicts, src/lib/fundraising/ for the money,
src/lib/governance/ for give/get. Change a grading scale in the
prototype and the core GPA moves, because the same function that runs in
production runs here. That only works because those modules are walled
off from Next, Supabase and the DOM.

Every person, school and figure in it is invented. No real athlete,
donor or board member appears in a prototype.

Run: scripts/build_previews.sh, or by hand:
  npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify
  npx esbuild scripts/prototype_entry.ts --bundle --format=iife \
      --target=es2020 --minify --outfile=/tmp/prototype.min.js
  python3 scripts/build_prototype.py
"""

import json
import re

CSS = re.sub(r"body\{[^}]*\}", "", open("/tmp/preview.css").read(), count=1)
BUNDLE = open("/tmp/prototype.min.js").read()
DATA = open("scripts/prototype_data.js").read()
APP = open("scripts/prototype_app.js").read()
HUE = open("src/components/statusHue.ts").read()


def parse_map(name):
    """The colour maps, parsed out of the component rather than copied.

    Copies drifted three times in one sitting before this was added to
    the other generators; the prototype is not an exception."""
    body = re.search(name + r"\s*(?::[^=]*)?=\s*\{(.*?)\n\}", HUE, re.S)
    return {k.strip(): v for k, v in re.findall(r'"?([A-Za-z ]+)"?\s*:\s*"([^"]+)"', body.group(1))}


MAPS = "\n".join(
    f"const {name} = {json.dumps(parse_map(name))};" for name in ("SOLID", "TINT", "RAIL", "DOT", "FG", "TEXT_ON", "STATUS_ROLE", "STAGE_KIND")
)

# The type glyphs, read from the same file the app's RowGlyph imports.
# Not copied: a copied map drifted three times in one sitting earlier in
# this project, which is why every generator parses the source.
ICONS = {k: v for k, v in json.load(open("src/components/rowIcons.json")).items() if k != "_comment"}
MAPS += f"\nconst ICONS = {json.dumps(ICONS)};"

HTML = f"""<title>Recruiting Platform Prototype</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
{CSS}
/* The page frame follows the same [data-theme] the app's own tokens key
   off in globals.css, and nothing else. It used to follow the browser's
   preference separately, which put a dark frame around a light app on a
   dark phone. One switch, both layers. */
:root {{ --page-bg:#e8e8ec; --page-fg:#1c1c1e; --page-muted:#6e6e73; --page-line:#d8d8dc; }}
:root[data-theme="dark"] {{ --page-bg:#08080a; --page-fg:#f2f2f4; --page-muted:#9a9aa2; --page-line:#2a2a2e; }}

* {{ -webkit-tap-highlight-color: transparent; }}
body {{ background:var(--page-bg); color:var(--page-fg);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  margin:0; padding:0; }}

.wrap {{ max-width:430px; margin:0 auto; min-height:100vh; position:relative;
  background:var(--bg); box-shadow:0 0 0 1px var(--page-line); }}
@media (min-width:520px) {{
  .wrap {{ margin:20px auto; min-height:calc(100vh - 40px); border-radius:22px; overflow:hidden; }}
  body {{ padding:0 0 20px; }}
}}

.topbar {{ position:sticky; top:0; z-index:20; display:flex; align-items:center;
  justify-content:space-between; gap:10px; padding:10px 16px;
  background:var(--bg); border-bottom:1px solid var(--line); }}
.topbar .name {{ font-size:13px; font-weight:800; color:var(--ink); }}
.topbar .badge {{ display:flex; align-items:center; }}
/* font-family only, never the font shorthand: the shorthand resets
   font-size too, and this selector outranks the utility class that was
   setting it, which rendered the toggle at body size. */
.topbar .badge button {{ border:0; cursor:pointer; font-family:inherit; }}

#tabbar {{ position:fixed; bottom:0; left:50%; transform:translateX(-50%);
  width:100%; max-width:430px; display:flex; z-index:30;
  background:var(--paper); border-top:1px solid var(--line);
  padding-bottom:env(safe-area-inset-bottom); }}
@media (min-width:520px) {{
  #tabbar {{ position:absolute; bottom:0; left:0; transform:none; }}
}}
#tabbar button {{ border:0; background:none; cursor:pointer; font-family:inherit; }}

#toast {{ position:fixed; bottom:110px; left:0; right:0; z-index:60; pointer-events:none; }}
@media (min-width:520px) {{ #toast {{ position:absolute; }} }}

/* The flag button rides above the tab bar on every screen, because a
   bug spotted three taps deep is one nobody reports if reporting it
   means navigating away first. */
.flagwrap {{ position:fixed; bottom:60px; right:16px; z-index:35; }}
@media (min-width:520px) {{ .flagwrap {{ position:absolute; }} }}
.flagwrap button {{ border:0; cursor:pointer; font-family:inherit; }}

.sheetbackdrop {{ position:fixed; inset:0; z-index:50; background:rgba(0,0,0,.35); }}
.sheet {{ position:fixed; bottom:0; left:50%; transform:translateX(-50%);
  width:100%; max-width:430px; z-index:55; background:var(--paper);
  border-top-left-radius:18px; border-top-right-radius:18px;
  padding:16px 16px calc(16px + env(safe-area-inset-bottom));
  box-shadow:0 -8px 32px rgba(0,0,0,.18); }}
@media (min-width:520px) {{
  .sheetbackdrop {{ position:absolute; }}
  .sheet {{ position:absolute; left:0; transform:none; }}
}}
.sheet textarea {{ resize:none; }}

input, select, textarea, button {{ font-family:inherit; }}
select {{ appearance:none; }}
.hintbar {{ font-size:11px; line-height:1.5; color:var(--page-muted);
  max-width:430px; margin:0 auto; padding:14px 16px 0; }}
</style>

<div class="wrap">
  <div class="topbar">
    <div class="name">Recruiting Platform</div>
    <div class="badge" id="orgbadge"></div>
  </div>
  <div id="screen"></div>
  <div id="buglayer"></div>
  <div id="toast"></div>
  <div id="tabbar"></div>
</div>

<p class="hintbar">
  Invented data, real engines. <b>Light</b> in the top right switches to dark and back.
  Tap <b>Flag a bug</b> on any screen to send me one; it records where you were.
</p>

<script>
{BUNDLE}
</script>
<script>
{MAPS}
{DATA}
{APP}
</script>
"""

out = "/tmp/claude-0/-home-claude/29e8f462-8fb8-51f4-a493-bd698cb56848/scratchpad/prototype.html"
open(out, "w").write(HTML)
print(f"wrote {out} ({len(HTML)} bytes)")
