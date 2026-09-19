"""Builds the functional test bench artifact.

Unlike the preview generators, this is not a mockup of anything. It bundles
the SHIPPED fit engine and Doc AI pipeline with esbuild and runs them in the
page. Dave can change an input and watch the real scorer respond, and the
check list at the top is the repo's own laws executing in his browser.

That is only possible because both modules are walled off from Next,
Supabase and the DOM (CLAUDE.md), which is the practical payoff of that
rule rather than a theoretical one.

Run: npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify
     npx esbuild scripts/testbench_entry.ts --bundle --format=iife \\
       --target=es2020 --minify --outfile=/tmp/testbench.min.js
     python3 scripts/build_testbench.py
"""

import re
import os
# Where the generated pages land. The previous hardcoded path was one
# session's scratchpad and did not exist anywhere else.
OUT_DIR = os.environ.get("PREVIEW_OUT_DIR", "/tmp/previews")
os.makedirs(OUT_DIR, exist_ok=True)


CSS = re.sub(r"body\{[^}]*\}", "", open("/tmp/preview.css").read(), count=1)
BUNDLE = open("/tmp/testbench.min.js").read()

HUE = open("src/components/statusHue.ts").read()


def parse_map(name):
    body = re.search(name + r"\s*(?::[^=]*)?=\s*\{(.*?)\n\}", HUE, re.S)
    return {k.strip(): v for k, v in re.findall(r'"?([A-Za-z ]+)"?\s*:\s*"([^"]+)"', body.group(1))}


SOLID = parse_map("SOLID")
TINT = parse_map("TINT")

# The kit's own classes (src/components/kit/index.tsx), so the bench's
# controls are drawn on the same scale as the app's. A class the app's
# stylesheet does not carry renders as nothing here, which is the point.
FIELD = ("w-full min-h-12 rounded border-0 bg-paper px-4 text-body text-ink "
         "focus:outline-none focus:ring-2 focus:ring-accent")
LABEL = "mb-1 block text-label font-bold text-muted"
BTN = "min-h-12 rounded bg-solid-accent px-4 text-body font-bold text-solid-accent-on"

DIVISIONS = ["D1", "D2", "D3", "NAIA", "JUCO"]
POSITIONS = ["SS", "RHP", "LHP", "C", "OF", "1B", "2B", "3B"]
CATEGORIES = [("", "Detect it"), ("transcript", "Transcript"), ("test_scores", "Test Scores"),
              ("offer_letter", "Offer Letter"), ("recommendation", "Recommendation"),
              ("financial_aid", "Financial Aid")]
SOURCES = [("coordinator", "I uploaded it"), ("admin", "An owner uploaded it"),
           ("parent", "A parent sent it"), ("athlete", "The athlete sent it"), ("email", "Came in by email")]


def options(pairs, selected=None):
    out = []
    for v, label in pairs:
        sel = " selected" if v == selected else ""
        out.append(f'<option value="{v}"{sel}>{label}</option>')
    return "".join(out)


def simple_options(values, selected=None):
    return options([(v, v) for v in values], selected)


