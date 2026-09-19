"""Preview for the fundraising screens, before any of them are built.

Same rule as the other generators: the CSS is the app's own compiled
Tailwind output and the colour maps are parsed out of
src/components/statusHue.ts, so a wrong class renders as nothing rather
than quietly looking fine. The category labels are read out of
src/lib/fundraising/rollup.ts rather than retyped.

The model is not invented. Dave's existing BFFSA platform app already
tracks donors, a transaction ledger and a P&L with five revenue
categories against a full-year budget, so these screens show the same
five rows, with the same names, and a report out of this system
reconciles against the one his board already sees.

Every name and figure here is made up. No real donor appears in a
mockup.

Run: npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify
then python3 scripts/build_fundraising_preview.py
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

# The five P&L rows, read out of the shipped module so this cannot drift.
RU = open("src/lib/fundraising/rollup.ts").read()
LABELS = re.search(r"CATEGORY_LABEL: Record<GiftCategory, string> = \{(.*?)\n\}", RU, re.S).group(1)
CATEGORIES = re.findall(r'\w+:\s*"([^"]+)"', LABELS)


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


def tile(label, value, sub=""):
    s = f'<div class="mt-0.5 text-[11.5px] leading-tight text-muted">{sub}</div>' if sub else ""
    return ('<div class="rounded-[12px] bg-paper p-3.5">'
            f'<div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">{label}</div>'
            f'<div class="mt-1 text-[26px] font-black tabular-nums leading-tight text-ink">{value}</div>{s}</div>')


def bar(pct, role):
    width = min(100, pct)
    return ('<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line">'
            f'<div class="h-full rounded-full {DOT[role]}" style="width:{width}%"></div></div>')


def cat_row(label, actual, budget, pct, role):
    return rail(role, f'''<div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="text-[14.5px] font-bold text-ink">{label}</div>
        <div class="mt-0.5 text-[12.5px] text-muted">{actual} of {budget}</div>
        {bar(pct, role)}
      </div>
      <span class="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">{pct}%</span>
    </div>''')


INPUT = ('w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 '
         'text-[15px] text-ink placeholder:text-muted')

SCREENS = {}

# ------------------------------------------------------------- 1 overview
SCREENS["overview"] = ("Fundraising overview", f"""
<main class="px-4 pt-2 pb-6">
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Fundraising</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">2026, against the board budget. Cash received only.</p>

  <div class="mb-3 grid grid-cols-2 gap-2">
    {tile("Raised", "$118,420", "cash in the door")}
    {tile("Budget", "$185,000", "64% of the year's target")}
  </div>

  <div class="mb-4">{rail("offer", '''<div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="text-[14.5px] font-bold text-ink">$34,500 promised, not received</div>
      <div class="mt-1 text-[13px] leading-tight text-muted">Not counted in the $118,420 above. $8,000 of it is past its due date.</div>
    </div>
  </div>''')}</div>

  <div class="mb-2">{header("By category", None, "committed")}</div>
  <div class="flex flex-col gap-2">
    {cat_row(CATEGORIES[0], "$41,200", "$60,000", 69, "committed")}
    {cat_row(CATEGORIES[1], "$28,000", "$30,000", 93, "committed")}
    {cat_row(CATEGORIES[2], "$22,500", "$45,000", 50, "offer")}
    {cat_row(CATEGORIES[3], "$26,720", "$25,000", 107, "committed")}
    {cat_row(CATEGORIES[4], "$0", "$25,000", 0, "target")}
  </div>

  <div class="mt-3">{note("Special Events is over budget because the Bridge Invitational cleared its goal. Foundation Grants is at zero because no application has been submitted yet.", "contact")}</div>

  <div class="mb-2 mt-5">{header("In kind", None, "place")}</div>
  {rail("place", '''<div class="flex items-center justify-between gap-3">
    <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">$6,850 donated in goods and services</div>
    <div class="mt-0.5 text-[12.5px] leading-tight text-muted">Counted as support, never as cash. Food, printing and two rounds of golf.</div></div>
  </div>''')}

  <div class="mb-2 mt-5">{header("Campaigns", "2", "visit")}</div>
  <div class="flex flex-col gap-2">
    {rail("committed", f'''<div class="min-w-0">
      <div class="flex items-center justify-between gap-3">
        <div class="text-[14.5px] font-bold text-ink">Bridge Invitational</div>
        <span class="text-[13px] font-extrabold tabular-nums text-ink">107%</span>
      </div>
      <div class="mt-0.5 text-[12.5px] text-muted">$26,720 raised of a $25,000 goal</div>
      {bar(107, "committed")}
    </div>''')}
    {rail("offer", f'''<div class="min-w-0">
      <div class="flex items-center justify-between gap-3">
        <div class="text-[14.5px] font-bold text-ink">Year-end appeal</div>
        <span class="text-[13px] font-extrabold tabular-nums text-ink">18%</span>
      </div>
      <div class="mt-0.5 text-[12.5px] text-muted">$5,400 raised of a $30,000 goal &middot; $12,000 pledged</div>
      {bar(18, "offer")}
    </div>''')}
  </div>

  <div class="mt-3">{note("A campaign's percentage is cash raised against goal. Pledges are shown beside it and never inside it: a campaign with promises covering its goal has not met its goal.", "contact")}</div>

  <div class="mt-5 flex flex-col gap-2">
    <button class="rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Record a gift</button>
    <button class="rounded-[8px] bg-paper py-3 text-center text-[15px] font-bold text-ink">Donors</button>
  </div>
