// The click-through prototype's application code.
//
// Every number on screen comes from window.Engines, which is the SHIPPED
// fit, NCAA, fundraising and governance code bundled by esbuild. Nothing
// here recomputes a GPA or a total; it renders what the real modules
// return. That is the difference between this and the static previews.

const E = window.Engines;

// ── State ────────────────────────────────────────────────────────────
const state = {
  org: "bridge",
  screen: "today",
  params: {},
  stack: [],
  toast: null,
  theme: "light",
};

const db = JSON.parse(JSON.stringify(DATA));
const TODAY = "2026-09-16";
const FISCAL_YEAR = 2026;

// ── Bug reports ──────────────────────────────────────────────────────
// Dave taps through this on a phone, so a bug he spots has to be one
// tap to record and has to carry its own context: which screen, which
// org, and what was actually on screen when he saw it. Typing all that
// on a phone is the reason bugs go unreported.
//
// They go to the artifact's own store when the page has one, so they
// reach me rather than sitting in his browser. When it does not (the
// capability is not granted, or the page is opened from a file), the
// same reports are kept in memory and shown with a copy button, so the
// feature degrades instead of disappearing.
const bugs = {
  store: null, // the db namespace, once resolved
  local: [], // always kept, so the list renders the same either way
  ready: false,
  sheetOpen: false,
  error: null,
};

async function initBugs() {
  try {
    if (typeof window.claude?.use !== "function") return;
    const store = await window.claude.use("db");
    if (!store) return;
    bugs.store = store;
    // Subscribed once, here, never from render.
    store
      .collection("bugs")
      .orderBy("at", "desc")
      .limit(100)
      .onSnapshot(
        (snap) => {
          bugs.local = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          bugs.ready = true;
          // More carries the count, so it has to repaint too when a
          // report arrives from another view of this prototype.
          if (state.screen === "bugs" || state.screen === "more") render();
        },
        () => {
          // A dead subscription is not worth a dialog. The in-memory
          // list still works.
          bugs.store = null;
        },
      );
  } catch {
    bugs.store = null;
  }
}

// What was on screen, captured automatically. This is the part worth
// having: "the GPA looks wrong" is hard to act on, the screen it was
// wrong on is not.
function captureContext() {
  const el = document.getElementById("screen");
  const seen = el ? el.innerText.replace(/\n{2,}/g, "\n").slice(0, 1200) : "";
  return {
    screen: state.screen,
    params: JSON.stringify(state.params || {}),
    org: state.org,
    at: new Date().toISOString(),
    seen,
  };
}

async function saveBug() {
  const noteEl = document.getElementById("bug_note");
  const note = noteEl ? noteEl.value.trim() : "";
  if (!note) {
    showError("bug-error", "What went wrong? A sentence is plenty.");
    return;
  }

  const report = { note, ...captureContext() };

  if (bugs.store) {
    try {
      await bugs.store.collection("bugs").add(report);
      bugs.sheetOpen = false;
      render();
      toast("Flagged. It will reach Claude with the screen you were on.");
      return;
    } catch (e) {
      // Fall through to the local list rather than losing what he typed.
      bugs.error = e && e.code === "quota_exceeded" ? "The report store is full." : null;
    }
  }

  bugs.local.unshift({ id: "local-" + Math.random().toString(36).slice(2, 8), ...report, localOnly: true });
  bugs.sheetOpen = false;
  render();
  toast("Flagged on this device. Open the Bugs list to copy it over.");
}

async function deleteBug(id) {
  const row = bugs.local.find((b) => b.id === id);
  if (bugs.store && row && !row.localOnly) {
    try {
      await bugs.store.collection("bugs").doc(id).delete();
    } catch {
      /* the snapshot will not change; the local removal below still applies */
    }
  }
  bugs.local = bugs.local.filter((b) => b.id !== id);
  render();
}

function openBugSheet() {
  bugs.sheetOpen = true;
  render();
  const el = document.getElementById("bug_note");
  if (el) el.focus();
}
function closeBugSheet() {
  bugs.sheetOpen = false;
  render();
}

function bugsAsText() {
  return bugs.local
    .map((b, i) => `${i + 1}. ${b.note}\n   screen: ${b.screen} ${b.params} \u00b7 org: ${b.org} \u00b7 ${b.at}`)
    .join("\n\n");
}

function copyBugs() {
  const text = bugsAsText();
  if (navigator.clipboard && text) {
    navigator.clipboard.writeText(text).then(
      () => toast("Copied. Paste it into the chat."),
      () => toast("Could not copy. Select the text below instead."),
    );
  }
}

function org() {
  return db.orgs[state.org];
}
function orgId() {
  return org().id;
}
function byOrg(list) {
  return list.filter((r) => r.orgId === orgId());
}
function athlete(id) {
  return db.athletes.find((a) => a.id === id);
}
function school(id) {
  return db.schools.find((s) => s.id === id);
}
function donor(id) {
  return db.donors.find((d) => d.id === id);
}

// ── Navigation ───────────────────────────────────────────────────────
function go(screen, params = {}) {
  state.stack.push({ screen: state.screen, params: state.params });
  state.screen = screen;
  state.params = params;
  render();
  window.scrollTo({ top: 0 });
}
function back() {
  const prev = state.stack.pop();
  if (prev) {
    state.screen = prev.screen;
    state.params = prev.params;
  } else {
    state.screen = "today";
    state.params = {};
  }
  render();
  window.scrollTo({ top: 0 });
}
function tab(screen) {
  state.stack = [];
  state.screen = screen;
  state.params = {};
  render();
  window.scrollTo({ top: 0 });
}
function switchOrg(slug) {
  state.org = slug;
  state.stack = [];
  state.screen = "today";
  state.params = {};
  render();
}
// One timer, cancelled and replaced. Without the cancel, the previous
// toast's timeout fires on its own schedule and clears whatever is on
// screen at that moment, so a second confirmation inside 3.2 seconds
// flashes and vanishes. Found by the walkthrough, which read an empty
// toast after an earlier action had set one.
let toastTimer = null;
function toast(message) {
  state.toast = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    state.toast = null;
    render();
  }, 3200);
  render();
}

// Light and dark, driven by one attribute. The app's own tokens key off
// [data-theme] in globals.css, and the prototype page frame keys off the
// same attribute, so one tap moves both rather than leaving a dark page
// wrapped around a light app.
function setTheme(next) {
  state.theme = next;
  document.documentElement.setAttribute("data-theme", next);
  render();
}
function toggleTheme() {
  setTheme(state.theme === "dark" ? "light" : "dark");
}

// ── Engine wrappers ──────────────────────────────────────────────────
// One place per engine, so no screen computes anything itself.

function fitFor(target) {
  const a = athlete(target.athleteId);
  const s = school(target.schoolId);
  if (!a || !s) return null;
  return E.scoreFit(a, s, {
    signals: {
      commCount: target.commCount || 0,
      visitCount: target.visitCount || 0,
      offer: target.offerType ? { type: target.offerType, scholarshipPercent: target.offerScholarshipPercent } : undefined,
    },
  });
}

function eligibilityFor(athleteId) {
  const a = athlete(athleteId);
  const courses = db.courses.filter((c) => c.athleteId === athleteId);
  const targets = byOrg(db.targets).filter((t) => t.athleteId === athleteId);

  // The strictest live target wins, because clearing D1 clears D2.
  const rank = { D1: 3, D2: 2, D3: 1 };
  let division = "";
  let best = 0;
  for (const t of targets) {
    const key = E.normalizeDivision(school(t.schoolId)?.division || "");
    if (key && rank[key] > best) {
      best = rank[key];
      division = key;
    }
  }

  const schoolNames = new Set(courses.map((c) => (c.school_name || "").toLowerCase()));
  const scales = db.gradingScales.filter((g) => schoolNames.has(g.school_name.toLowerCase()));
  const approvedLists = db.approvedLists.filter((l) => schoolNames.has(l.schoolName.toLowerCase()));

  return {
    division,
    view: E.buildEligibilityView({
      courses,
      scales,
      approvedLists,
      division,
      athlete: {
        dateOfBirth: a.dateOfBirth || null,
        firstFullTimeEnrollment: a.firstFullTimeEnrollment || null,
        intendedEnrollment: a.intendedEnrollment || null,
      },
      today: TODAY,
    }),
  };
}

function fundraising() {
  return E.summarizeFundraising({
    gifts: byOrg(db.gifts),
    pledges: byOrg(db.pledges),
    budget: db.budget,
    fiscalYear: FISCAL_YEAR,
    today: TODAY,
  });
}

function giveGetFor(memberId) {
  const m = byOrg(db.boardMembers).find((x) => x.id === memberId);
  if (!m) return null;
  const solicitedBy = {};
  for (const g of byOrg(db.gifts)) solicitedBy[g.id] = g.solicitedBy;
  const pledgeSolicitedBy = {};
  for (const p of byOrg(db.pledges)) pledgeSolicitedBy[p.id] = p.solicitedBy;
  return E.giveGetProgress({
    member: m,
    gifts: byOrg(db.gifts),
    pledges: byOrg(db.pledges),
    solicitedBy,
    pledgeSolicitedBy,
    periodStart: `${FISCAL_YEAR}-01-01`,
    periodEnd: `${FISCAL_YEAR}-12-31`,
  });
}

// The same input giveGetFor builds, handed to the shipped
// creditedGifts. The prototype used to filter the seat's gifts with its
// own one-line condition, which meant the list on the screen and the
// percentage above it were produced by two different rules.
function creditedFor(memberId) {
  const m = byOrg(db.boardMembers).find((x) => x.id === memberId);
  if (!m) return [];
  const solicitedBy = {};
  for (const g of byOrg(db.gifts)) solicitedBy[g.id] = g.solicitedBy;
  const pledgeSolicitedBy = {};
  for (const p of byOrg(db.pledges)) pledgeSolicitedBy[p.id] = p.solicitedBy;
  return E.creditedGifts({
    member: m,
    gifts: byOrg(db.gifts),
    pledges: byOrg(db.pledges),
    solicitedBy,
    pledgeSolicitedBy,
    periodStart: `${FISCAL_YEAR}-01-01`,
    periodEnd: `${FISCAL_YEAR}-12-31`,
  });
}

function boardSummary(boardId) {
  const b = byOrg(db.boards).find((x) => x.id === boardId);
  const members = byOrg(db.boardMembers).filter((m) => m.boardId === boardId);
  return E.summarizeBoard(b, members, members.map((m) => giveGetFor(m.id)).filter(Boolean));
}

// ── Rendering helpers ────────────────────────────────────────────────
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// The type glyph that replaced the left colour rail (Dave, 2026-09-16:
// "let's use icons like Jarvis does to identify categories instead of
// the color highlight"). The stripe only ever said status, so eight rows
// meant eight stripes and no clue what any of them was. The drawing says
// the kind, its colour keeps the status, and one glance now answers both.
// Size and stroke move together, as in RowGlyph: 2.0 at 20px is a
// 1.67px line where 1.75 at 18px was 1.31px, which is what made the old
// set read soft on a phone.
function glyph(kind, role = "neutral", size = 20) {
  const d = ICONS[kind];
  if (!d) return "";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    class="flex-shrink-0 ${FG[role]}" style="width:${size}px;height:${size}px">${d}</svg>`;
}

// The kind maps the prototype needs for the pills that are not a
// recruiting stage. STAGE_KIND itself is parsed out of statusHue.ts by
// the generator, so the stages cannot drift; these three are prototype
// surfaces that have no counterpart in the real app's shared maps yet.
const verdictKind = {
  early_academic_qualifier: "check",
  qualifier: "check",
  academic_redshirt: "warning",
  partial_qualifier: "warning",
  nonqualifier: "blocked",
  not_applicable: "note",
  insufficient_data: "note",
};
const SEAT_KIND = { prospect: "stage_target", active: "check", emeritus: "clock", resigned: "stage_none" };
function stageKindOf(label) {
  return STAGE_KIND[label] || "stage_none";
}

function rail(role, inner, onclick, kind) {
  const click = onclick ? ` onclick="${onclick}" style="cursor:pointer"` : "";
  // No kind given: keep the rail. Used by the few surfaces where the row
  // is a sentence rather than a record, and a glyph would be labelling
  // prose.
  if (!kind) return `<div class="min-h-[44px] rounded-[10px] border-l-[5px] bg-paper px-3.5 py-3 ${RAIL[role]}"${click}>${inner}</div>`;
  return `<div class="flex min-h-[44px] items-start gap-3 rounded-[10px] bg-paper px-3.5 py-3"${click}>
    <span class="mt-[1px]">${glyph(kind, role)}</span>
    <div class="min-w-0 flex-1">${inner}</div>
  </div>`;
}
// Both of these were coloured blocks. Dave, 2026-09-17: "make sure
// there's no color highlights on the pills, we said we were going with
// icons, make sure it's consistent throughout." So a pill is a glyph and
// a plain label, the same anatomy as the type mark on the row it sits
// on, and the hue moved from the background to the mark.
function pill(text, role, kind) {
  return `<span class="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-ink">${
    kind ? glyph(kind, role, 15) : ""
  }${esc(text)}</span>`;
}
function stagePill(status) {
  return pill(status, STATUS_ROLE[status] || "neutral", STAGE_KIND[status] || "stage_none");
}
function chip(text, role, kind) {
  return pill(text, role, kind);
}
function header(label, count, role = "accent", kind) {
  const c = count != null ? `<span class="text-[13px] font-extrabold tabular-nums text-ink">${count}</span>` : "";
  const lead = kind
    ? glyph(kind, role, 15)
    : `<span class="h-[7px] w-[7px] flex-shrink-0 rounded-full ${DOT[role]}"></span>`;
  return `<div class="flex items-center gap-2">${lead}
    <span class="text-[13px] font-extrabold uppercase tracking-[0.04em] text-muted">${esc(label)}</span>
    <span class="h-px flex-1 border-b-2 border-dotted border-line"></span>${c}</div>`;
}
function tile(label, value, sub, onclick) {
  const s = sub ? `<div class="mt-0.5 text-[11.5px] leading-tight text-muted">${esc(sub)}</div>` : "";
  const click = onclick ? ` onclick="${onclick}" style="cursor:pointer"` : "";
  return `<div class="rounded-[12px] bg-paper p-3.5"${click}>
    <div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">${esc(label)}</div>
    <div class="mt-1 text-[26px] font-black tabular-nums leading-tight text-ink">${esc(value)}</div>${s}</div>`;
}

// One horizontal strip instead of a stack of cards. Dave flagged the
// stacked scorecards twice: they took the whole first screen and did
// nothing when tapped. Every figure in here goes somewhere.
function statRow(items) {
  return `<div class="flex items-stretch overflow-hidden rounded-[12px] bg-paper">
    ${items
      .map(
        (it, i) =>
          `<div onclick="${it.go}" style="cursor:pointer"
            class="flex-1 px-2 py-3 text-center ${i ? "border-l border-line" : ""}">
            <div class="text-[22px] font-black tabular-nums leading-none text-ink">${esc(String(it.value))}</div>
            <div class="mt-1.5 text-[12px] font-bold uppercase tracking-[0.03em] text-muted">${esc(it.label)}</div>
          </div>`,
      )
      .join("")}
  </div>`;
}

// A row that reads as tappable. Everything in a list is one of these now,
// so nothing looks live and then does nothing.
function row(role, main, meta, right, onclick, kind) {
  return rail(
    role,
    `<div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[14.5px] font-bold leading-tight text-ink">${main}</div>
        ${meta ? `<div class="mt-0.5 text-[12.5px] leading-tight text-muted">${meta}</div>` : ""}
      </div>
      ${right || ""}
    </div>`,
    onclick,
    kind,
  );
}
function bar(pct, role) {
  const w = Math.min(100, Math.max(0, pct || 0));
  return `<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full ${DOT[role]}" style="width:${w}%"></div></div>`;
}
function backLink(label) {
  // -my-2 py-2 keeps the 44px touch target without adding 16px of space
  // above every screen title: the box grows, the layout does not.
  return `<div class="mb-2"><a onclick="back()"
    class="-my-2 inline-flex min-h-[44px] cursor-pointer items-center py-2 pr-3 text-[14.5px] font-bold text-muted">&larr; ${esc(label)}</a></div>`;
}
function button(label, onclick, kind = "primary") {
  const cls =
    kind === "primary"
      ? "bg-solid-accent text-solid-accent-on"
      : "bg-paper text-ink";
  return `<button onclick="${onclick}" class="w-full rounded-[8px] ${cls} py-3 text-center text-[15px] font-bold">${esc(label)}</button>`;
}
function emptyState(title, body) {
  return `<div class="rounded-[12px] border-2 border-dashed border-line bg-paper px-4 py-8 text-center">
    <div class="text-[15px] font-extrabold text-ink">${esc(title)}</div>
    <div class="mx-auto mt-2 max-w-[280px] text-[13px] leading-tight text-muted">${esc(body)}</div></div>`;
}
function field(label, inner, hint) {
  const h = hint ? `<p class="mt-1 text-[12.5px] leading-tight text-muted">${esc(hint)}</p>` : "";
  return `<div class="mb-4"><label class="mb-1.5 block text-[12px] font-bold text-muted">${esc(label)}</label>${inner}${h}</div>`;
}
const INPUT = "w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[15px] text-ink placeholder:text-muted";