HTML = f"""<title>Bridge Test Bench</title>
<style>
{CSS}
:root {{ --page-bg:#f5f5f7; --page-fg:#1c1c1e; --page-muted:#6e6e73; --page-line:#d8d8dc; --page-card:#fff; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --page-bg:#0b0b0d; --page-fg:#f2f2f4; --page-muted:#9a9aa2; --page-line:#2a2a2e; --page-card:#17171a; }} }}
:root[data-theme="dark"] {{ --page-bg:#0b0b0d; --page-fg:#f2f2f4; --page-muted:#9a9aa2; --page-line:#2a2a2e; --page-card:#17171a; }}
body {{ background:var(--page-bg); color:var(--page-fg);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  max-width:900px; margin:0 auto; padding:18px 16px 70px; }}
h1.pg {{ font-size:21px; font-weight:800; margin:0 0 5px; }}
p.lede {{ color:var(--page-muted); font-size:13.5px; line-height:1.5; margin:0 0 16px; }}
.tabs {{ display:flex; gap:6px; margin-bottom:16px; flex-wrap:wrap; }}
.tab {{ font:inherit; font-size:12.5px; font-weight:700; padding:7px 13px; border-radius:999px; cursor:pointer;
  border:1px solid var(--page-line); background:var(--page-card); color:var(--page-fg); }}
.tab.on {{ background:var(--page-fg); color:var(--page-bg); border-color:var(--page-fg); }}
.panel[hidden] {{ display:none !important; }}
.card {{ border:1px solid var(--page-line); border-radius:14px; background:var(--page-card); padding:14px; margin-bottom:14px; }}
.card h2 {{ font-size:14px; font-weight:800; margin:0 0 3px; }}
.card p.sub {{ font-size:11.5px; color:var(--page-muted); margin:0 0 12px; line-height:1.45; }}
.dark {{ background:#0c0c0c; border-radius:12px; padding:14px; }}
.grid {{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }}
@media (max-width:560px) {{ .grid {{ grid-template-columns:1fr; }} }}
.rowline {{ display:flex; justify-content:space-between; gap:10px; align-items:baseline; padding:7px 0;
  border-bottom:1px solid var(--page-line); font-size:12.5px; }}
.rowline:last-child {{ border-bottom:0; }}
.rowline .k {{ color:var(--page-muted); }}
.rowline .v {{ font-weight:700; font-variant-numeric:tabular-nums; text-align:right; }}
.check {{ display:flex; gap:9px; align-items:flex-start; padding:7px 0; border-bottom:1px solid var(--page-line); font-size:12.5px; }}
.check:last-child {{ border-bottom:0; }}
.dot {{ width:9px; height:9px; border-radius:50%; margin-top:4px; flex-shrink:0; }}
.ok {{ background:#30D158; }} .bad {{ background:#FF375F; }}
.check .nm {{ flex:1; }}
.check .sq {{ color:var(--page-muted); font-size:11px; }}
.check .why {{ color:#FF375F; font-size:11px; margin-top:2px; }}
.tally {{ font-size:12.5px; font-weight:800; margin-bottom:10px; }}
pre.out {{ margin:0; font-size:11px; line-height:1.5; white-space:pre-wrap; word-break:break-word;
  color:var(--page-muted); max-height:230px; overflow:auto; }}
.muted {{ color:var(--page-muted); font-size:11.5px; }}
.note {{ margin-top:18px; font-size:12.5px; line-height:1.6; color:var(--page-muted);
  border-top:1px solid var(--page-line); padding-top:14px; }}
.note b {{ color:var(--page-fg); }}
</style>

<h1 class="pg">Bridge test bench</h1>
<p class="lede">This is not a mockup. The real fit engine and the real Doc AI pipeline are compiled into this page and run when you press the buttons. Same code as the app.</p>

<div class="tabs">
  <button class="tab on" data-tab="checks" onclick="showTab('checks')">Checks</button>
  <button class="tab" data-tab="fit" onclick="showTab('fit')">School match</button>
  <button class="tab" data-tab="doc" onclick="showTab('doc')">Doc AI</button>
</div>

<!-- ------------------------------------------------------------ checks -->
<div class="panel" data-panel="checks">
  <div class="card">
    <h2>Every check, run here in your browser</h2>
    <p class="sub">These are the repo's own laws plus the routing and matching rules, executing against the shipped code. Green means the rule held when you pressed the button, not when I last ran it.</p>
    <button class="{BTN}" onclick="runChecks()">Run all checks</button>
    <div id="tally" class="tally" style="margin-top:12px"></div>
    <div id="checks"></div>
  </div>
</div>

<!-- --------------------------------------------------------------- fit -->
<div class="panel" data-panel="fit" hidden>
  <div class="card">
    <h2>School match</h2>
    <p class="sub">Change anything and press Score. This calls scoreFit() directly, the same function the board calls on every page load.</p>
    <div class="grid">
      <div>
        <label class="{LABEL}">Athlete GPA</label>
        <input id="f_gpa" class="{FIELD}" type="number" step="0.01" min="0" max="4" value="3.6">
      </div>
      <div>
        <label class="{LABEL}">Recruit type</label>
        <select id="f_type" class="{FIELD}">{options([("hs","High School"),("transfer_4to4","Transfer 4-to-4"),("transfer_juco","Transfer JUCO"),("transfer_grad","Transfer Grad")])}</select>
      </div>
      <div>
        <label class="{LABEL}">Position</label>
        <select id="f_pos" class="{FIELD}">{simple_options(POSITIONS)}</select>
      </div>
      <div>
        <label class="{LABEL}">Exit velo (mph)</label>
        <input id="f_velo" class="{FIELD}" type="number" value="88">
      </div>
      <div>
        <label class="{LABEL}">School division</label>
        <select id="f_div" class="{FIELD}">{simple_options(DIVISIONS, "D2")}</select>
      </div>
      <div>
        <label class="{LABEL}">Sponsors baseball</label>
        <select id="f_sponsor" class="{FIELD}">{options([("yes","Yes"),("no","No")])}</select>
      </div>
      <div>
        <label class="{LABEL}">School GPA minimum</label>
        <input id="f_gpamin" class="{FIELD}" type="number" step="0.1" value="3.0">
      </div>
      <div>
        <label class="{LABEL}">Athletic scholarship on record</label>
        <select id="f_sch" class="{FIELD}">{options([("partial","Partial"),("full","Full"),("none","None")])}</select>
      </div>
    </div>
    <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap">
      <button class="{BTN}" onclick="runFit()">Score it</button>
      <button class="tab" onclick="preset('d3')">Try: D3 with a scholarship on record</button>
      <button class="tab" onclick="preset('veto')">Try: sport not sponsored</button>
    </div>
  </div>
  <div class="card" id="fitout" hidden>
    <h2>Result</h2>
    <div class="dark" id="fitcard"></div>
    <div style="margin-top:12px"><div class="{LABEL}">Everything it returned</div><pre class="out" id="fitraw"></pre></div>
  </div>
</div>

<!-- --------------------------------------------------------------- doc -->
<div class="panel" data-panel="doc" hidden>
  <div class="card">
    <h2>Doc AI</h2>
    <p class="sub">Runs the real pipeline: triage, extract, validate against the schema, match to the roster, route. The model itself is the stand-in, since no API key is wired up, so the extracted values are made up. Everything deciding what happens to them is real.</p>
    <div class="grid">
      <div>
        <label class="{LABEL}">Document type</label>
        <select id="d_cat" class="{FIELD}">{options(CATEGORIES)}</select>
      </div>
      <div>
        <label class="{LABEL}">Who sent it</label>
        <select id="d_src" class="{FIELD}">{options(SOURCES)}</select>
      </div>
      <div>
        <label class="{LABEL}">File name</label>
        <input id="d_name" class="{FIELD}" value="marcus-transcript.pdf">
      </div>
      <div>
        <label class="{LABEL}">File size (bytes)</label>
        <input id="d_size" class="{FIELD}" type="number" value="260000">
      </div>
    </div>
    <div style="margin-top:10px">
      <label class="{LABEL}">Roster it can match against (one name per line)</label>
      <textarea id="d_roster" class="{FIELD}" rows="3">Sample Athlete
Marcus Bellamy
Ava Thompson</textarea>
    </div>
    <p class="muted" style="margin-top:8px">The file name and size are the seed, so the same values always behave the same way. Change the name to get a different scan quality.</p>
    <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap">
      <button class="{BTN}" onclick="runDocOnce()">Read it</button>
      <button class="tab" onclick="docPreset('parent')">Try: same file, from a parent</button>
      <button class="tab" onclick="docPreset('bad')">Try: an unreadable scan</button>
      <button class="tab" onclick="docPreset('nomatch')">Try: a name nobody has</button>
    </div>
  </div>
  <div class="card" id="docout" hidden>
    <h2>What happened</h2>
    <div class="dark" id="doccard"></div>
    <div style="margin-top:12px"><div class="{LABEL}">Everything it returned</div><pre class="out" id="docraw"></pre></div>
  </div>
</div>

<p class="note">
  <b>Why this can exist.</b> The fit engine and Doc AI are kept free of Next, Supabase and the DOM,
  with their model caller injected rather than imported. That rule was written down so the recruiting
  engine could one day lift out into its own product. The side effect is that both modules compile
  straight into this page, so what you are pressing buttons on is the shipped code and not a
  reproduction of it.
  <br><br>
  <b>What is still simulated.</b> Only the model. Everything that decides what happens to what the
  model returns, the schema validation, the confidence weighting, the roster matching and the routing,
  is the real thing.
</p>

<script>
{BUNDLE}
</script>
<script>
function showTab(name) {{
  document.querySelectorAll(".panel").forEach(function (p) {{ p.hidden = p.getAttribute("data-panel") !== name; }});
  document.querySelectorAll(".tab[data-tab]").forEach(function (t) {{ t.classList.toggle("on", t.getAttribute("data-tab") === name); }});
}}

function esc(s) {{ return String(s).replace(/[&<>]/g, function (c) {{ return {{ "&": "&amp;", "<": "&lt;", ">": "&gt;" }}[c]; }}); }}

async function runChecks() {{
  var sync = window.Bridge.runSuite();
  var async_ = await window.Bridge.runDocSuite();
  var all = sync.concat(async_);
  var passed = all.filter(function (c) {{ return c.pass; }}).length;
  document.getElementById("tally").textContent = passed + " of " + all.length + " checks pass";
  document.getElementById("tally").style.color = passed === all.length ? "#30D158" : "#FF375F";
  document.getElementById("checks").innerHTML = all.map(function (c) {{
    return '<div class="check"><span class="dot ' + (c.pass ? "ok" : "bad") + '"></span>' +
      '<span class="nm">' + esc(c.name) + '<div class="sq">' + esc(c.suite) + '</div>' +
      (c.pass ? "" : '<div class="why">' + esc(c.detail) + "</div>") + "</span></div>";
  }}).join("");
}}

function preset(kind) {{
  if (kind === "d3") {{ document.getElementById("f_div").value = "D3"; document.getElementById("f_sch").value = "full"; document.getElementById("f_sponsor").value = "yes"; }}
  if (kind === "veto") {{ document.getElementById("f_sponsor").value = "no"; document.getElementById("f_gpa").value = "4"; }}
  runFit();
}}

function runFit() {{
  var v = function (id) {{ return document.getElementById(id).value; }};
  var athlete = {{
    id: "bench", orgId: "bench", recruitType: v("f_type"), name: "Bench Athlete", sport: "baseball",
    position: v("f_pos"), gpa: parseFloat(v("f_gpa")), measurables: {{ exitVelo: parseFloat(v("f_velo")) }},
  }};
  if (athlete.recruitType !== "hs") {{
    athlete.detail = {{ kind: "transfer", currentSchool: "Old U", eligibilityYearsRemaining: 2, transferCount: 1, portalEntryDate: "2026-06-15" }};
  }}
  var school = {{
    id: "bench", name: "Bench University", division: v("f_div"),
    sportsSponsored: v("f_sponsor") === "yes" ? ["baseball"] : ["football"],
    academics: {{ gpaMin: parseFloat(v("f_gpamin")) }},
    financials: {{ athleticScholarship: v("f_sch"), avgMeritAid: 12000, outstateTotal: 48000 }},
  }};
  var r = window.Bridge.scoreFit(athlete, school, {{}});
  document.getElementById("fitout").hidden = false;
  var tagColor = r.tag === "Conflict" ? "#FF375F" : r.tag === "Safety" ? "#30D158" : r.tag === "Reach" ? "#FFD60A" : "#FF453A";
  var dims = ["academic", "athletic", "financial", "eligibility"].filter(function (k) {{ return r[k]; }});
  document.getElementById("fitcard").innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
      '<div style="font-size:15px;font-weight:800;color:' + tagColor + '">' + esc(r.tag) + "</div>" +
      '<div style="font-size:26px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums">' + r.score + "</div>" +
    "</div>" +
    dims.map(function (k) {{
      var d = r[k];
      return '<div class="rowline" style="border-color:#2b2b2b"><span class="k" style="color:#9ca3af">' + k +
        (d.veto ? ' <span style="color:#FF375F;font-weight:700">veto</span>' : "") +
        '</span><span class="v" style="color:#fff">' + d.score + ' <span style="color:#9ca3af;font-weight:400">' + esc(d.confidence) + "</span></span></div>";
    }}).join("") +
    (r.reasons.length ? '<div style="margin-top:10px;font-size:11.5px;color:#9ca3af">' + r.reasons.map(esc).join("<br>") + "</div>" : "") +
    (r.warnings.length ? '<div style="margin-top:6px;font-size:11.5px;color:#FFD60A">' + r.warnings.map(esc).join("<br>") + "</div>" : "");
  document.getElementById("fitraw").textContent = JSON.stringify(r, null, 2);
}}

function docPreset(kind) {{
  if (kind === "parent") {{ document.getElementById("d_src").value = "parent"; }}
  if (kind === "bad") {{ document.getElementById("d_name").value = "IMG_4821.HEIC"; document.getElementById("d_size").value = "90000"; }}
  if (kind === "nomatch") {{ document.getElementById("d_roster").value = "Tyler Nwosu\\nDiego Marin"; }}
  runDocOnce();
}}

async function runDocOnce() {{
  var cat = document.getElementById("d_cat").value || null;
  var out = await window.Bridge.runDoc({{
    category: cat,
    sourceRole: document.getElementById("d_src").value,
    fileName: document.getElementById("d_name").value,
    fileSize: parseInt(document.getElementById("d_size").value, 10) || 1000,
    rosterNames: document.getElementById("d_roster").value.split("\\n").map(function (s) {{ return s.trim(); }}).filter(Boolean),
  }});
  document.getElementById("docout").hidden = false;
  var r = out.result;
  var head, body = "";
  if (!r) {{
    head = '<div style="font-size:15px;font-weight:800;color:#FF375F">Could not tell what this is</div>';
  }} else if (!r.ok) {{
    head = '<div style="font-size:15px;font-weight:800;color:#FF375F">Stopped: ' + esc(r.stage) + "</div>";
    body = '<div style="margin-top:8px;font-size:11.5px;color:#9ca3af">' + esc(r.error) + "</div>";
  }} else {{
    var color = r.route === "auto_apply" ? "#30D158" : r.route === "review" ? "#FF9F0A" : "#FF375F";
    var label = r.route === "auto_apply" ? "Applied on its own" : r.route === "review" ? "Held for review" : "Refused";
    head = '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
      '<div style="font-size:15px;font-weight:800;color:' + color + '">' + label + "</div>" +
      '<div style="font-size:26px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums">' +
      Math.round(r.provenance.confidence * 100) + "%</div></div>";
    body =
      '<div class="rowline" style="border-color:#2b2b2b"><span class="k" style="color:#9ca3af">model was sure</span><span class="v" style="color:#fff">' +
        Math.round((r.provenance.modelConfidence || 0) * 100) + "%</span></div>" +
      '<div class="rowline" style="border-color:#2b2b2b"><span class="k" style="color:#9ca3af">scan legibility</span><span class="v" style="color:#fff">' +
        Math.round((r.provenance.legibility || 0) * 100) + "%</span></div>" +
      '<div class="rowline" style="border-color:#2b2b2b"><span class="k" style="color:#9ca3af">best roster match</span><span class="v" style="color:#fff">' +
        (r.candidates.length ? esc(r.candidates[0].athlete.name) + " " + Math.round(r.candidates[0].score * 100) + "%" : "nobody") + "</span></div>" +
      (out.detected ? '<div style="margin-top:8px;font-size:11.5px;color:#9ca3af">Nobody told it the type. It decided: ' + esc(out.detected) + "</div>" : "");
  }}
  document.getElementById("doccard").innerHTML = head + body;
  document.getElementById("docraw").textContent = JSON.stringify(out, null, 2);
}}

runChecks();
runFit();
</script>
"""

out = os.path.join(OUT_DIR, "test_bench.html")
open(out, "w").write(HTML)
print(f"wrote {out} ({len(HTML)} bytes, bundle {len(BUNDLE)} bytes)")