</main>
""")

# --------------------------------------------------------------- 2 donors
SCREENS["donors"] = ("Donors", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Fundraising</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Donors</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">62 supporters. Totals are calculated from the gifts, not typed in, so they cannot go stale.</p>

  <div class="mb-2">{header("Needs a thank you", "3", "offer")}</div>
  <div class="flex flex-col gap-2">
    {rail("offer", f'''<div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[14.5px] font-bold text-ink">Sample Family Fund</div>
        <div class="mt-0.5 text-[12.5px] text-muted">$5,000 on 2 Sep &middot; first gift</div>
        <div class="mt-1.5">{chip("Individual", "contact")}</div>
      </div>
      <span class="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">$5,000</span>
    </div>''')}
  </div>

  <div class="mb-2 mt-5">{header("Owes a pledge", "2", "target")}</div>
  {rail("target", '''<div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="text-[14.5px] font-bold text-ink">Example Corp</div>
      <div class="mt-0.5 text-[12.5px] leading-tight text-muted">$12,000 promised in January, $4,000 paid. Due 31 Dec.</div>
    </div>
    <span class="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">$8,000</span>
  </div>''')}

  <div class="mb-2 mt-5">{header("All donors", "62", "contact")}</div>
  <div class="flex flex-col gap-2">
    {rail("contact", '''<div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[14.5px] font-bold text-ink">A. Placeholder</div>
        <div class="mt-0.5 text-[12.5px] text-muted">4 gifts &middot; first Mar 2024 &middot; last Jul 2026</div>
      </div>
      <div class="flex-shrink-0 text-right">
        <div class="text-[14.5px] font-extrabold tabular-nums text-ink">$3,500</div>
        <div class="text-[11.5px] text-muted">lifetime</div>
      </div>
    </div>''')}
    {rail("contact", '''<div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[14.5px] font-bold text-ink">B. Placeholder</div>
        <div class="mt-0.5 text-[12.5px] text-muted">1 gift &middot; Aug 2026 &middot; in kind</div>
      </div>
      <div class="flex-shrink-0 text-right">
        <div class="text-[14.5px] font-extrabold tabular-nums text-muted">$0</div>
        <div class="text-[11.5px] text-muted">$850 in kind</div>
      </div>
    </div>''')}
  </div>

  <div class="mt-3">{note("A donor who has only given in kind shows $0 in cash and their goods beside it. Rolling the two together would tell a treasurer there is money that is not there.", "contact")}</div>
</main>
""")