function scoreRole(score) {
  return score >= 70 ? "high" : score >= 40 ? "mid" : "low";
}
function pctRole(pct) {
  if (pct == null) return "target";
  return pct >= 75 ? "committed" : "offer";
}
// Which glyph each fit dimension wears. The four rows on a target look
// identical otherwise, and three of them are about money, grades and
// ability, which are not the same thing.
const DIM_ICON = { academic: "course", athletic: "target", financial: "money", eligibility: "checklist" };

// STATUS_ROLE and STAGE_KIND come from statusHue.ts, parsed in by
// build_prototype.py. There used to be a hand-written copy of the first
// one right here, missing "Not Interested" and both athlete statuses,
// which is the drift this project keeps paying for. Removed 2026-09-17.
function money(cents) {
  return E.formatMoneyShort(cents);
}
function initials(name) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}
function avatar(name) {
  return `<span class="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-tint-neutral text-[13px] font-black text-tint-neutral-on">${esc(initials(name))}</span>`;
}
function daysSince(iso) {
  return Math.max(0, Math.round((new Date(TODAY) - new Date(iso)) / 86400000));
}

// ── Screens ──────────────────────────────────────────────────────────
const SCREENS = {};

SCREENS.today = () => {
  const targets = byOrg(db.targets);
  const roster = byOrg(db.athletes);
  const open = targets.filter((t) => ["Target", "In Contact", "Visit", "Offer"].includes(t.status));
  const stale = [...open].sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt)).slice(0, 3);
  const visits = targets.filter((t) => t.visitDate && t.visitDate >= TODAY).sort((a, b) => a.visitDate.localeCompare(b.visitDate));
  const f = org().modules.donor_fundraising ? fundraising() : null;

  const committed = targets.filter((t) => t.status === "Committed").length;
  const docsPending = byOrg(db.documents).filter((d) => d.status === "pending").length;

  return `
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Today</h1>
      <span class="text-[13px] font-bold text-muted">${esc(new Date(TODAY).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }))}</span>
    </div>

    ${statRow([
      { label: "Athletes", value: roster.length, go: "tab('athletes')" },
      { label: "Open", value: open.length, go: "tab('board')" },
      { label: "Committed", value: committed, go: "tab('board')" },
      { label: "Inbox", value: docsPending, go: "go('documents')" },
    ])}

    <div class="mb-2 mt-5">${header("Needs follow-up", stale.length, "offer", "clock")}</div>
    <div class="flex flex-col gap-2">
      ${stale
        .map((t) => {
          const a = athlete(t.athleteId);
          const s = school(t.schoolId);
          return row(
            "offer",
            esc(a.name),
            `${esc(s.name)} &middot; ${daysSince(t.updatedAt)}d quiet`,
            stagePill(t.status),
            `go('target',{id:'${t.id}'})`,
            "athlete",
          );
        })
        .join("")}
    </div>

    ${
      visits.length
        ? `<div class="mb-2 mt-5">${header("Upcoming visits", visits.length, "visit", "visit")}</div>
      <div class="flex flex-col gap-2">${visits
        .map((t) =>
          row(
            "visit",
            `${esc(athlete(t.athleteId).name)} at ${esc(school(t.schoolId).name)}`,
            esc(new Date(t.visitDate).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })),
            "",
            `go('target',{id:'${t.id}'})`,
            "visit",
          ),
        )
        .join("")}</div>`
        : ""
    }

    ${
      f
        ? `<div class="mb-2 mt-5">${header("Fundraising", null, "committed", "money")}</div>
      ${row(
        "committed",
        `${money(f.totalCashCents)} raised`,
        `${f.totalBudgetCents > 0 ? Math.round((f.totalCashCents / f.totalBudgetCents) * 100) + "% of target" : "No budget set"}${
          f.outstandingPledgeCents > 0 ? ` &middot; ${money(f.outstandingPledgeCents)} promised` : ""
        }`,
        "",
        "go('fundraising')",
        "money",
      )}`
        : ""
    }
  `;
};

SCREENS.athletes = () => {
  const roster = byOrg(db.athletes);
  return `
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Athletes</h1>
      <span class="text-[13px] font-bold text-muted">${roster.length}</span>
    </div>
    <div class="flex flex-col gap-2">
      ${roster
        .map((a) => {
          const ts = byOrg(db.targets).filter((t) => t.athleteId === a.id);
          const committed = ts.find((t) => t.status === "Committed");
          return rail(
            committed ? "committed" : "contact",
            `<div class="flex items-center gap-3">
              ${avatar(a.name)}
              <div class="min-w-0 flex-1">
                <div class="text-[14.5px] font-bold text-ink">${esc(a.name)}</div>
                <div class="text-[12.5px] text-muted">${esc(a.position)} &middot; ${ts.length} ${ts.length === 1 ? "school" : "schools"}</div>
              </div>
              ${committed ? stagePill("Committed") : ""}
            </div>`,
            `go('athlete',{id:'${a.id}'})`,
          );
        })
        .join("")}
    </div>
  `;
};

SCREENS.athlete = () => {
  const a = athlete(state.params.id);
  const ts = byOrg(db.targets).filter((t) => t.athleteId === a.id);
  const el = eligibilityFor(a.id);
  const docs = byOrg(db.documents).filter((d) => d.athleteId === a.id);

  const STAGES = ["Target", "In Contact", "Visit", "Offer", "Committed"];
  const reached = ts.length ? Math.max(...ts.map((t) => STAGES.indexOf(t.status))) : -1;

  return `
    ${backLink("Athletes")}
    <div class="mb-4 flex items-center gap-3">
      ${avatar(a.name)}
      <div class="min-w-0">
        <h1 class="text-[22px] font-extrabold text-ink">${esc(a.name)}</h1>
        <div class="text-[13.5px] text-muted">${esc(a.position)} &middot; ${esc(a.school)} &middot; ${a.recruitType === "transfer" ? "Transfer" : "Class of " + (a.detail.gradYear || "")}</div>
      </div>
    </div>

    <div class="mb-5 flex items-center gap-1">
      ${STAGES.map((s, i) => {
        const on = i <= reached;
        return `<div class="flex-1">
          <div class="h-1.5 rounded-full ${on ? DOT[STATUS_ROLE[s]] : "bg-line"}"></div>
          <div class="mt-1 text-[12px] font-bold ${on ? "text-ink" : "text-muted"}">${esc(s)}</div>
        </div>`;
      }).join("")}
    </div>

    <div class="mb-4 grid grid-cols-3 gap-2">
      ${tile("School GPA", a.gpa.toFixed(2), a.gpaVerified ? "verified" : "unverified", `go('courses',{id:'${a.id}'})`)}
      ${tile("NCAA core", el.view.eligibility.coreGpa?.gpa != null ? el.view.eligibility.coreGpa.gpa.toFixed(2) : "None", el.division ? "vs " + el.division : "no division", `go('eligibility',{id:'${a.id}'})`)}
      ${tile("Courses", String(db.courses.filter((c) => c.athleteId === a.id).length), "on file", `go('courses',{id:'${a.id}'})`)}
    </div>

    <div class="mb-5 grid grid-cols-2 gap-2">
      ${button("NCAA eligibility", `go('eligibility',{id:'${a.id}'})`, "secondary")}
      ${button("Transcript", `go('courses',{id:'${a.id}'})`, "secondary")}
    </div>

    <div class="mb-2">${header("Schools", ts.length, "contact", "school")}</div>
    <div class="flex flex-col gap-2">
      ${
        ts.length
          ? ts
              .map((t) => {
                const s = school(t.schoolId);
                const fit = fitFor(t);
                return rail(
                  STATUS_ROLE[t.status],
                  `<div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-[14.5px] font-bold text-ink">${esc(s.name)}</div>
                      <div class="text-[12.5px] text-muted">${esc(s.division)} &middot; ${esc(t.status)}</div>
                    </div>
                    <span class="text-[17px] font-black tabular-nums ${TEXT_ON[scoreRole(fit.score)]}">${esc(fit.tag)} ${fit.score}</span>
                  </div>`,
                  `go('target',{id:'${t.id}'})`,
                  "school",
                );
              })
              .join("")
          : emptyState("No schools yet", "Add a target and the fit score calculates itself.")
      }
    </div>

    ${
      docs.length
        ? `<div class="mb-2 mt-5">${header("Documents", docs.length, "place", "document")}</div>
      <div class="flex flex-col gap-2">${docs
        .map((d) => rail("place", `<div class="text-[14.5px] font-bold text-ink">${esc(d.fileName)}</div><div class="text-[12.5px] text-muted">${esc(d.category || "Unknown")}</div>`, `go('document',{id:'${d.id}'})`, "document"))
        .join("")}</div>`
        : ""
    }
  `;
};

