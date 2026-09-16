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
    f"const {name} = {json.dumps(parse_map(name))};" for name in ("SOLID", "TINT", "RAIL", "DOT")
)

HTML = f"""<title>Recruiting Platform Prototype</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
{CSS}
:root {{ --page-bg:#e8e8ec; --page-fg:#1c1c1e; --page-muted:#6e6e73; --page-line:#d8d8dc; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --page-bg:#08080a; --page-fg:#f2f2f4; --page-muted:#9a9aa2; --page-line:#2a2a2e; }} }}
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
.topbar .badge {{ font-size:10.5px; font-weight:800; text-transform:uppercase;
  letter-spacing:.04em; color:var(--muted); }}

#tabbar {{ position:fixed; bottom:0; left:50%; transform:translateX(-50%);
  width:100%; max-width:430px; display:flex; z-index:30;
  background:var(--paper); border-top:1px solid var(--line);
  padding-bottom:env(safe-area-inset-bottom); }}
@media (min-width:520px) {{
  #tabbar {{ position:absolute; bottom:0; left:0; transform:none; }}
}}
#tabbar button {{ border:0; background:none; cursor:pointer; font:inherit; }}

#toast {{ position:fixed; bottom:64px; left:0; right:0; z-index:40; pointer-events:none; }}
@media (min-width:520px) {{ #toast {{ position:absolute; }} }}

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
  <div id="toast"></div>
  <div id="tabbar"></div>
</div>

<p class="hintbar">
  Prototype on invented data. Every number is computed by the app's real shipped code, so it
  responds the way the app does. Things worth trying: change a target's stage and watch the fit
  score move, edit the Cardinal Ridge grading scale and watch a core GPA move with it, record an
  in-kind gift and watch it stay out of the cash total, and switch to Elite Squad under More to
  see the fundraising and board sections disappear.
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