# ----------------------------------------------------------- 3 record a gift
SCREENS["gift"] = ("Record a gift", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Fundraising</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Record a gift</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">Money that has actually arrived. A promise goes in as a pledge instead.</p>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Amount</label>
    <input value="$250.00" class="{INPUT} text-[20px] font-bold tabular-nums" />
  </div>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Donor</label>
    <input value="Sample Family Fund" class="{INPUT}" />
    <p class="mt-1 text-[12.5px] leading-tight text-muted">Leave blank for cash in a bucket at an event. It still counts in the total and not in the supporter count.</p>
  </div>

  <div class="mb-4 grid grid-cols-2 gap-2">
    <div>
      <label class="mb-1.5 block text-[12px] font-bold text-muted">Received</label>
      <input value="2026-09-16" class="{INPUT} tabular-nums" />
    </div>
    <div>
      <label class="mb-1.5 block text-[12px] font-bold text-muted">Method</label>
      <input value="Stripe" class="{INPUT}" />
    </div>
  </div>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Category</label>
    <input value="{CATEGORIES[0]}" class="{INPUT}" />
    <p class="mt-1 text-[12.5px] leading-tight text-muted">The same five rows as the P&amp;L the board already sees.</p>
  </div>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Campaign</label>
    <input value="Year-end appeal" class="{INPUT}" />
  </div>

  <div class="mb-4">{rail("place", '''<div class="flex items-start gap-3">
    <span class="mt-0.5 h-[22px] w-[22px] flex-shrink-0 rounded-[6px] border-2 border-line"></span>
    <div class="min-w-0 flex-1"><div class="text-[14.5px] font-bold text-ink">This is a gift in kind</div>
    <div class="mt-0.5 text-[12.5px] leading-tight text-muted">Goods or services rather than money. Counted as support, never as cash, and it needs a description of what was given.</div></div>
  </div>''')}</div>

  <div class="mb-4">{rail("contact", '''<div class="flex items-start gap-3">
    <span class="mt-0.5 h-[22px] w-[22px] flex-shrink-0 rounded-[6px] border-2 border-line"></span>
    <div class="min-w-0 flex-1"><div class="text-[14.5px] font-bold text-ink">Pay down a pledge</div>
    <div class="mt-0.5 text-[12.5px] leading-tight text-muted">Example Corp still owes $8,000 of a $12,000 promise. Linking this payment reduces what is outstanding instead of leaving it open.</div></div>
  </div>''')}</div>

  <button class="w-full rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Record it</button>
</main>
""")

# ---------------------------------------------------------------- 4 grants
SCREENS["grants"] = ("Grants", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Fundraising</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Grants</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">Built for when you start applying. Nothing here yet.</p>

  <div class="rounded-[12px] border-2 border-dashed border-line bg-paper px-4 py-8 text-center">
    <div class="text-[15px] font-extrabold text-ink">No grants tracked yet</div>
    <div class="mx-auto mt-2 max-w-[280px] text-[13px] leading-tight text-muted">
      A grant has a life before any money exists: researching, applied, waiting on a decision, then a report due months after the cheque clears. Those dates are the part that gets missed.
    </div>
  </div>

  <div class="mb-2 mt-5">{header("What it will look like", None, "target")}</div>
  <div class="flex flex-col gap-2 opacity-60">
    {rail("contact", f'''<div class="min-w-0">
      <div class="flex items-start justify-between gap-3">
        <div class="text-[14.5px] font-bold text-ink">Example Foundation</div>
        {chip("Applied", "contact")}
      </div>
      <div class="mt-1 text-[12.5px] leading-tight text-muted">$25,000 requested &middot; submitted 3 Aug &middot; decision expected Oct</div>
    </div>''')}
    {rail("committed", f'''<div class="min-w-0">
      <div class="flex items-start justify-between gap-3">
        <div class="text-[14.5px] font-bold text-ink">Sample Trust</div>
        {chip("Awarded", "committed")}
      </div>
      <div class="mt-1 text-[12.5px] leading-tight text-muted">$10,000 awarded &middot; report due 31 Jan</div>
    </div>''')}
  </div>

  <div class="mt-3">{note("Awarded money still arrives as an ordinary gift in the Foundation Grants category, linked back to the application, so an award is never counted both as a win and as revenue.", "contact")}</div>

  <div class="mt-5">
    <button class="w-full rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Track a grant</button>
  </div>
</main>
""")