SCREENS.eligibility = () => {
  const a = athlete(state.params.id);
  const { division, view } = eligibilityFor(a.id);
  const e = view.eligibility;
  const std = e.division ? E.DIVISION_STANDARDS[e.division] : null;

  const SUBJECT_LABEL = { english: "English", math: "Math", science: "Science", social_science: "Social science", other_academic: "Other academic" };
  const verdictRole = { qualifier: "high", early_academic_qualifier: "high", academic_redshirt: "mid", nonqualifier: "low", insufficient_data: "low", not_applicable: "low" };

  const headline =
    e.status === "not_applicable"
      ? "Division III sets its own academic standards on campus."
      : e.status === "insufficient_data"
        ? "Not enough on file to calculate this yet."
        : e.yearOne;

  return `
    ${backLink(a.name)}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${
      !division ? "No division to judge against" : division === "D3" ? "Division III" : `Division ${division === "D1" ? "I" : "II"} standard`
    }</div>

    <div class="mb-4 rounded-[16px] bg-paper p-4">
      <div class="mb-2">${chip(e.status.replace(/_/g, " "), verdictRole[e.status] || "low", verdictKind[e.status] || "note")}</div>
      <div class="text-[15px] font-bold leading-tight text-ink">${esc(headline)}</div>
    </div>

    ${
      e.status !== "not_applicable" && e.coreGpa?.gpa != null
        ? `<div class="mb-4 grid grid-cols-2 gap-2">
            ${tile("NCAA core", e.coreGpa.gpa.toFixed(2), std ? `needs ${std.qualifierGpa.toFixed(2)}` : "")}
            ${tile("Transcript", a.gpa.toFixed(2), "what the school reports")}
          </div>`
        : ""
    }

    ${(() => {
      // Five stacked paragraphs of caveat was the whole lower half of
      // this screen (Dave, 2026-09-16, with a screenshot of it). They are
      // all real and none can be dropped, so they collapse to one row
      // that opens its own page, which is where detail is welcome.
      // Placed under the verdict, because a caveat about a verdict
      // belongs next to it and not four sections later.
      const all = [...view.adapterWarnings, ...e.warnings];
      if (!all.length) return "";
      return `<div class="mb-2 mt-4">${header("Worth knowing", all.length, "offer", "warning")}</div>
        <div class="mb-1">${row(
          "offer",
          all.length === 1 ? "One caveat on this verdict" : `${all.length} caveats on this verdict`,
          "Tap to read them",
          "",
          `go('caveats',{id:'${a.id}'})`,
          "warning",
        )}</div>`;
    })()}

    ${
      view.schoolsMissingScale.length
        ? `<div class="mb-3">${rail(
            "offer",
            `<div class="text-[13.5px] font-bold leading-tight text-ink">${esc(view.schoolsMissingScale.join(" and "))} ${view.schoolsMissingScale.length > 1 ? "have" : "has"} no grading scale on file</div>
             <div class="-mb-2 mt-1 inline-flex min-h-[44px] cursor-pointer items-center pr-3 text-[13.5px] font-extrabold text-tint-accent-on" onclick="event.stopPropagation();go('scales')">Enter the grading scale</div>`,
          )}</div>`
        : ""
    }

    ${
      view.schoolsMissingApprovedList.length
        ? `<div class="mb-3">${rail(
            "offer",
            `<div class="text-[13.5px] font-bold leading-tight text-ink">${esc(view.schoolsMissingApprovedList.join(" and "))} ${
              view.schoolsMissingApprovedList.length > 1 ? "have" : "has"
            } no NCAA approved-course list on file</div>
             <div class="-mb-2 mt-1 inline-flex min-h-[44px] cursor-pointer items-center pr-3 text-[13.5px] font-extrabold text-tint-accent-on" onclick="event.stopPropagation();go('approvedLists')">Enter the approved list</div>`,
          )}</div>`
        : ""
    }

    ${
      view.approvals.length
        ? `<div class="mb-2 mt-4">${header("Against the approved list", null, "committed", "checklist")}</div>
           ${(() => {
             const by = (st) => view.approvals.filter((x) => x.match.status === st).length;
             const ok = by("approved");
             const no = by("not_approved");
             const un = by("unknown") + by("ambiguous");
             return row(
               un > 0 ? "offer" : "committed",
               un > 0 ? `${un} still unchecked` : `${ok} confirmed on the list`,
               `${ok} approved &middot; ${no} not approved${un > 0 ? " &middot; " + un + " unchecked" : ""}`,
               "",
               `go('approvals',{id:'${a.id}'})`,
               "checklist",
             );
           })()}`
        : ""
    }

    ${
      view.approvalNotes.length
        ? `<div class="mt-2 flex flex-col gap-2">${view.approvalNotes
            .map((n) => rail("target", `<div class="text-[13.5px] leading-tight text-ink">${esc(n)}</div>`, null, "note"))
            .join("")}</div>`
        : ""
    }

    ${
      view.scalesUsed.length
        ? `<div class="mb-2 mt-4">${header("How the grades were converted", null, "people", "scale")}</div>
           <div class="flex flex-col gap-2">${view.scalesUsed
             .map((s) =>
               rail(
                 s.origin === "verified" ? "contact" : s.origin === "org" ? "target" : "offer",
                 `<div class="text-[13.5px] leading-tight text-ink">${esc(s.school)} numbers converted ${
                   s.origin === "verified" ? "through a confirmed table" : s.origin === "org" ? "through a table your org entered" : "on an assumed ten-point scale"
                 }</div>${s.sourceNote ? `<div class="mt-1 text-[12.5px] leading-tight text-muted">"${esc(s.sourceNote)}"</div>` : ""}`,
                 null,
                 "scale",
               ),
             )
             .join("")}</div>`
        : ""
    }



    ${
      e.coreGpa && e.coreGpa.counted.length
        ? `<div class="mb-2 mt-5">${header("Core courses", e.coreGpa.counted.length, "committed", "course")}</div>
           <div class="flex flex-col gap-2">${Object.keys(SUBJECT_LABEL)
             .map((subject) => {
               const inSubject = e.coreGpa.counted.filter((c) => c.course.subject === subject);
               if (!inSubject.length) return "";
               const credits = inSubject.reduce((s, c) => s + c.course.credit, 0);
               const points = inSubject.reduce((s, c) => s + c.qualityPoints, 0);
               const min = std?.subjectMinimums[subject] ?? 0;
               return rail(
                 credits >= min ? "committed" : "offer",
                 `<div class="flex items-center justify-between gap-3">
                    <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">${SUBJECT_LABEL[subject]}</div>
                    <div class="text-[12.5px] text-muted">${credits.toFixed(2)} of ${min} credits</div></div>
                    <span class="text-[14.5px] font-extrabold tabular-nums text-ink">${(points / credits).toFixed(2)}</span>
                  </div>`,
                 null,
                 "course",
               );
             })
             .join("")}</div>`
        : ""
    }

    ${
      e.coreGpa && e.coreGpa.excluded.length
        ? `<div class="mb-2 mt-5">${header("Not counted", e.coreGpa.excluded.length, "target", "blocked")}</div>
           ${rail(
             "target",
             `<div class="text-[13.5px] leading-tight text-ink">${esc(e.coreGpa.excluded.map((x) => x.course.title).join(", "))}</div>
              <div class="mt-1 text-[12.5px] leading-tight text-muted">${esc(e.coreGpa.excluded[0].reason)}</div>`,
             null,
             "blocked",
           )}`
        : ""
    }

    ${
      view.ageClock.applies
        ? `<div class="mb-2 mt-5">${header("The clock", null, "time", "clock")}</div>
           <div class="flex flex-col gap-2">${view.ageClock.reasons
             .map((r) => rail("time", `<div class="text-[13.5px] leading-tight text-ink">${esc(r)}</div>`, null, "clock"))
             .join("")}</div>`
        : ""
    }

  `;
};

SCREENS.board = () => {
  const ts = byOrg(db.targets);
  const GROUPS = ["Target", "In Contact", "Visit", "Offer", "Committed"];
  return `
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Board</h1>
      <span class="text-[13px] font-bold text-muted">${ts.length}</span>
    </div>
    ${GROUPS.map((g) => {
      const inGroup = ts.filter((t) => t.status === g);
      if (!inGroup.length) return "";
      return `<div class="mb-2 mt-4">${header(g, inGroup.length, STATUS_ROLE[g])}</div>
        <div class="flex flex-col gap-2">${inGroup
          .map((t) => {
            const a = athlete(t.athleteId);
            const s = school(t.schoolId);
            const fit = fitFor(t);
            return rail(
              STATUS_ROLE[g],
              `<div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[14.5px] font-bold text-ink">${esc(a.name)}</div>
                  <div class="text-[12.5px] text-muted">${esc(s.name)} &middot; ${esc(s.division)}</div>
                </div>
                <span class="text-[17px] font-black tabular-nums ${TEXT_ON[scoreRole(fit.score)]}">${fit.score}</span>
              </div>`,
              `go('target',{id:'${t.id}'})`,
              "athlete",
            );
          })
          .join("")}</div>`;
    }).join("")}
  `;
};