# ---------------------------------------------------------------- 5 budget
_BUDGET_ROWS = "".join(
    '<div><label class="mb-1.5 block text-[12px] font-bold text-muted">' + c + '</label>'
    '<input value="$' + v + '" class="' + INPUT + ' tabular-nums" /></div>'
    for c, v in zip(CATEGORIES, ["60,000", "30,000", "45,000", "25,000", "25,000"])
)

_BUDGET_TOTAL = rail("contact",
    '<div class="flex items-center justify-between gap-3">'
    '<div class="text-[14.5px] font-bold text-ink">Total</div>'
    '<div class="text-[16px] font-extrabold tabular-nums text-ink">$185,000</div></div>')

SCREENS["budget"] = ("Set the budget", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Fundraising</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">2026 budget</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">The full-year target per category, as the board approved it. Everything on the overview is measured against these.</p>
  <div class="flex flex-col gap-3">{_BUDGET_ROWS}</div>
  <div class="mt-4">{_BUDGET_TOTAL}</div>
  <div class="mt-3">{note("Leave a category at zero and the overview says no target rather than showing it at 0%. Those are different statements and only one of them is a problem.", "contact")}</div>
  <div class="mt-5">
    <button class="w-full rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Save the budget</button>
  </div>
</main>
""")

# -------------------------------------------------------------- 6 campaign
SCREENS["campaign"] = ("New campaign", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Fundraising</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">New campaign</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">An event, an appeal, or anything with a goal and an end date.</p>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Name</label>
    <input value="Bridge Invitational" class="{INPUT}" />
  </div>
  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Kind</label>
    <input value="Event" class="{INPUT}" />
  </div>
  <div class="mb-4 grid grid-cols-2 gap-2">
    <div><label class="mb-1.5 block text-[12px] font-bold text-muted">Starts</label>
    <input value="2026-06-01" class="{INPUT} tabular-nums" /></div>
    <div><label class="mb-1.5 block text-[12px] font-bold text-muted">Ends</label>
    <input value="2026-08-13" class="{INPUT} tabular-nums" /></div>
  </div>
  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Goal</label>
    <input value="$25,000" class="{INPUT} tabular-nums" />
    <p class="mt-1 text-[12.5px] leading-tight text-muted">Measured against cash raised. Pledges show beside the bar, never inside it.</p>
  </div>
  <button class="w-full rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Create it</button>
</main>
""")