SCREENS.target = () => {
  const t = byOrg(db.targets).find((x) => x.id === state.params.id);
  const a = athlete(t.athleteId);
  const s = school(t.schoolId);
  const fit = fitFor(t);
  const STAGES = ["Target", "In Contact", "Visit", "Offer", "Committed"];

  // One line per dimension, the score on the right. The reason text used
  // to sit under every one of these in grey; it is on the detail screen
  // now instead of four times over on this one.
  const dim = (label, d, key) =>
    d
      ? row(
          d.veto ? "offer" : scoreRole(d.score) === "high" ? "committed" : "contact",
          esc(label),
          "",
          `<span class="text-[15px] font-extrabold tabular-nums text-ink">${d.score}</span>`,
          `go('dimension',{id:'${t.id}',dim:'${key}'})`,
          DIM_ICON[key],
        )
      : "";

  return `
    ${backLink(a.name)}
    <div class="mb-4 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-[22px] font-extrabold leading-tight text-ink">${esc(s.name)}</h1>
        <div class="text-[13.5px] font-bold text-muted">${esc(s.division)} &middot; ${esc(a.name)}</div>
      </div>
      <div class="flex-shrink-0 text-right">
        <div class="text-[28px] font-black leading-none tabular-nums text-ink">${fit.score}</div>
        <div class="mt-1"><span class="text-[17px] font-black tabular-nums ${TEXT_ON[scoreRole(fit.score)]}">${esc(fit.tag)}</span></div>
      </div>
    </div>

    <div class="mb-2">${header("Stage", null, "accent")}</div>
    <div class="mb-5 flex flex-wrap gap-2">
      ${STAGES.map(
        (g) =>
          // A control, not a status read-out, so "chosen" has to be
          // visible without a colour block. A ring reads as selected and
          // keeps the stage's own hue on the glyph, where every other
          // stage mark in the app now carries it.
          `<button onclick="setStatus('${t.id}','${g}')" class="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-[13px] font-bold ${
            t.status === g ? "border-accent text-ink ring-2 ring-accent" : "border-line text-muted"
          }">${glyph(STAGE_KIND[g] || "stage_none", STATUS_ROLE[g] || "neutral", 15)}${esc(g)}</button>`,
      ).join("")}
    </div>

    <div class="mb-2">${header("How the score is built", null, "contact", "target")}</div>
    <div class="flex flex-col gap-2">
      ${dim("Academic", fit.academic, "academic")}
      ${dim("Athletic", fit.athletic, "athletic")}
      ${dim("Financial", fit.financial, "financial")}
      ${fit.eligibility ? dim("Eligibility", fit.eligibility, "eligibility") : ""}
    </div>

    ${
      fit.warnings.length
        ? `<div class="mt-3 flex flex-col gap-2">${fit.warnings.map((w) => rail("offer", `<div class="text-[13.5px] leading-tight text-ink">${esc(w)}</div>`)).join("")}</div>`
        : ""
    }

    <div class="mb-2 mt-5">${header("More", null, "people", "info")}</div>
    <div class="flex flex-col gap-2">
      ${row("place", esc(s.name), "", "", `go('school',{id:'${s.id}'})`, "school")}
      ${row("people", esc(t.coachName || "No coach on file"), `${t.commCount || 0} messages &middot; ${t.visitCount || 0} visits`, "", `go('comms',{id:'${t.id}'})`, "message")}
      ${row("contact", esc(a.name), "", "", `go('athlete',{id:'${a.id}'})`, "athlete")}
    </div>
  `;
};

// The reasons the engine gave, in full, on their own screen. They used to
// be four lines of grey under the four dimension rows.
SCREENS.dimension = () => {
  const t = byOrg(db.targets).find((x) => x.id === state.params.id);
  const fit = fitFor(t);
  const key = state.params.dim;
  const d = fit[key];
  const META = {
    academic: { label: "Academic", kind: "course", asks: "Can they get in, and stay in." },
    athletic: { label: "Athletic", kind: "target", asks: "Do the measurables reach this level of play." },
    financial: { label: "Financial", kind: "money", asks: "What this actually costs the family." },
    eligibility: { label: "Eligibility", kind: "checklist", asks: "Whether the NCAA lets them compete, and when." },
  };
  const CONF = {
    high: "Based on data specific to this school and this athlete.",
    medium: "Based on partial data. Some of it is a division default rather than this school's own numbers.",
    low: "Mostly division defaults. Treat the score as a starting point, not a finding.",
    unknown: "Not enough on file to judge. The score is a placeholder, not a measurement.",
  };
  const m = META[key] || { label: key, kind: "note", asks: "" };
  const role = d.veto ? "offer" : d.score >= 70 ? "committed" : d.score >= 40 ? "contact" : "target";

  return `
    ${backLink(school(t.schoolId).name)}
    <div class="mb-1 flex items-start justify-between gap-3">
      <h1 class="text-[22px] font-extrabold leading-tight text-ink">${esc(m.label)}</h1>
      <span class="flex-shrink-0 text-[28px] font-black leading-none tabular-nums ${TEXT_ON[scoreRole(d.score)]}">${d.score}</span>
    </div>
    <p class="mb-5 text-[13.5px] leading-tight text-muted">${esc(m.asks)} ${esc(athlete(t.athleteId).name)} at ${esc(school(t.schoolId).name)}.</p>

    ${
      d.veto
        ? `<div class="mb-5">${rail(
            "offer",
            `<div class="text-[14.5px] font-bold leading-tight text-ink">This one overrides the others</div>
             <div class="mt-1 text-[13px] leading-relaxed text-muted">A veto is not a low score averaged in with the rest. The overall fit was set by this dimension alone, because nothing the athlete does elsewhere gets past it.</div>`,
            null,
            "warning",
          )}</div>`
        : ""
    }

    <div class="mb-2">${header("Why", d.reasons.length, role, m.kind)}</div>
    <div class="flex flex-col gap-2">
      ${
        d.reasons.length
          ? d.reasons.map((r) => rail(role, `<div class="text-[13.5px] leading-relaxed text-ink">${esc(r)}</div>`)).join("")
          : emptyState("No reason given", "The engine returned a score without a stated reason, which normally means it had nothing specific to this school to work from.")
      }
    </div>

    ${
      d.warnings.length
        ? `<div class="mb-2 mt-5">${header("What could still change this", d.warnings.length, "offer", "warning")}</div>
           <div class="flex flex-col gap-2">${d.warnings
             .map((w) => rail("offer", `<div class="text-[13.5px] leading-relaxed text-ink">${esc(w)}</div>`, null, "warning"))
             .join("")}</div>`
        : ""
    }

    <div class="mb-2 mt-5">${header("How sure", null, "contact", "info")}</div>
    ${rail(
      "contact",
      `<div class="text-[14.5px] font-bold capitalize text-ink">${esc(String(d.confidence))}</div>
       <div class="mt-1 text-[13px] leading-relaxed text-muted">${esc(CONF[d.confidence] || "No confidence reported.")}</div>`,
      null,
      "info",
    )}
  `;
};

SCREENS.school = () => {
  const s = school(state.params.id);
  const here = byOrg(db.targets).filter((t) => t.schoolId === s.id);
  const fin = s.financials || {};
  const ac = s.academics || {};
  const at = s.athletics || {};
  const AID = { full: "Full scholarships available", partial: "Partial scholarships available", none: "No athletic aid, academic only" };
  const OUTLOOK = { realistic: "Realistic shot at playing time", competitive: "Competitive for playing time", difficult: "Difficult to break into" };
  // A D3 school never shows a scholarship claim, whatever the record
  // says. It is a law in the repo for the same reason it is a rule here:
  // printing the field tells a family money exists that does not.
  const d3 = /D3|DIVISION 3|DIVISION III/i.test(s.division || "");
  const cost = fin.outstateTotal || fin.instateTotal;
  const aid = d3 ? (fin.avgMeritAid || 0) + (fin.avgNeedAid || 0) : fin.avgAthleticAid || 0;
  const coverage = cost && aid ? Math.round((aid / cost) * 100) : null;
  const stale = s.profileDate ? Math.floor((new Date(TODAY) - new Date(s.profileDate)) / 86400000) : null;
  const dollars = (d) => "$" + Math.round(d).toLocaleString("en-US");

  return `
    ${backLink("Schools")}
    <h1 class="mb-1 text-[22px] font-extrabold leading-tight text-ink">${esc(s.name)}</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${esc(s.division)}${s.conference ? " &middot; " + esc(s.conference) : ""}</div>

    ${
      stale !== null && stale >= 90
        ? `<div class="mb-5">${rail(
            "offer",
            `<div class="text-[14.5px] font-bold leading-tight text-ink">This profile is ${stale} days old</div>
             <div class="mt-1 text-[13px] leading-relaxed text-muted">Every fit score against this school is built on the numbers below. Refresh them before anyone leans on one.</div>`,
            null,
            "warning",
          )}</div>`
        : ""
    }

    <div class="mb-5 grid grid-cols-3 gap-2">
      ${tile("Avg GPA", ac.gpaAvg != null ? ac.gpaAvg.toFixed(2) : "None", "admitted")}
      ${tile("Min GPA", ac.gpaMin != null ? ac.gpaMin.toFixed(2) : "None", "floor")}
      ${tile("Spots", fin.rosterSpotsOpen != null ? String(fin.rosterSpotsOpen) : "None", fin.rosterSpotsOpen != null ? "reported open" : "not reported")}
    </div>

    ${
      ac.satRange || ac.actRange
        ? `<div class="mb-5">${rail(
            "contact",
            `<div class="text-[13.5px] leading-relaxed text-ink">${[ac.satRange ? "SAT " + esc(ac.satRange) : "", ac.actRange ? "ACT " + esc(ac.actRange) : ""]
              .filter(Boolean)
              .join(" &middot; ")}</div>
             <div class="mt-0.5 text-[13px] leading-relaxed text-muted">The middle 50% of admitted students. Above the top number is a real advantage; below the bottom one is a real headwind.</div>`,
            null,
            "course",
          )}</div>`
        : ""
    }

    <div class="mb-2">${header("Money", null, "committed", "money")}</div>
    <div class="flex flex-col gap-2">
      ${rail(
        d3 ? "place" : "committed",
        `<div class="text-[14.5px] font-bold leading-tight text-ink">${
          d3 ? "No athletic scholarships at D3" : esc(AID[fin.athleticScholarship] || "Athletic aid not recorded")
        }</div>
         <div class="mt-0.5 text-[13px] leading-relaxed text-muted">${
           d3
             ? "NCAA rules, not this school's choice. Academic and need-based aid still apply and are often substantial."
             : "From this school's profile. Confirm with the coaching staff before a family plans around it."
         }</div>`,
        null,
        "money",
      )}
      ${
        aid
          ? rail(
              "committed",
              `<div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[14.5px] font-bold leading-tight text-ink">${d3 ? "Average academic and need aid" : "Average athletic award"}</div>
                  ${coverage !== null ? `<div class="mt-0.5 text-[13px] leading-relaxed text-muted">Covers about ${coverage}% of the cost of attendance.</div>` : ""}
                </div>
                <span class="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">${dollars(aid)}</span>
              </div>`,
              null,
              "grant",
            )
          : ""
      }
      ${
        fin.instateTotal
          ? row("contact", "In state", "", `<span class="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">${dollars(fin.instateTotal)}</span>`, null, "school")
          : ""
      }
      ${
        fin.outstateTotal
          ? row("contact", "Out of state", "", `<span class="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">${dollars(fin.outstateTotal)}</span>`, null, "school")
          : ""
      }
      ${
        !fin.instateTotal && !fin.outstateTotal
          ? rail("target", `<div class="text-[13.5px] leading-relaxed text-ink">No cost of attendance on file, so the financial dimension of every fit score here is running on defaults.</div>`)
          : ""
      }
    </div>

    ${
      at.positionDepth || at.playingTimeOutlook
        ? `<div class="mb-2 mt-5">${header("Depth chart", null, "visit", "athlete")}</div>
           ${rail(
             "visit",
             `${at.playingTimeOutlook ? `<div class="text-[14.5px] font-bold leading-tight text-ink">${esc(OUTLOOK[at.playingTimeOutlook] || at.playingTimeOutlook)}</div>` : ""}
              ${at.positionDepth ? `<div class="mt-1 text-[13.5px] leading-relaxed text-ink">${esc(at.positionDepth)}</div>` : ""}`,
             null,
             "athlete",
           )}`
        : ""
    }

    ${
      (s.conflicts || []).length
        ? `<div class="mb-2 mt-5">${header("Flags on this school", s.conflicts.length, "offer", "warning")}</div>
           <div class="flex flex-col gap-2">${s.conflicts
             .map((c) =>
               rail(
                 c.severity === "conflict" ? "offer" : "contact",
                 `<div class="text-[13.5px] leading-relaxed text-ink">${esc(c.message)}</div>`,
                 null,
                 c.severity === "conflict" ? "blocked" : "warning",
               ),
             )
             .join("")}</div>`
        : ""
    }

    <div class="mb-2 mt-5">${header("Your athletes here", here.length, "contact", "athlete")}</div>
    <div class="flex flex-col gap-2">
      ${
        here.length
          ? [...here]
              .sort((x, y) => fitFor(y).score - fitFor(x).score)
              .map((t) =>
                row(
                  STATUS_ROLE[t.status],
                  esc(athlete(t.athleteId).name),
                  esc(t.status),
                  `<span class="flex-shrink-0 text-[17px] font-black tabular-nums ${TEXT_ON[scoreRole(fitFor(t).score)]}">${fitFor(t).score}</span>`,
                  `go('target',{id:'${t.id}'})`,
                  "athlete",
                ),
              )
              .join("")
          : emptyState(
              "Nobody here yet",
              "No athlete on your roster is targeting this school. Adding one from their profile puts it on the board with a fit score.",
            )
      }
    </div>
  `;
};

// The contact log. The target screen used to show a count and stop
// there. The count is the part you cannot act on; the gap since the last
// one is the part you can. Visits are folded in with the calls and
// emails, because keeping them on a separate list is how they get
// forgotten.
SCREENS.comms = () => {
  const t = byOrg(db.targets).find((x) => x.id === state.params.id);
  const s = school(t.schoolId);
  const a = athlete(t.athleteId);
  const KIND = {
    call: { label: "Call", kind: "people", role: "contact" },
    text: { label: "Text", kind: "message", role: "contact" },
    email: { label: "Email", kind: "message", role: "contact" },
    visit: { label: "Visit (logged)", kind: "visit", role: "visit" },
    other: { label: "Contact", kind: "message", role: "contact" },
  };
  const VISIT = { official: "Official visit", unofficial: "Unofficial visit", junior_day: "Junior day", camp: "Camp", other: "Visit" };

  const entries = [
    ...db.communications
      .filter((c) => c.targetId === t.id)
      .map((c) => ({ at: c.at, detail: c.summary, ...(KIND[c.kind] || KIND.other) })),
    ...(db.visits || [])
      .filter((v) => v.targetId === t.id)
      .map((v) => ({ at: v.at, detail: v.impression || null, label: VISIT[v.visitType] || VISIT.other, kind: "visit", role: "visit" })),
  ];
  const dated = entries.filter((e) => e.at).sort((x, y) => y.at.localeCompare(x.at));
  const undated = entries.filter((e) => !e.at);
  const gap = dated.length ? Math.floor((new Date(TODAY) - new Date(dated[0].at)) / 86400000) : null;

  return `
    ${backLink(s.name)}
    <h1 class="mb-1 text-[22px] font-extrabold leading-tight text-ink">${esc(t.coachName || "Contact log")}</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${esc(s.name)} &middot; ${esc(a.name)}</div>

    ${
      gap !== null
        ? `<div class="mb-5">${rail(
            gap > 60 ? "offer" : "contact",
            `<div class="text-[14.5px] font-bold leading-tight text-ink">${
              gap === 0 ? "Last contact today" : gap === 1 ? "Last contact yesterday" : gap + " days since the last contact"
            }</div>
             <div class="mt-1 text-[13px] leading-relaxed text-muted">${entries.length} ${entries.length === 1 ? "entry" : "entries"} on file.${
               gap > 60 ? " A gap this long is usually worth a note rather than a wait." : ""
             }</div>`,
            null,
            gap > 60 ? "warning" : "clock",
          )}</div>`
        : ""
    }

    <div class="mb-2">${header("History", entries.length, "people", "people")}</div>
    <div class="flex flex-col gap-2">
      ${
        entries.length
          ? [...dated, ...undated]
              .map((e) =>
                rail(
                  e.role,
                  `<div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="text-[14.5px] font-bold leading-tight text-ink">${esc(e.label)}</div>
                      ${e.detail ? `<div class="mt-0.5 text-[13px] leading-relaxed text-muted">${esc(e.detail)}</div>` : ""}
                    </div>
                    <span class="flex-shrink-0 text-[12.5px] font-bold text-muted">${
                      e.at ? esc(new Date(e.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })) : "no date"
                    }</span>
                  </div>`,
                  null,
                  e.kind,
                ),
              )
              .join("")
          : emptyState(
              "Nothing logged",
              "No calls, emails or visits are recorded against this school yet. Logging them is also what moves the fit score: sustained contact and a completed visit both count as signals.",
            )
      }
    </div>
  `;
};

SCREENS.courses = () => {
  const a = athlete(state.params.id);
  const { view } = eligibilityFor(a.id);
  const e = view.eligibility;
  const counted = new Map((e.coreGpa?.counted || []).map((c) => [c.course.title + c.course.term, c]));
  const excluded = new Map((e.coreGpa?.excluded || []).map((x) => [x.course.title + x.course.term, x]));
  const all = db.courses.filter((c) => c.athleteId === a.id);
  const SUBJECT = { english: "English", math: "Math", science: "Science", social_science: "Social science", other_academic: "Other academic", elective: "Elective" };

  const byTerm = {};
  for (const c of all) (byTerm[c.term] = byTerm[c.term] || []).push(c);
  const terms = Object.keys(byTerm).sort().reverse();

  return `
    ${backLink(a.name)}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">Transcript</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${all.length} courses &middot; ${counted.size} counted by the NCAA</div>

    ${terms
      .map((term) => {
        const rows = byTerm[term];
        return `<div class="mb-2 mt-4">${header(term, rows.length, "contact")}</div>
          <div class="flex flex-col gap-2">${rows
            .map((c) => {
              const key = c.title + c.term;
              const hit = counted.get(key);
              const miss = excluded.get(key);
              return row(
                hit ? "committed" : miss ? "target" : "contact",
                esc(c.title),
                `${esc(SUBJECT[c.subject] || c.subject)} &middot; ${c.credit} credit${c.weighted ? " &middot; weighted" : ""}${
                  miss ? " &middot; " + esc(miss.reason) : ""
                }`,
                `<div class="flex-shrink-0 text-right">
                  <div class="text-[15px] font-extrabold tabular-nums text-ink">${esc(c.grade)}</div>
                  ${hit ? `<div class="text-[11.5px] font-bold text-muted">${hit.points.toFixed(1)} pts</div>` : ""}
                </div>`,
                `go('scaleEdit',{school:'${esc(c.school_name)}'})`,
              "course",
              );
            })
            .join("")}</div>`;
      })
      .join("")}
  `;
};

// Every course on this athlete's transcript against the school's
// approved list, with the reason each one got the answer it did. This is
// where "why is my core GPA lower than my transcript" is answered.
SCREENS.approvals = () => {
  const a = athlete(state.params.id);
  const { view } = eligibilityFor(a.id);
  const ROLE = { approved: "committed", not_approved: "target", ambiguous: "offer", unknown: "offer" };
  const LABEL = { approved: "On the list", not_approved: "Not on the list", ambiguous: "Two matches", unknown: "Unchecked" };

  const order = ["not_approved", "ambiguous", "unknown", "approved"];
  const grouped = order.map((st) => [st, view.approvals.filter((x) => x.match.status === st)]).filter(([, rows]) => rows.length);

  return `
    ${backLink(a.name)}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">Approved courses</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${view.approvals.length} courses checked</div>

    ${grouped
      .map(
        ([st, rows]) => `<div class="mb-2 mt-4">${header(LABEL[st], rows.length, ROLE[st])}</div>
        <div class="flex flex-col gap-2">${rows
          .map((x) =>
            row(
              ROLE[st],
              esc(x.title),
              st === "approved"
                ? `${esc(x.school)} &middot; ${x.match.how === "exact" ? "exact title" : "matched on the title"}`
                : st === "ambiguous"
                  ? `Could be ${esc((x.match.candidates || []).join(" or "))}`
                  : st === "not_approved"
                    ? `Does not count toward the core GPA`
                    : `No list on file for ${esc(x.school)}`,
              "",
              `go('approvedList',{school:'${esc(x.school)}'})`,
              { approved: "check", not_approved: "blocked", ambiguous: "warning", unknown: "note" }[st],
            ),
          )
          .join("")}</div>`,
      )
      .join("")}
  `;
};

SCREENS.approvedLists = () => {
  const courses = byOrg(db.athletes).flatMap((a) => db.courses.filter((c) => c.athleteId === a.id));
  const schools = [...new Set(courses.map((c) => c.school_name).filter(Boolean))];
  const listFor = (name) => db.approvedLists.find((l) => l.schoolName.toLowerCase() === name.toLowerCase());

  return `
    ${backLink("More")}
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Approved lists</h1>
      <span class="text-[13px] font-bold text-muted">${schools.length}</span>
    </div>

    <div class="flex flex-col gap-2">${schools
      .map((name) => {
        const l = listFor(name);
        return row(
          !l ? "offer" : l.isComplete ? "committed" : "target",
          esc(name),
          !l ? "Nothing on file" : `${l.courses.length} courses &middot; ${l.isComplete ? "complete" : "partial"}`,
          !l ? `<span class="flex-shrink-0 text-[13px] font-extrabold text-tint-accent-on">Add</span>` : "",
          `go('approvedList',{school:'${esc(name)}'})`,
          "checklist",
        );
      })
      .join("")}</div>
  `;
};

SCREENS.approvedList = () => {
  const name = state.params.school;
  const l = db.approvedLists.find((x) => x.schoolName.toLowerCase() === (name || "").toLowerCase());
  const SUBJECT = { english: "English", math: "Math", science: "Science", social_science: "Social science", other_academic: "Other academic" };

  if (!l) {
    return `
      ${backLink("Approved lists")}
      <h1 class="mb-1 text-[22px] font-extrabold leading-tight text-ink">${esc(name)}</h1>
      <div class="mb-5 text-[13.5px] font-bold text-muted">No approved list on file</div>
      ${emptyState(
        "Nothing to check against",
        "Every course at this school stays unchecked, and the core GPA reports itself as an estimate. The Eligibility Center publishes the list at web3.ncaa.org/hsportal.",
      )}
      <div class="mt-4">${button("Mark it partial and start typing", `toast('Entry is not built in this prototype yet.')`, "secondary")}</div>
    `;
  }

  const bySubject = {};
  for (const c of l.courses) (bySubject[c.subject] = bySubject[c.subject] || []).push(c);

  return `
    ${backLink("Approved lists")}
    <h1 class="mb-1 text-[22px] font-extrabold leading-tight text-ink">${esc(l.schoolName)}</h1>
    <div class="mb-4 text-[13.5px] font-bold text-muted">${l.courses.length} courses${l.ceebCode ? " &middot; CEEB " + esc(l.ceebCode) : ""}</div>

    <div class="mb-5">${rail(
      l.isComplete ? "committed" : "target",
      `<div class="text-[14.5px] font-bold leading-tight text-ink">${l.isComplete ? "Complete list" : "Partial list"}</div>
       <div class="mt-1 text-[13px] leading-tight text-muted">${
         l.isComplete
           ? "A course missing from it does not count."
           : "It can confirm a course. It never rules one out."
       }</div>
       ${l.sourceNote ? `<div class="mt-1.5 text-[12.5px] leading-tight text-muted">"${esc(l.sourceNote)}"</div>` : ""}`,
    )}</div>

    ${Object.keys(SUBJECT)
      .filter((k) => bySubject[k])
      .map(
        (k) => `<div class="mb-2 mt-4">${header(SUBJECT[k], bySubject[k].length, "contact")}</div>
        <div class="flex flex-col gap-2">${bySubject[k]
          .map((c) =>
            row(
              "contact",
              esc(c.title),
              [c.weighted ? "weighted" : "", c.maxCredit != null ? `capped at ${c.maxCredit}` : ""].filter(Boolean).join(" &middot; "),
              "",
            ),
          )
          .join("")}</div>`,
      )
      .join("")}
  `;
};

// The caveats, in full, on their own page. Dave, 2026-09-16: "Could also
// have a page that's very informative where it doesn't matter." This is
// that page. Nothing here is trimmed, because the reason it exists is so
// the screen it came off could be.
SCREENS.caveats = () => {
  const a = athlete(state.params.id);
  const { view } = eligibilityFor(a.id);
  const e = view.eligibility;
  // Two sources, deliberately kept apart in the data and joined only on
  // the screen. An adapter warning is about what the app could not read;
  // an eligibility warning is about the athlete's standing. They read as
  // one list and are cleared in completely different ways.
  const dataCaveats = view.adapterWarnings;
  const standing = e.warnings;
  const total = dataCaveats.length + standing.length;

  return `
    ${backLink("NCAA eligibility")}
    <h1 class="mb-1 text-[22px] font-extrabold leading-tight text-ink">Things to know</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${esc(a.name)} &middot; ${total} ${total === 1 ? "item" : "items"}</div>

    ${
      total === 0
        ? emptyState(
            "Nothing outstanding",
            "Every core course is matched to an approved list and every school has a grading scale on file. The verdict is built on real data rather than defaults.",
          )
        : `
      ${
        dataCaveats.length
          ? `<div class="mb-2">${header("What the app could not read", dataCaveats.length, "offer", "warning")}</div>
             <div class="flex flex-col gap-2">${dataCaveats
               .map((w) => rail("offer", `<div class="text-[13.5px] leading-relaxed text-ink">${esc(w)}</div>`, null, "warning"))
               .join("")}</div>
             <div class="mt-2">${rail(
               "contact",
               `<div class="text-[13px] leading-relaxed text-ink">These are gaps in what has been entered, not findings about the athlete. Each one is something the verdict is currently guessing at, and each one can be closed.</div>`,
               null,
               "info",
             )}</div>`
          : ""
      }
      ${
        standing.length
          ? `<div class="mb-2 mt-5">${header("About their standing", standing.length, "contact", "checklist")}</div>
             <div class="flex flex-col gap-2">${standing
               .map((w) => rail("contact", `<div class="text-[13.5px] leading-relaxed text-ink">${esc(w)}</div>`, null, "checklist"))
               .join("")}</div>`
          : ""
      }`
    }

    <div class="mb-2 mt-5">${header("What to do", null, "accent", "info")}</div>
    <div class="flex flex-col gap-2">
      ${
        view.schoolsMissingScale.length
          ? rail(
              "offer",
              `<div class="text-[14.5px] font-bold leading-tight text-ink">Enter a grading scale</div>
               <div class="mt-0.5 text-[13px] leading-relaxed text-muted">${esc(view.schoolsMissingScale.join(", "))}. Until then the core GPA assumes a ten-point scale, which is wrong at plenty of schools and wrong by enough to move a verdict.</div>`,
              "go('scales')",
              "scale",
            )
          : ""
      }
      ${
        view.schoolsMissingApprovedList.length
          ? rail(
              "offer",
              `<div class="text-[14.5px] font-bold leading-tight text-ink">Enter an approved course list</div>
               <div class="mt-0.5 text-[13px] leading-relaxed text-muted">${esc(view.schoolsMissingApprovedList.join(", "))}. Without one, no course can be confirmed as counting, so the core GPA is an estimate over everything on the transcript.</div>`,
              "go('approvedLists')",
              "checklist",
            )
          : ""
      }
      ${row("contact", "See the transcript", "Every course the core GPA counted, and every one it did not", "", `go('courses',{id:'${a.id}'})`, "course")}
    </div>

    <p class="mt-5 text-[13px] leading-relaxed text-muted">A projection until every core credit is final. Confirm with the NCAA Eligibility Center before anyone signs anything.</p>
  `;
};

// The one page where length is the point. Everything the app is quietly
// doing to a number, written out, so the screens themselves do not have
// to explain themselves in grey under every row.
SCREENS.guide = () => {
  const part = (kind, role, title, body) => `
    <div class="mb-2 mt-5">${header(title, null, role, kind)}</div>
    <div class="rounded-[10px] bg-paper px-3.5 py-3 text-[13.5px] leading-relaxed text-ink">${body}</div>`;

  return `
    ${backLink("More")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">How this works</h1>
    <div class="mb-1 text-[13.5px] font-bold text-muted">The rules behind every number on the other screens</div>

    ${part(
      "course",
      "committed",
      "Core GPA is not transcript GPA",
      `The NCAA recalculates. It counts only approved core courses, ignores plus and minus so A+, A and A- are all four points,
       and uses your best grades in the required subject areas rather than everything on the page.
       A 3.4 transcript and a 2.9 core GPA is normal, and the gap is the thing worth knowing about in sophomore year rather than June of senior year.`,
    )}

    ${part(
      "checklist",
      "visit",
      "The approved course list",
      `Each high school files a list with the Eligibility Center. A course on it counts. A course not on it does not, whatever it is called
       and whatever grade it earned. We hold two kinds of list: one transcribed in full from the NCAA portal, and a partial one somebody entered here.
       A complete list can say no. A partial list can only say yes, because a course missing from a half-typed list has not been ruled out, it has just not been typed yet.
       When a title could match two entries on the list, nothing is assumed: the course stays unchecked until a person says which it was.`,
    )}

    ${part(
      "scale",
      "contact",
      "Grading scales",
      `A school that prints numbers instead of letters needs its own conversion table, because an 89 is a B at one school and an A at another.
       The NCAA uses the school's published table, never a generic curve.
       With no table on file we fall back to the common ten-point scale so a number appears at all, and we label it as an assumption everywhere it shows.
       An assumed scale never earns the weighted bonus.`,
    )}

    ${part(
      "target",
      "accent",
      "The fit score",
      `Four dimensions, each scored on its own and blended: academic, athletic, financial, and eligibility where it applies.
       A veto in any one of them overrides the blend rather than averaging into it, so an athlete whose sport a school does not sponsor
       reads as a conflict no matter how strong the rest is. The score is calculated live and never stored, so it cannot go stale.`,
    )}

    ${part(
      "money",
      "committed",
      "A pledge is not revenue",
      `Money promised is not money received, so a pledge sits beside the raised total and never inside it.
       In-kind giving is counted as support, never as cash: a donated scoreboard is real and a treasurer cannot spend it.
       These are the two rules that make a board report quietly wrong, so they are enforced in the code rather than left to whoever builds the slide.`,
    )}

    ${part(
      "board",
      "people",
      "Give and get, both halves",
      `A board member meets their commitment by giving the money or by bringing it in. Most systems only record the first half.
       A gift counts once even when they did both. Only an active seat counts toward a board's total, because a prospect has not joined
       and an emeritus member is not on the hook, and counting either makes the board look further behind than it is.`,
    )}

    ${part(
      "org",
      "target",
      "One codebase, two organizations",
      `Switching organizations under More changes the roster, the role labels and which sections exist. Fundraising and the board are modules
       that are off by default; everything else is on for everyone. There is no branching on which organization it is, which is what makes
       a third one a row in a table rather than a rewrite.`,
    )}

    ${part(
      "info",
      "neutral",
      "What is invented here",
      `Every athlete, school, coach, donor and board member in this prototype is made up. No real person appears in it.
       The numbers are not: they are computed by the same code that will run in production, so changing a grading scale here moves a core GPA
       for the same reason it will move one later.`,
    )}
  `;
};

SCREENS.more = () => {
  const m = org().modules;
  const you = org().you;
  const label = org().roleLabels[you.role] || you.role;
  const item = (title, sub, screen, role, kind) =>
    rail(
      role,
      `<div class="text-[15px] font-semibold text-ink">${esc(title)}</div>${
        sub ? `<div class="text-[13px] text-muted">${esc(sub)}</div>` : ""
      }`,
      `tab('${screen}')`,
      kind,
    );

  return `
    <div class="mb-3">${header("More")}</div>
    <div class="flex flex-col gap-2">
      ${item("Documents", `${byOrg(db.documents).filter((d) => d.status === "pending").length} need review`, "documents", "place", "document")}
      ${m.donor_fundraising ? item("Fundraising", "Donors, gifts, pledges, grants", "fundraising", "committed", "money") : ""}
      ${m.board_governance ? item("Board", "Seats and give/get", "governance", "people", "board") : ""}
      ${item("Grading scales", `${db.gradingScales.length} on file`, "scales", "contact", "scale")}
      ${item("Approved lists", `${db.approvedLists.length} on file`, "approvedLists", "visit", "checklist")}
      ${item("Schools", `${db.schools.length}`, "schools", "place", "school")}
      ${item("How this works", "", "guide", "accent", "info")}
      ${item(
        bugs.local.length ? `Flagged bugs (${bugs.local.length})` : "Flagged bugs",
        "",
        "bugs",
        bugs.local.length ? "offer" : "neutral",
        "flag",
      )}
      ${rail("neutral", `<div class="text-[15px] font-semibold text-ink">${esc(you.name)}</div><div class="text-[13px] text-muted">${esc(label)} at ${esc(org().name)}</div>`, null, "athlete")}
    </div>

    <div class="mb-2 mt-5">${header("Switch organization", null, "target", "org")}</div>
    <div class="flex flex-col gap-2">
      ${Object.values(db.orgs)
        .map((o) =>
          rail(
            o.slug === state.org ? "committed" : "target",
            `<div class="flex items-center justify-between gap-3">
              <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">${esc(o.name)}</div>
              <div class="text-[12.5px] text-muted">${esc(o.roleLabels.staff)}s &middot; ${Object.entries(o.modules).filter(([, v]) => v).length} modules on</div></div>
              ${o.slug === state.org ? pill("Current", "committed", "check") : ""}
            </div>`,
            `switchOrg('${o.slug}')`,
            "org",
          ),
        )
        .join("")}
    </div>
  `;
};

SCREENS.schools = () => {
  const list = db.schools;
  const ts = byOrg(db.targets);
  return `
    ${backLink("More")}
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Schools</h1>
      <span class="text-[13px] font-bold text-muted">${list.length}</span>
    </div>
    <div class="flex flex-col gap-2">${list
      .map((s) => {
        const mine = ts.filter((t) => t.schoolId === s.id);
        return row(
          mine.length ? "contact" : "target",
          esc(s.name),
          `${esc(s.division)}${s.conference ? " &middot; " + esc(s.conference) : ""}`,
          mine.length ? chip(`${mine.length} here`, "contact", "athlete") : "",
          `go('school',{id:'${s.id}'})`,
          "school",
        );
      })
      .join("")}</div>
  `;
};

SCREENS.documents = () => {
  const docs = byOrg(db.documents);
  const pending = docs.filter((d) => d.status === "pending");
  const done = docs.filter((d) => d.status !== "pending");
  const STATUS = { applied: ["Applied", "committed"], pending: ["Needs review", "offer"], failed: ["Not used", "target"] };

  return `
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Documents</h1>
      <span class="text-[13px] font-bold text-muted">${docs.length}</span>
    </div>

    ${pending.length ? `<div class="mb-2">${header("Needs review", pending.length, "offer")}</div>
      <div class="mb-5 flex flex-col gap-2">${pending
        .map((d) => rail("offer", `<div class="text-[14.5px] font-bold text-ink">${esc(d.fileName)}</div><div class="text-[12.5px] text-muted">from ${esc(d.sourceRole)} &middot; ${Math.round(d.confidence * 100)}% confident</div>`, `go('document',{id:'${d.id}'})`, "document"))
        .join("")}</div>` : ""}

    <div class="mb-2">${header("Everything else", done.length, "contact")}</div>
    <div class="flex flex-col gap-2">${done
      .map((d) => {
        const [label, role] = STATUS[d.status];
        return rail(
          role,
          `<div class="flex items-center justify-between gap-3">
            <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">${esc(d.fileName)}</div>
            <div class="text-[12.5px] text-muted">${esc(d.athleteId ? athlete(d.athleteId).name : "Unmatched")} &middot; ${esc(d.createdAt)}</div></div>
            ${pill(label, role, stageKindOf(label))}
          </div>`,
          `go('document',{id:'${d.id}'})`,
          "document",
        );
      })
      .join("")}</div>
  `;
};

SCREENS.document = () => {
  const d = byOrg(db.documents).find((x) => x.id === state.params.id);
  return `
    ${backLink("Documents")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">${
      d.status === "failed" ? "Could not use this" : d.status === "pending" ? "Check this before it lands" : "Document read"
    }</h1>
    <p class="mb-4 text-[13.5px] text-muted">${esc(d.fileName)} &middot; from ${esc(d.sourceRole)}</p>

    ${rail("time", `<div class="text-[14.5px] font-bold text-ink">Simulated reading. No model is connected.</div>`)}

    ${
      d.failureReason
        ? `<div class="mt-4">${rail("target", `<div class="text-[13.5px] leading-tight text-ink">${esc(d.failureReason)}</div>`)}</div>`
        : ""
    }

    <div class="mb-2 mt-5">${header("Confidence", null, d.confidence >= 0.7 ? "committed" : "offer")}</div>
    ${rail(
      d.confidence >= 0.7 ? "committed" : "offer",
      `<div class="flex items-center justify-between gap-3">
        <div class="text-[14.5px] font-bold text-ink">${d.confidence >= 0.7 ? "High" : d.confidence >= 0.4 ? "Medium" : "Low"} confidence</div>
        <span class="text-[16px] font-extrabold tabular-nums text-ink">${Math.round(d.confidence * 100)}%</span>
      </div>${bar(d.confidence * 100, d.confidence >= 0.7 ? "committed" : "offer")}`,
    )}

    ${
      d.candidates
        ? `<div class="mb-2 mt-5">${header("Who is this?", d.candidates.length, "people")}</div>
           <div class="flex flex-col gap-2">${d.candidates
             .map((c) =>
               row(
                 "people",
                 esc(c.name),
                 "Tap to attach this document",
                 `<span class="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-muted">${Math.round(c.score * 100)}%</span>`,
                 `matchDocument('${d.id}','${c.athleteId}')`,
               ),
             )
             .join("")}</div>`
        : ""
    }

    ${
      d.athleteId
        ? `<div class="mt-5">${button("Open " + athlete(d.athleteId).name, `go('athlete',{id:'${d.athleteId}'})`, "secondary")}</div>`
        : ""
    }
  `;
};

SCREENS.scales = () => {
  const scales = db.gradingScales;
  const numericSchools = new Set(
    db.courses
      .filter((c) => byOrg(db.athletes).some((a) => a.id === c.athleteId))
      .filter((c) => /^\d{1,3}(\.\d+)?$/.test(String(c.grade).trim()))
      .map((c) => c.school_name),
  );
  const covered = new Set(scales.map((s) => s.school_name.toLowerCase()));
  const missing = [...numericSchools].filter((n) => !covered.has(n.toLowerCase()));

  return `
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Grading scales</h1>
      <span class="text-[13px] font-bold text-muted">${scales.length}</span>
    </div>

    ${
      missing.length
        ? `<div class="mb-2">${header("Needed now", missing.length, "offer")}</div>
           <div class="mb-5 flex flex-col gap-2">${missing
             .map((n) =>
               rail(
                 "offer",
                 `<div class="flex items-center justify-between gap-3">
                   <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">${esc(n)}</div>
                   <div class="text-[12.5px] text-muted">Running on the assumed ten-point scale</div></div>
                   <span class="text-[13px] font-extrabold text-tint-accent-on">Add</span>
                 </div>`,
                 `go('scaleEdit',{school:'${esc(n)}'})`,
                 "scale",
               ),
             )
             .join("")}</div>`
        : ""
    }

    <div class="mb-2">${header("On file", scales.length, "committed")}</div>
    <div class="flex flex-col gap-2">${scales
      .map((s) =>
        rail(
          "contact",
          `<div class="min-w-0">
            <div class="text-[14.5px] font-bold text-ink">${esc(s.school_name)}</div>
            <div class="mt-0.5 text-[12.5px] leading-tight text-muted">${esc(
              [...s.bands].sort((a, b) => b.min - a.min).map((b) => `${b.letter} ${b.min}-${b.max}`).join(" · "),
            )}</div>
            <div class="mt-1 text-[12.5px] leading-tight text-muted">${s.reports_weighted_grades ? `Weighted, adds ${s.weight_bonus.toFixed(2)}` : "No weighted bonus"} &middot; ${esc(s.source_note || "")}</div>
          </div>`,
          `go('scaleEdit',{school:'${esc(s.school_name)}'})`,
          "scale",
        ),
      )
      .join("")}</div>

  `;
};

SCREENS.scaleEdit = () => {
  const name = state.params.school;
  const existing = db.gradingScales.find((s) => s.school_name === name);
  const bands = existing ? existing.bands : E.TEN_POINT_STARTING_POINT;
  const rowFor = (letter) => bands.find((b) => b.letter.charAt(0) === letter) || { min: "", max: "" };

  return `
    ${backLink("Grading scales")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">${esc(name)}</h1>
    <div class="mb-3 text-[13.5px] font-bold text-muted">The table, as the school publishes it</div>
    <div class="mb-4 flex flex-col gap-2">
      ${["A", "B", "C", "D", "F"]
        .map((L) => {
          const r = rowFor(L);
          return `<div class="flex items-center gap-2">
            <span class="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[9px] bg-tint-contact text-[17px] font-black text-tint-contact-on">${L}</span>
            <input id="min_${L}" inputmode="numeric" value="${r.min}" class="${INPUT} text-center tabular-nums" />
            <span class="text-[14.5px] font-bold text-muted">to</span>
            <input id="max_${L}" inputmode="numeric" value="${r.max}" class="${INPUT} text-center tabular-nums" />
          </div>`;
        })
        .join("")}
    </div>

    ${field(
      "Weighted grades",
      `<label class="flex items-start gap-3 rounded-[10px] bg-paper px-3 py-2.5">
        <input type="checkbox" id="weighted" ${existing && existing.reports_weighted_grades ? "checked" : ""} class="mt-0.5 h-[18px] w-[18px] flex-shrink-0" />
        <span class="text-[14.5px] font-bold text-ink">The school is on record with the Eligibility Center as awarding weighted grades</span>
      </label>`,
    )}

    ${field("Bonus per weighted course", `<input id="bonus" inputmode="decimal" value="${existing ? existing.weight_bonus : "1.00"}" class="${INPUT} tabular-nums" />`, "The NCAA caps this at 1.00, and the cap is not the same as the amount.")}

    ${field("Where this came from", `<input id="sourceNote" value="${esc(existing ? existing.source_note : "")}" placeholder="Legend printed on page 2" class="${INPUT}" />`, "Required. This table governs every eligibility verdict at this school.")}

    <div id="scale-error" class="mb-3"></div>
    ${button("Save and recalculate", `saveScale('${esc(name)}')`)}
  `;
};

SCREENS.fundraising = () => {
  const f = fundraising();
  const campaigns = byOrg(db.campaigns);
  const budgetPct = f.totalBudgetCents > 0 ? Math.round((f.totalCashCents / f.totalBudgetCents) * 100) : null;

  return `
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Fundraising</h1>
      <span class="text-[13px] font-bold text-muted">${FISCAL_YEAR}</span>
    </div>

    ${statRow([
      { label: "Raised", value: money(f.totalCashCents), go: "go('gifts')" },
      { label: "Budget", value: money(f.totalBudgetCents), go: "go('gifts')" },
      { label: "Pledged", value: money(f.outstandingPledgeCents), go: "go('pledges')" },
      { label: "In kind", value: money(f.totalInKindCents), go: "go('gifts',{method:'in_kind'})" },
    ])}

    <div class="mb-2 mt-5">${header("By category", budgetPct == null ? null : budgetPct + "%", "committed", "money")}</div>
    <div class="flex flex-col gap-2">${f.byCategory
      .map((c) => {
        const role = pctRole(c.percentOfBudget);
        return rail(
          role,
          `<div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-3">
              <div class="text-[14.5px] font-bold text-ink">${esc(c.label)}</div>
              <span class="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">${c.percentOfBudget == null ? "no target" : c.percentOfBudget + "%"}</span>
            </div>
            <div class="mt-0.5 text-[12.5px] text-muted">${money(c.receivedCents)}${c.budgetCents > 0 ? " of " + money(c.budgetCents) : ""}${
              c.inKindCents > 0 ? " · " + money(c.inKindCents) + " in kind" : ""
            }</div>
            ${bar(c.percentOfBudget || 0, role)}
          </div>`,
          `go('gifts',{category:'${c.category}'})`,
          "money",
        );
      })
      .join("")}</div>

    ${
      campaigns.length
        ? `<div class="mb-2 mt-5">${header("Campaigns", campaigns.length, "visit", "campaign")}</div>
           <div class="flex flex-col gap-2">${campaigns
             .map((c) => {
               const p = E.campaignProgress(c.id, c.goalCents, byOrg(db.gifts), byOrg(db.pledges));
               const role = pctRole(p.percentOfGoal);
               return rail(
                 role,
                 `<div class="min-w-0">
                   <div class="flex items-center justify-between gap-3">
                     <div class="text-[14.5px] font-bold text-ink">${esc(c.name)}</div>
                     <span class="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">${p.percentOfGoal == null ? "no goal" : p.percentOfGoal + "%"}</span>
                   </div>
                   <div class="mt-0.5 text-[12.5px] text-muted">${money(p.raisedCents)} of ${money(p.goalCents)}${
                     p.pledgedCents > 0 ? " · " + money(p.pledgedCents) + " pledged" : ""
                   }</div>
                   ${bar(p.percentOfGoal || 0, role)}
                 </div>`,
                 `go('campaign',{id:'${c.id}'})`,
                 "campaign",
               );
             })
             .join("")}</div>`
        : ""
    }

    <div class="mb-2 mt-5">${header("Go to", null, "contact", "info")}</div>
    <div class="flex flex-col gap-2">
      ${row("committed", "Donors", `${f.donorCount}`, "", "go('donors')", "donor")}
      ${row("contact", "All gifts", `${f.giftCount} this year`, "", "go('gifts')", "money")}
      ${row("offer", "Pledges", `${money(f.outstandingPledgeCents)} outstanding`, "", "go('pledges')", "pledge")}
      ${row("place", "Grants", `${byOrg(db.grants).length}`, "", "go('grants')", "grant")}
    </div>

    <div class="mt-5">${button("Record a gift", "go('giftNew')")}</div>
  `;
};

SCREENS.gifts = () => {
  const all = byOrg(db.gifts).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
  const cat = state.params.category || null;
  const method = state.params.method || null;
  const rows = all.filter((g) => (!cat || g.category === cat) && (!method || g.method === method));
  const label = cat ? E.CATEGORY_LABEL[cat] : method === "in_kind" ? "In kind" : "All gifts";
  const cash = rows.filter((g) => g.method !== "in_kind").reduce((s, g) => s + g.amountCents, 0);

  return `
    ${backLink("Fundraising")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">${esc(label)}</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${rows.length} gifts &middot; ${money(cash)} cash</div>

    <div class="flex flex-col gap-2">${
      rows.length
        ? rows
            .map((g) =>
              row(
                g.method === "in_kind" ? "place" : "committed",
                esc(g.donorId ? donor(g.donorId).name : "Anonymous"),
                `${esc(new Date(g.receivedOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }))} &middot; ${esc(
                  g.method === "in_kind" ? "in kind" : g.method,
                )}${g.campaignId ? " &middot; " + esc(byOrg(db.campaigns).find((c) => c.id === g.campaignId).name) : ""}`,
                `<span class="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">${E.formatMoney(g.amountCents)}</span>`,
                g.donorId ? `go('donor',{id:'${g.donorId}'})` : null,
                g.method === "in_kind" ? "grant" : "money",
              ),
            )
            .join("")
        : emptyState("Nothing here", "No gift matches this filter yet.")
    }</div>
  `;
};

SCREENS.pledges = () => {
  const rows = byOrg(db.pledges).sort((a, b) => (a.dueOn || "").localeCompare(b.dueOn || ""));
  return `
    ${backLink("Fundraising")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">Pledges</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">Promised, not received. None of this is in the raised figure.</div>

    <div class="flex flex-col gap-2">${
      rows.length
        ? rows
            .map((p) => {
              const outstanding = E.outstandingOn(p, byOrg(db.gifts));
              const overdue = p.dueOn && p.dueOn < TODAY && outstanding > 0;
              return row(
                outstanding === 0 ? "committed" : overdue ? "offer" : "target",
                esc(p.donorId ? donor(p.donorId).name : "Anonymous"),
                `${E.formatMoney(p.amountCents)} promised${p.dueOn ? " &middot; due " + esc(new Date(p.dueOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })) : ""}${
                  overdue ? " &middot; overdue" : ""
                }`,
                `<span class="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">${outstanding === 0 ? "Paid" : E.formatMoney(outstanding)}</span>`,
                p.donorId ? `go('donor',{id:'${p.donorId}'})` : null,
                "pledge",
              );
            })
            .join("")
        : emptyState("No pledges", "Nothing promised and unpaid.")
    }</div>
  `;
};

SCREENS.grants = () => {
  const rows = byOrg(db.grants);
  const ROLE = { awarded: "committed", submitted: "visit", researching: "target", declined: "offer" };
  return `
    ${backLink("Fundraising")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">Grants</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${rows.length} tracked</div>

    <div class="flex flex-col gap-2">${
      rows.length
        ? rows
            .map((g) =>
              row(
                ROLE[g.status] || "target",
                esc(g.funderName),
                `${esc(g.status)}${g.deadlineOn ? " &middot; due " + esc(new Date(g.deadlineOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })) : ""}`,
                `<div class="flex-shrink-0 text-right">
                  <div class="text-[15px] font-extrabold tabular-nums text-ink">${E.formatMoney(g.amountAwarded ?? g.amountRequested)}</div>
                  <div class="text-[11.5px] font-bold text-muted">${g.amountAwarded ? "awarded" : "requested"}</div>
                </div>`,
                null,
                "grant",
              ),
            )
            .join("")
        : emptyState("No grants", "Nothing tracked yet.")
    }</div>
  `;
};

SCREENS.campaign = () => {
  const c = byOrg(db.campaigns).find((x) => x.id === state.params.id);
  const p = E.campaignProgress(c.id, c.goalCents, byOrg(db.gifts), byOrg(db.pledges));
  const gifts = byOrg(db.gifts).filter((g) => g.campaignId === c.id).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
  const role = pctRole(p.percentOfGoal);

  return `
    ${backLink("Fundraising")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">${esc(c.name)}</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${esc(c.kind)}${c.endsOn ? " &middot; ends " + esc(new Date(c.endsOn).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })) : ""}</div>

    <div class="mb-5">${rail(
      role,
      `<div class="flex items-start justify-between gap-3">
        <div class="text-[16px] font-extrabold tabular-nums text-ink">${money(p.raisedCents)} of ${money(p.goalCents)}</div>
        <span class="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">${p.percentOfGoal == null ? "no goal" : p.percentOfGoal + "%"}</span>
      </div>
      ${bar(p.percentOfGoal || 0, role)}`,
    )}</div>

    <div class="mb-2">${header("Gifts", gifts.length, "committed", "money")}</div>
    <div class="flex flex-col gap-2">${
      gifts.length
        ? gifts
            .map((g) =>
              row(
                g.method === "in_kind" ? "place" : "committed",
                esc(g.donorId ? donor(g.donorId).name : "Anonymous"),
                esc(new Date(g.receivedOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })),
                `<span class="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">${E.formatMoney(g.amountCents)}</span>`,
                g.donorId ? `go('donor',{id:'${g.donorId}'})` : null,
                "money",
              ),
            )
            .join("")
        : emptyState("No gifts yet", "Nothing has come in against this campaign.")
    }</div>
  `;
};

SCREENS.donor = () => {
  const d = donor(state.params.id);
  const totals = E.donorTotals(d.id, byOrg(db.gifts), byOrg(db.pledges), FISCAL_YEAR);
  const gifts = byOrg(db.gifts).filter((g) => g.donorId === d.id).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
  const pledges = byOrg(db.pledges).filter((p) => p.donorId === d.id);
  const seat = byOrg(db.boardMembers).find((m) => m.donorId === d.id);

  return `
    ${backLink("Donors")}
    <h1 class="mb-1 text-[22px] font-extrabold leading-tight text-ink">${esc(d.name)}</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${esc(d.donor_type.replace(/_/g, " "))}${d.email ? " &middot; " + esc(d.email) : ""}</div>

    ${statRow([
      { label: "Lifetime", value: money(totals.lifetimeCashCents), go: "" },
      { label: "This year", value: money(totals.thisYearCashCents), go: "" },
      { label: "Gifts", value: totals.giftCount, go: "" },
    ])}

    ${
      seat
        ? `<div class="mt-5">${row("people", esc(seat.name) + " sits on a board", esc(seat.roleTitle || seat.status), "", `go('member',{id:'${seat.id}'})`)}</div>`
        : ""
    }

    ${
      pledges.length
        ? `<div class="mb-2 mt-5">${header("Pledges", pledges.length, "offer")}</div>
           <div class="flex flex-col gap-2">${pledges
             .map((p) => {
               const out = E.outstandingOn(p, byOrg(db.gifts));
               return row(
                 out > 0 ? "offer" : "committed",
                 E.formatMoney(p.amountCents) + " promised",
                 p.dueOn ? "due " + esc(new Date(p.dueOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })) : "",
                 `<span class="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">${out === 0 ? "Paid" : E.formatMoney(out) + " left"}</span>`,
               );
             })
             .join("")}</div>`
        : ""
    }

    <div class="mb-2 mt-5">${header("Gifts", gifts.length, "committed")}</div>
    <div class="flex flex-col gap-2">${
      gifts.length
        ? gifts
            .map((g) =>
              row(
                g.method === "in_kind" ? "place" : "committed",
                esc(E.CATEGORY_LABEL[g.category] || g.category),
                `${esc(new Date(g.receivedOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }))} &middot; ${esc(g.method === "in_kind" ? "in kind" : g.method)}`,
                `<span class="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">${E.formatMoney(g.amountCents)}</span>`,
              ),
            )
            .join("")
        : emptyState("No gifts yet", "This supporter has not given.")
    }</div>
  `;
};

SCREENS.member = () => {
  const m = byOrg(db.boardMembers).find((x) => x.id === state.params.id);
  const b = byOrg(db.boards).find((x) => x.id === m.boardId);
  const p = giveGetFor(m.id);
  const credited = creditedFor(m.id);
  const role = m.status === "active" ? pctRole(p.percent) : "target";

  return `
    ${backLink(b.name)}
    <h1 class="mb-1 text-[22px] font-extrabold leading-tight text-ink">${esc(m.name)}</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${esc(m.roleTitle || "No role set")} &middot; ${esc(m.status)}</div>

    ${statRow([
      { label: "Given", value: money(p.givenCents), go: m.donorId ? `go('donor',{id:'${m.donorId}'})` : "" },
      { label: "Brought in", value: money(p.raisedCents), go: "" },
      { label: "Committed", value: money(p.commitmentCents), go: "" },
    ])}

    ${
      m.status === "active"
        ? `<div class="mt-4">${rail(
            role,
            `<div class="flex items-start justify-between gap-3">
              <div class="text-[14.5px] font-bold text-ink">${p.met ? "Commitment met" : "Still short"}</div>
              <span class="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">${p.percent == null ? "no target" : p.percent + "%"}</span>
            </div>
            ${bar(p.percent || 0, role)}`,
          )}</div>`
        : ""
    }

    ${
      m.termStart
        ? `<div class="mb-2 mt-5">${header("Term", null, "time")}</div>
           ${row("time", esc(m.termStart) + " to " + esc(m.termEnd || "open"), "")}`
        : ""
    }

    <div class="mb-2 mt-5">${header("Gifts on this seat", credited.length, "committed", "money")}</div>
    <div class="flex flex-col gap-2">${
      credited.length
        ? credited
            .map((c) => {
              const g = c.gift;
              const note = c.excludedBecause === "in_kind"
                ? "Not counted. In kind, so it does not count toward a cash commitment."
                : c.excludedBecause === "outside_period"
                  ? "Not counted. Outside this year, so it counts toward the year it was received."
                  : "";
              const meta = `${esc(new Date(g.receivedOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }))} &middot; ${esc(
                g.donorId ? donor(g.donorId).name : "Anonymous",
              )}${note ? "<br>" + esc(note) : ""}`;
              return row(
                !c.counted ? "target" : c.credit === "given" ? "committed" : "visit",
                c.credit === "given" ? "Given" : "Brought in",
                meta,
                `<span class="flex-shrink-0 text-[15px] font-extrabold tabular-nums ${c.counted ? "text-ink" : "text-muted"}">${E.formatMoney(g.amountCents)}</span>`,
                g.donorId ? `go('donor',{id:'${g.donorId}'})` : null,
                c.credit === "given" ? "money" : "people",
              );
            })
            .join("")
        : emptyState("Nothing credited", "No gift is recorded against this seat yet.")
    }</div>
  `;
};

SCREENS.donors = () => {
  const rows = byOrg(db.donors)
    .map((d) => ({ donor: d, totals: E.donorTotals(d.id, byOrg(db.gifts), byOrg(db.pledges), FISCAL_YEAR) }))
    .sort((a, b) => b.totals.lifetimeCashCents - a.totals.lifetimeCashCents);
  const owing = rows.filter((r) => r.totals.outstandingPledgeCents > 0);

  return `
    ${backLink("Fundraising")}
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Donors</h1>
      <span class="text-[13px] font-bold text-muted">${rows.length}</span>
    </div>

    ${
      owing.length
        ? `<div class="mb-2">${header("Owes a pledge", owing.length, "target", "pledge")}</div>
           <div class="mb-5 flex flex-col gap-2">${owing
             .map((r) =>
               row(
                 "target",
                 esc(r.donor.name),
                 "",
                 `<span class="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">${E.formatMoney(r.totals.outstandingPledgeCents)}</span>`,
                 `go('donor',{id:'${r.donor.id}'})`,
                 "pledge",
               ),
             )
             .join("")}</div>`
        : ""
    }

    <div class="mb-2">${header("All donors", rows.length, "contact", "donor")}</div>
    <div class="flex flex-col gap-2">${rows
      .map(({ donor, totals }) =>
        row(
          "contact",
          esc(donor.name),
          `${totals.giftCount} ${totals.giftCount === 1 ? "gift" : "gifts"} &middot; ${esc(donor.donor_type.replace(/_/g, " "))}`,
          `<div class="flex-shrink-0 text-right">
            <div class="text-[14.5px] font-extrabold tabular-nums ${totals.lifetimeCashCents === 0 ? "text-muted" : "text-ink"}">${money(totals.lifetimeCashCents)}</div>
            ${totals.lifetimeInKindCents > 0 ? `<div class="text-[11.5px] text-muted">${money(totals.lifetimeInKindCents)} in kind</div>` : ""}
          </div>`,
          `go('donor',{id:'${donor.id}'})`,
          "donor",
        ),
      )
      .join("")}</div>
  `;
};

SCREENS.giftNew = () => {
  const donors = byOrg(db.donors);
  const campaigns = byOrg(db.campaigns);
  const members = org().modules.board_governance ? byOrg(db.boardMembers).filter((m) => m.status === "active") : [];

  return `
    ${backLink("Fundraising")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">Record a gift</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">Money that has actually arrived</div>

    ${field("Amount", `<input id="g_amount" inputmode="decimal" placeholder="$0.00" class="${INPUT} text-[20px] font-bold tabular-nums" />`)}
    ${field(
      "Donor",
      `<select id="g_donor" class="${INPUT}"><option value="">Anonymous</option>${donors.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select>`,
    )}
    ${field("Received", `<input id="g_date" type="date" value="${TODAY}" class="${INPUT} tabular-nums" />`)}
    ${field(
      "How",
      `<select id="g_method" class="${INPUT}">${["check", "stripe", "cash", "in_kind", "other"].map((m) => `<option value="${m}">${m === "in_kind" ? "In kind" : m[0].toUpperCase() + m.slice(1)}</option>`).join("")}</select>`,
    )}
    ${field(
      "Category",
      `<select id="g_category" class="${INPUT}">${E.GIFT_CATEGORIES.map((c) => `<option value="${c}">${esc(E.CATEGORY_LABEL[c])}</option>`).join("")}</select>`,
    )}
    ${field(
      "Campaign",
      `<select id="g_campaign" class="${INPUT}"><option value="">None</option>${campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>`,
    )}
    ${
      members.length
        ? field(
            "Brought in by",
            `<select id="g_solicited" class="${INPUT}"><option value="">Nobody in particular</option>${members
              .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`)
              .join("")}</select>`,
          )
        : ""
    }

    <div id="gift-error" class="mb-3"></div>
    ${button("Record it", "saveGift()")}
  `;
};

SCREENS.governance = () => {
  const boards = byOrg(db.boards);
  const totals = boards.reduce(
    (acc, b) => {
      const s = boardSummary(b.id);
      return { committed: acc.committed + s.committedCents, raised: acc.raised + s.raisedCents, seats: acc.seats + s.seatsFilled, meeting: acc.meeting + s.membersMeeting };
    },
    { committed: 0, raised: 0, seats: 0, meeting: 0 },
  );
  const pct = totals.committed > 0 ? Math.round((totals.raised / totals.committed) * 100) : null;

  return `
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Board</h1>
      <span class="text-[13px] font-bold text-muted">${FISCAL_YEAR}</span>
    </div>

    ${statRow([
      { label: "Committed", value: money(totals.committed), go: "go('members')" },
      { label: "Delivered", value: money(totals.raised), go: "go('members')" },
      { label: "Seats met", value: `${totals.meeting}/${totals.seats}`, go: "go('members')" },
      { label: "Percent", value: pct == null ? "None" : pct + "%", go: "go('members')" },
    ])}

    <div class="mb-2 mt-5">${header("Boards", boards.length, "committed", "board")}</div>
    <div class="flex flex-col gap-2">${boards
      .map((b) => {
        const s = boardSummary(b.id);
        const role = pctRole(s.percent);
        return rail(
          role,
          `<div class="min-w-0">
            <div class="flex items-start justify-between gap-3">
              <div class="text-[14.5px] font-bold text-ink">${esc(b.name)}</div>
              <span class="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">${s.percent == null ? "no target" : s.percent + "%"}</span>
            </div>
            <div class="mt-0.5 text-[12.5px] text-muted">${money(b.giveGetCents)} give/get &middot; ${s.seatsFilled} of ${b.maxSeats} seats</div>
            ${s.belowMinimum ? `<div class="mt-0.5 text-[12.5px] leading-tight text-muted">Below the floor of ${b.minSeats} seats.</div>` : ""}
            ${bar(s.percent || 0, role)}
          </div>`,
          `go('boardDetail',{id:'${b.id}'})`,
          "board",
        );
      })
      .join("")}</div>

    <div class="mt-5">${button("Every seat", "go('members')", "secondary")}</div>
  `;
};

SCREENS.boardDetail = () => {
  const b = byOrg(db.boards).find((x) => x.id === state.params.id);
  const s = boardSummary(b.id);
  const members = byOrg(db.boardMembers).filter((m) => m.boardId === b.id);
  const rank = { active: 0, prospect: 1, emeritus: 2, resigned: 3 };
  const ordered = [...members].sort((a, c) => rank[a.status] - rank[c.status] || a.name.localeCompare(c.name));
  const role = pctRole(s.percent);

  return `
    ${backLink("Board")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">${esc(b.name)}</h1>
    <div class="mb-5 text-[13.5px] font-bold text-muted">${money(b.giveGetCents)} give/get per seat</div>

    <div class="mb-4">${rail(
      role,
      `<div class="min-w-0">
        <div class="flex items-start justify-between gap-3">
          <div class="text-[14.5px] font-bold text-ink">${money(s.raisedCents)} of ${money(s.committedCents)}</div>
          <span class="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">${s.percent == null ? "no target" : s.percent + "%"}</span>
        </div>
        <div class="mt-0.5 text-[12.5px] text-muted">${s.seatsFilled} filled &middot; ${s.seatsOpen} open &middot; ${s.membersMeeting} of ${s.seatsFilled} fully met</div>
        ${bar(s.percent || 0, role)}
      </div>`,
    )}</div>

    <div class="mb-2">${header("Seats", ordered.length, "contact", "people")}</div>
    <div class="flex flex-col gap-2">${ordered
      .map((m) => {
        const p = giveGetFor(m.id);
        const mRole = m.status === "active" ? pctRole(p.percent) : "target";
        return rail(
          mRole,
          `<div class="min-w-0">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0"><div class="text-[14.5px] font-bold text-ink">${esc(m.name)}</div>
              <div class="mt-0.5 text-[12.5px] text-muted">${esc(m.roleTitle || "No role set")}</div></div>
              ${m.status === "active" ? `<span class="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">${p.percent == null ? "no target" : p.percent + "%"}</span>` : chip(m.status, "neutral", SEAT_KIND[m.status])}
            </div>
            ${
              m.status === "active"
                ? `<div class="mt-1.5 text-[12.5px] text-muted">${money(p.givenCents)} given &middot; ${money(p.raisedCents)} brought in</div>
                   ${bar(p.percent || 0, mRole)}`
                : ""
            }
          </div>`,
          `go('member',{id:'${m.id}'})`,
          "people",
        );
      })
      .join("")}</div>
  `;
};

// Every seat on every board in one list, which is what the give/get
// numbers on the overview are actually made of.
SCREENS.members = () => {
  const members = byOrg(db.boardMembers);
  const rank = { active: 0, prospect: 1, emeritus: 2, resigned: 3 };
  const ordered = [...members].sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));

  return `
    ${backLink("Board")}
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h1 class="text-[22px] font-extrabold text-ink">Every seat</h1>
      <span class="text-[13px] font-bold text-muted">${ordered.length}</span>
    </div>

    <div class="flex flex-col gap-2">${ordered
      .map((m) => {
        const p = giveGetFor(m.id);
        const b = byOrg(db.boards).find((x) => x.id === m.boardId);
        const mRole = m.status === "active" ? pctRole(p.percent) : "target";
        return row(
          mRole,
          esc(m.name),
          `${esc(b.name)}${m.roleTitle ? " &middot; " + esc(m.roleTitle) : ""}`,
          m.status === "active"
            ? `<span class="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">${p.percent == null ? "no target" : p.percent + "%"}</span>`
            : chip(m.status, "neutral", SEAT_KIND[m.status]),
          `go('member',{id:'${m.id}'})`,
          "people",
        );
      })
      .join("")}</div>
  `;
};

SCREENS.bugs = () => {
  const list = bugs.local;
  const anyLocalOnly = list.some((b) => b.localOnly) || !bugs.store;

  return `
    ${backLink("More")}
    <h1 class="mb-1 text-[22px] font-extrabold text-ink">Flagged bugs</h1>
    <p class="mb-5 text-[13.5px] leading-tight text-muted">${
      bugs.store
        ? "Saved with this prototype, so they reach Claude without you copying anything."
        : "Saved on this device only, because this copy of the prototype has no report store. Copy them over when you are done."
    }</p>

    ${
      list.length === 0
        ? emptyState("Nothing flagged yet", "Tap the flag button on any screen when something looks wrong. It records the screen you were on, so you only have to describe the problem.")
        : `<div class="flex flex-col gap-2">${list
            .map(
              (b) => `<div class="rounded-[10px] border-l-[5px] bg-paper px-3.5 py-3 ${RAIL.offer}">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-[14.5px] font-bold leading-tight text-ink">${esc(b.note)}</div>
                    <div class="mt-1 text-[12.5px] leading-tight text-muted">${esc(b.screen)}${
                      b.params && b.params !== "{}" ? " " + esc(b.params) : ""
                    } &middot; ${esc(b.org)} &middot; ${esc(new Date(b.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</div>
                    ${b.fixed ? `<div class="mt-1.5">${chip("fixed: " + b.fixed, "committed", "check")}</div>` : ""}
                    ${b.localOnly ? `<div class="mt-1.5">${chip("this device only", "target", "warning")}</div>` : ""}
                  </div>
                  <button onclick="deleteBug('${b.id}')" class="flex-shrink-0 text-[12.5px] font-bold text-muted">Remove</button>
                </div>
              </div>`,
            )
            .join("")}</div>`
    }

    ${
      list.length && anyLocalOnly
        ? `<div class="mt-5">${button("Copy them all", "copyBugs()", "secondary")}</div>
           <div class="mt-3 rounded-[10px] bg-paper px-3.5 py-3">
             <div class="text-[12px] leading-relaxed text-muted" style="white-space:pre-wrap">${esc(bugsAsText())}</div>
           </div>`
        : ""
    }
  `;
};

// ── Actions ──────────────────────────────────────────────────────────
function setStatus(targetId, status) {
  const t = db.targets.find((x) => x.id === targetId);
  t.status = status;
  t.updatedAt = TODAY;
  // Moving to Offer without an offer record is the common real mistake,
  // so the prototype models a stage change the way the app does: the
  // pipeline stage and the offer record are separate things.
  if (status === "Offer" && !t.offerType) {
    t.offerType = "athletic";
    t.offerScholarshipPercent = 25;
  }
  render();
}

function saveScale(name) {
  const bands = [];
  for (const L of ["A", "B", "C", "D", "F"]) {
    const min = document.getElementById("min_" + L).value.trim();
    const max = document.getElementById("max_" + L).value.trim();
    if (min === "" && max === "") continue;
    if (min === "" || max === "") {
      showError("scale-error", `The ${L} band needs both a low and a high number.`);
      return;
    }
    bands.push({ letter: L, min: Number(min), max: Number(max) });
  }

  // The real checker from the shipped module, not a copy.
  const problem = E.gradingScaleProblem(bands);
  if (problem) {
    showError("scale-error", "That table cannot be right: " + problem);
    return;
  }

  const note = document.getElementById("sourceNote").value.trim();
  if (!note) {
    showError("scale-error", "Say where these numbers came from.");
    return;
  }

  const existing = db.gradingScales.find((s) => s.school_name === name);
  // Named entry, not row: row() is the shared list-row renderer now.
  const entry = {
    school_name: name,
    bands,
    reports_weighted_grades: document.getElementById("weighted").checked,
    weighting_is_class_rank_only: false,
    weight_bonus: Number(document.getElementById("bonus").value) || 0,
    origin: "org",
    source_note: note,
  };
  if (existing) Object.assign(existing, entry);
  else db.gradingScales.push(entry);

  back();
  toast("Saved. Every athlete at " + name + " recalculated.");
}

function saveGift() {
  const raw = document.getElementById("g_amount").value.trim();
  const cents = E.toCents(raw);
  if (raw === "" || cents === 0) {
    showError("gift-error", raw === "" ? "How much was it?" : "A gift cannot be zero.");
    return;
  }
  const method = document.getElementById("g_method").value;
  const solicitedEl = document.getElementById("g_solicited");

  db.gifts.push({
    id: "gf-" + Math.random().toString(36).slice(2, 8),
    orgId: orgId(),
    amountCents: cents,
    receivedOn: document.getElementById("g_date").value || TODAY,
    category: document.getElementById("g_category").value,
    method,
    donorId: document.getElementById("g_donor").value || null,
    campaignId: document.getElementById("g_campaign").value || null,
    pledgeId: null,
    solicitedBy: solicitedEl ? solicitedEl.value || null : null,
  });

  back();
  toast(
    method === "in_kind"
      ? `${E.formatMoney(cents)} recorded as in-kind support, not cash.`
      : `${E.formatMoney(cents)} recorded. Totals recalculated.`,
  );
}

// Attaching a pending document to the athlete it belongs to. The
// candidate list used to render a match percentage and do nothing.
function matchDocument(docId, athleteId) {
  const d = byOrg(db.documents).find((x) => x.id === docId);
  if (!d) return;
  d.athleteId = athleteId;
  d.status = "applied";
  d.route = "manual_apply";
  delete d.candidates;
  render();
  toast("Attached to " + athlete(athleteId).name + ".");
}

function showError(id, message) {
  document.getElementById(id).innerHTML = `<div class="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[14.5px] font-semibold text-danger">${esc(message)}</div>`;
}

// ── Shell ────────────────────────────────────────────────────────────
const TABS = [
  { key: "today", label: "Today" },
  { key: "athletes", label: "Athletes" },
  { key: "board", label: "Board" },
  { key: "more", label: "More" },
];

// The flag button sits above the tab bar on every screen, and the sheet
// it opens shows the context it is about to record, so nothing is
// captured invisibly.
function bugLayer() {
  const ctx = bugs.sheetOpen ? captureContext() : null;

  const fab = `<button id="flagbtn" onclick="openBugSheet()" aria-label="Flag a bug"
    class="flex h-[44px] items-center gap-2 rounded-full bg-solid-danger px-4 text-[13.5px] font-bold text-solid-danger-on shadow-lg">
    <span aria-hidden="true">&#9873;</span> Flag a bug</button>`;

  if (!bugs.sheetOpen) return `<div class="flagwrap">${fab}</div>`;

  return `<div class="sheetbackdrop" onclick="closeBugSheet()"></div>
    <div class="sheet">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div class="text-[16px] font-extrabold text-ink">Flag a bug</div>
        <button onclick="closeBugSheet()" class="text-[13.5px] font-bold text-muted">Cancel</button>
      </div>
      <textarea id="bug_note" rows="3" placeholder="What looks wrong?" class="${INPUT}"></textarea>
      <div id="bug-error" class="mt-2"></div>
      <div class="mt-3 rounded-[10px] bg-bg px-3 py-2.5">
        <div class="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">Recorded with it</div>
        <div class="mt-1 text-[12.5px] leading-tight text-muted">${esc(ctx.screen)}${
          ctx.params !== "{}" ? " " + esc(ctx.params) : ""
        } &middot; ${esc(db.orgs[ctx.org].shortName)} &middot; what is on screen right now</div>
      </div>
      <div class="mt-3">${button("Flag it", "saveBug()")}</div>
      <p class="mt-2 text-[12px] leading-relaxed text-muted">${
        bugs.store
          ? "Goes straight to Claude with the screen you were on, so you do not have to describe where you were."
          : "Kept on this device. The Bugs list under More has a copy button."
      }</p>
    </div>`;
}

// Which tab lights up on a screen that is not itself a tab. Listed by
// tab rather than by screen, so adding a screen means adding it to one
// list instead of remembering a fallthrough.
const TAB_OF = {
  athletes: ["athlete", "eligibility", "courses", "approvals", "caveats"],
  board: ["target", "dimension", "school", "comms"],
  more: [
    "fundraising", "donors", "donor", "gifts", "pledges", "grants", "campaign", "giftNew",
    "governance", "boardDetail", "member", "members",
    "documents", "document", "scales", "scaleEdit", "schools", "bugs",
    "approvedLists", "approvedList", "guide",
  ],
};

function render() {
  const body = SCREENS[state.screen] ? SCREENS[state.screen]() : `<div class="p-8 text-center text-muted">Not built in this prototype.</div>`;
  const activeTab = ["today", "athletes", "board", "more"].includes(state.screen)
    ? state.screen
    : Object.keys(TAB_OF).find((k) => TAB_OF[k].includes(state.screen)) || "today";

  document.getElementById("screen").innerHTML = `<main class="px-4 pt-3 pb-24">${body}</main>`;

  document.getElementById("tabbar").innerHTML = TABS.map(
    (t) =>
      `<button onclick="tab('${t.key}')" class="flex-1 py-2 text-[11.5px] font-bold ${
        activeTab === t.key ? "text-tint-accent-on" : "text-muted"
      }">${t.label}</button>`,
  ).join("");

  document.getElementById("buglayer").innerHTML = bugLayer();
  document.getElementById("orgbadge").innerHTML = `<span class="text-[11.5px] font-extrabold uppercase tracking-[0.04em] text-muted">${esc(org().shortName)}</span>
    <button onclick="toggleTheme()" aria-label="Switch theme" id="themebtn"
      class="ml-2 rounded-full bg-paper px-2.5 py-1 text-[12px] font-bold text-ink">${state.theme === "dark" ? "Dark" : "Light"}</button>`;
  document.getElementById("toast").innerHTML = state.toast
    ? `<div class="mx-auto mb-2 w-fit max-w-[340px] rounded-full bg-ink px-4 py-2 text-center text-[13px] font-bold text-paper">${esc(state.toast)}</div>`
    : "";
}

window.openBugSheet = openBugSheet;
window.closeBugSheet = closeBugSheet;
window.saveBug = saveBug;
window.deleteBug = deleteBug;
window.copyBugs = copyBugs;
window.go = go;
window.back = back;
window.tab = tab;
window.switchOrg = switchOrg;
window.setStatus = setStatus;
window.saveScale = saveScale;
window.toggleTheme = toggleTheme;
window.matchDocument = matchDocument;
window.saveGift = saveGift;

setTheme(state.theme);
initBugs();