# ---------------------------------------------------------------- 7 pledge
SCREENS["pledge"] = ("Record a pledge", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Fundraising</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Record a pledge</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">Money promised. It will not count as raised until a payment against it actually arrives.</p>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Who promised it</label>
    <input value="Example Corp" class="{INPUT}" />
    <p class="mt-1 text-[12.5px] leading-tight text-muted">Required, unlike a gift. An anonymous promise is not one anybody can follow up on.</p>
  </div>
  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Amount</label>
    <input value="$12,000" class="{INPUT} text-[20px] font-bold tabular-nums" />
  </div>
  <div class="mb-4 grid grid-cols-2 gap-2">
    <div><label class="mb-1.5 block text-[12px] font-bold text-muted">Promised</label>
    <input value="2026-01-15" class="{INPUT} tabular-nums" /></div>
    <div><label class="mb-1.5 block text-[12px] font-bold text-muted">Due</label>
    <input value="2026-12-31" class="{INPUT} tabular-nums" /></div>
  </div>
  <div class="mb-4">{note("Leave the due date blank if none was given. It will show as outstanding and never as overdue, which is the honest reading.", "contact")}</div>
  <button class="w-full rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Record the pledge</button>
</main>
""")

# ----------------------------------------------------------- 8 track a grant
SCREENS["grantform"] = ("Track a grant", f"""
<main class="px-4 pt-2 pb-6">
  <div class="mb-4"><a href="#" class="text-[14.5px] font-bold text-muted">&larr; Grants</a></div>
  <h1 class="mb-1 text-[22px] font-extrabold text-ink">Track a grant</h1>
  <p class="mb-5 text-[13.5px] leading-tight text-muted">The application. Money arrives later as an ordinary gift in the Foundation Grants category.</p>

  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Funder</label>
    <input value="Example Foundation" class="{INPUT}" />
  </div>
  <div class="mb-4">
    <label class="mb-1.5 block text-[12px] font-bold text-muted">Where it stands</label>
    <input value="Researching" class="{INPUT}" />
  </div>
  <div class="mb-4 grid grid-cols-2 gap-2">
    <div><label class="mb-1.5 block text-[12px] font-bold text-muted">Requesting</label>
    <input value="$25,000" class="{INPUT} tabular-nums" /></div>
    <div><label class="mb-1.5 block text-[12px] font-bold text-muted">Deadline</label>
    <input value="2026-11-01" class="{INPUT} tabular-nums" /></div>
  </div>

  <div class="mb-2">{header("Dates that bite later", None, "time")}</div>
  <p class="mb-3 text-[13px] leading-tight text-muted">Most of a grant's life happens before any money exists, and these are the ones that get missed.</p>
  <div class="mb-4 grid grid-cols-2 gap-2">
    <div><label class="mb-1.5 block text-[12px] font-bold text-muted">Decision expected</label>
    <input placeholder="optional" class="{INPUT} tabular-nums" /></div>
    <div><label class="mb-1.5 block text-[12px] font-bold text-muted">Report due</label>
    <input placeholder="optional" class="{INPUT} tabular-nums" /></div>
  </div>
  <button class="w-full rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on">Track it</button>
</main>
""")


order = ["overview", "donors", "gift", "budget", "campaign", "pledge", "grants", "grantform"]
options = [f'<option value="{k}">{SCREENS[k][0]}</option>' for k in order]
blocks = [f'<div class="screen" data-screen="{k}" hidden><div class="phone">{SCREENS[k][1]}</div></div>' for k in order]

HTML = f"""<title>Fundraising Preview</title>
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

<h1 class="pg">Fundraising</h1>
<p class="lede">Eight screens at phone width, using the app's own compiled CSS and the locked catalog. Nothing here is built yet. React before I write it. Every name and figure is made up.</p>

<div class="controls">
  <select id="picker" onchange="show(this.value)">{"".join(options)}</select>
  <span class="hint">Mockup. Nothing here works.</span>
</div>

{"".join(blocks)}

<p class="note">
  <b>The model is yours, not a guess.</b> Your current BFFSA app already tracks donors, a
  transaction ledger and a P&amp;L with five revenue categories against a full-year budget. These
  screens use the same five rows with the same names, so a report out of this system reconciles
  against the one your board already sees.
  <br><br>
  <b>Three departures, each on purpose.</b> Lifetime totals are calculated from the gifts rather
  than stored on the donor, because a stored total drifts the first time a gift is corrected and
  nobody fixes it by hand. Pledges are their own thing, so no query can accidentally sum promises
  into "raised". Grants are tracked as applications with their own dates, since most of a grant's
  life happens before any money exists.
  <br><br>
  <b>Two rules the screens keep everywhere.</b> A pledge is never inside a total, only beside it.
  An in-kind gift is support and never cash, so a donated case of food does not tell your
  treasurer there is money to spend.
  <br><br>
  <b>Gated.</b> All of this sits behind <code>donor_fundraising</code>, which is off by default.
  Elite Squad will never see any of it.
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
show("overview");
</script>
"""

out = os.path.join(OUT_DIR, "fundraising_preview.html")
open(out, "w").write(HTML)
print(f"wrote {out} ({len(HTML)} bytes)")
