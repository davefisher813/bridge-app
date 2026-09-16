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
function toast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = null;
    render();
  }, 3200);
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

  return {
    division,
    view: E.buildEligibilityView({
      courses,
      scales,
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

function boardSummary(boardId) {
  const b = byOrg(db.boards).find((x) => x.id === boardId);
  const members = byOrg(db.boardMembers).filter((m) => m.boardId === boardId);
  return E.summarizeBoard(b, members, members.map((m) => giveGetFor(m.id)).filter(Boolean));
}

// ── Rendering helpers ────────────────────────────────────────────────
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function rail(role, inner, onclick) {
  const click = onclick ? ` onclick="${onclick}" style="cursor:pointer"` : "";
  return `<div class="rounded-[10px] border-l-[5px] bg-paper px-3.5 py-3 ${RAIL[role]}"${click}>${inner}</div>`;
}
function pill(text, role) {
  return `<span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-bold ${SOLID[role]}">${esc(text)}</span>`;
}
function chip(text, role) {
  return `<span class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${TINT[role]}">${esc(text)}</span>`;
}
function header(label, count, role = "accent") {
  const c = count != null ? `<span class="text-[12px] font-extrabold tabular-nums text-ink">${count}</span>` : "";
  return `<div class="flex items-center gap-2">
    <span class="h-[7px] w-[7px] flex-shrink-0 rounded-full ${DOT[role]}"></span>
    <span class="text-[12px] font-extrabold uppercase tracking-[0.04em] text-muted">${esc(label)}</span>
    <span class="h-px flex-1 border-b-2 border-dotted border-line"></span>${c}</div>`;
}
function tile(label, value, sub) {
  const s = sub ? `<div class="mt-0.5 text-[10.5px] leading-tight text-muted">${esc(sub)}</div>` : "";
  return `<div class="rounded-[12px] bg-paper p-3.5">
    <div class="text-[10.5px] font-bold uppercase tracking-[0.03em] text-muted">${esc(label)}</div>
    <div class="mt-1 text-[24px] font-black tabular-nums leading-tight text-ink">${esc(value)}</div>${s}</div>`;
}
function bar(pct, role) {
  const w = Math.min(100, Math.max(0, pct || 0));
  return `<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div class="h-full rounded-full ${DOT[role]}" style="width:${w}%"></div></div>`;
}
function backLink(label) {
  return `<div class="mb-4"><a onclick="back()" class="cursor-pointer text-[13px] font-bold text-muted">&larr; ${esc(label)}</a></div>`;
}
function button(label, onclick, kind = "primary") {
  const cls =
    kind === "primary"
      ? "bg-solid-accent text-solid-accent-on"
      : "bg-paper text-ink";
  return `<button onclick="${onclick}" class="w-full rounded-[8px] ${cls} py-3 text-center text-[14px] font-bold">${esc(label)}</button>`;
}
function emptyState(title, body) {
  return `<div class="rounded-[12px] border-2 border-dashed border-line bg-paper px-4 py-8 text-center">
    <div class="text-[14px] font-extrabold text-ink">${esc(title)}</div>
    <div class="mx-auto mt-2 max-w-[280px] text-[12px] leading-tight text-muted">${esc(body)}</div></div>`;
}
function field(label, inner, hint) {
  const h = hint ? `<p class="mt-1 text-[11.5px] leading-tight text-muted">${esc(hint)}</p>` : "";
  return `<div class="mb-4"><label class="mb-1.5 block text-[11px] font-bold text-muted">${esc(label)}</label>${inner}${h}</div>`;
}
const INPUT = "w-full rounded-[10px] border-0 bg-paper px-3 py-2.5 text-[14px] text-ink placeholder:text-muted";

function scoreRole(score) {
  return score >= 70 ? "high" : score >= 40 ? "mid" : "low";
}
function pctRole(pct) {
  if (pct == null) return "target";
  return pct >= 75 ? "committed" : "offer";
}
const STATUS_ROLE = {
  Target: "target",
  "In Contact": "contact",
  Visit: "visit",
  Offer: "offer",
  Committed: "committed",
};
function money(cents) {
  return E.formatMoneyShort(cents);
}
function initials(name) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}
function avatar(name) {
  return `<span class="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-tint-neutral text-[12px] font-black text-tint-neutral-on">${esc(initials(name))}</span>`;
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

  return `
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Today</h1>
    <p class="mb-5 text-[12.5px] text-muted">${esc(org().shortName)} &middot; ${esc(new Date(TODAY).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }))}</p>

    <div class="mb-5 grid grid-cols-3 gap-2">
      ${tile("Athletes", String(roster.length))}
      ${tile("Open", String(open.length), "in the pipeline")}
      ${tile("Committed", String(targets.filter((t) => t.status === "Committed").length))}
    </div>

    <div class="mb-2">${header("Needs follow-up", stale.length, "offer")}</div>
    <div class="flex flex-col gap-2">
      ${stale
        .map((t) => {
          const a = athlete(t.athleteId);
          const s = school(t.schoolId);
          return rail(
            "offer",
            `<div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-[13px] font-bold text-ink">${esc(a.name)}</div>
                <div class="text-[11.5px] text-muted">${esc(s.name)} &middot; ${daysSince(t.updatedAt)} days quiet</div>
              </div>
              ${pill(t.status, STATUS_ROLE[t.status])}
            </div>`,
            `go('target',{id:'${t.id}'})`,
          );
        })
        .join("")}
    </div>

    ${
      visits.length
        ? `<div class="mb-2 mt-5">${header("Upcoming visits", visits.length, "visit")}</div>
      <div class="flex flex-col gap-2">${visits
        .map((t) => {
          const a = athlete(t.athleteId);
          const s = school(t.schoolId);
          return rail(
            "visit",
            `<div class="min-w-0">
              <div class="text-[13px] font-bold text-ink">${esc(a.name)} at ${esc(s.name)}</div>
              <div class="text-[11.5px] text-muted">${esc(new Date(t.visitDate).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }))}</div>
            </div>`,
            `go('target',{id:'${t.id}'})`,
          );
        })
        .join("")}</div>`
        : ""
    }

    ${
      f
        ? `<div class="mb-2 mt-5">${header("Program overview", null, "committed")}</div>
      ${rail(
        "committed",
        `<div class="min-w-0">
          <div class="text-[14px] font-semibold text-ink">${money(f.totalCashCents)} raised this year</div>
          <div class="mt-0.5 text-[12px] leading-tight text-muted">${
            f.totalBudgetCents > 0 ? Math.round((f.totalCashCents / f.totalBudgetCents) * 100) + "% of the year's target" : "No budget set"
          }${f.outstandingPledgeCents > 0 ? ` &middot; ${money(f.outstandingPledgeCents)} promised and not received` : ""}</div>
        </div>`,
        "tab('fundraising')",
      )}`
        : ""
    }
  `;
};

SCREENS.athletes = () => {
  const roster = byOrg(db.athletes);
  return `
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Athletes</h1>
    <p class="mb-5 text-[12.5px] text-muted">${roster.length} on the roster.</p>
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
                <div class="text-[13px] font-bold text-ink">${esc(a.name)}</div>
                <div class="text-[11.5px] text-muted">${esc(a.position)} &middot; ${esc(a.school)} &middot; ${ts.length} ${ts.length === 1 ? "school" : "schools"}</div>
              </div>
              ${committed ? pill("Committed", "committed") : ""}
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
        <h1 class="text-[20px] font-extrabold text-ink">${esc(a.name)}</h1>
        <div class="text-[12.5px] text-muted">${esc(a.position)} &middot; ${esc(a.school)} &middot; ${a.recruitType === "transfer" ? "Transfer" : "Class of " + (a.detail.gradYear || "")}</div>
      </div>
    </div>

    <div class="mb-5 flex items-center gap-1">
      ${STAGES.map((s, i) => {
        const on = i <= reached;
        return `<div class="flex-1">
          <div class="h-1.5 rounded-full ${on ? DOT[STATUS_ROLE[s]] : "bg-line"}"></div>
          <div class="mt-1 text-[9.5px] font-bold ${on ? "text-ink" : "text-muted"}">${esc(s)}</div>
        </div>`;
      }).join("")}
    </div>

    <div class="mb-4 grid grid-cols-2 gap-2">
      ${tile("School GPA", a.gpa.toFixed(2), a.gpaVerified ? "verified" : "unverified")}
      ${tile("NCAA core", el.view.eligibility.coreGpa?.gpa != null ? el.view.eligibility.coreGpa.gpa.toFixed(2) : "None yet", el.division ? "vs " + el.division : "no division yet")}
    </div>

    ${rail("contact", `<div class="text-[12.5px] leading-tight text-ink">These are different numbers on purpose. The core GPA counts only NCAA core courses, with no plus or minus.</div>`)}

    <div class="mt-4">${button("NCAA eligibility", `go('eligibility',{id:'${a.id}'})`, "secondary")}</div>

    <div class="mb-2 mt-5">${header("Schools", ts.length, "contact")}</div>
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
                      <div class="text-[13px] font-bold text-ink">${esc(s.name)}</div>
                      <div class="text-[11.5px] text-muted">${esc(s.division)} &middot; ${esc(t.status)}</div>
                    </div>
                    ${chip(fit.tag + " " + fit.score, scoreRole(fit.score))}
                  </div>`,
                  `go('target',{id:'${t.id}'})`,
                );
              })
              .join("")
          : emptyState("No schools yet", "Add a target and the fit score calculates itself.")
      }
    </div>

    ${
      docs.length
        ? `<div class="mb-2 mt-5">${header("Documents", docs.length, "place")}</div>
      <div class="flex flex-col gap-2">${docs
        .map((d) => rail("place", `<div class="text-[13px] font-bold text-ink">${esc(d.fileName)}</div><div class="text-[11.5px] text-muted">${esc(d.category || "Unknown")} &middot; applied ${esc(d.createdAt)}</div>`, `go('document',{id:'${d.id}'})`))
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
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">NCAA eligibility</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">${
      !division
        ? "Nothing to judge against yet."
        : division === "D3"
          ? "Target school is Division III."
          : `Division ${division === "D1" ? "I" : "II"} standard. Calculated from ${std?.coreCredits ?? 16} approved core courses, not from the transcript average.`
    }</p>

    <div class="mb-4 rounded-[16px] bg-paper p-4">
      <div class="mb-2">${chip(e.status.replace(/_/g, " "), verdictRole[e.status] || "low")}</div>
      <div class="text-[14px] font-bold leading-tight text-ink">${esc(headline)}</div>
    </div>

    ${
      e.status !== "not_applicable" && e.coreGpa?.gpa != null
        ? `<div class="mb-4 grid grid-cols-2 gap-2">
            ${tile("NCAA core", e.coreGpa.gpa.toFixed(2), std ? `needs ${std.qualifierGpa.toFixed(2)}` : "")}
            ${tile("Transcript", a.gpa.toFixed(2), "what the school reports")}
          </div>`
        : ""
    }

    ${
      view.schoolsMissingScale.length
        ? `<div class="mb-3">${rail(
            "offer",
            `<div class="text-[12.5px] font-bold leading-tight text-ink">${esc(view.schoolsMissingScale.join(" and "))} ${view.schoolsMissingScale.length > 1 ? "have" : "has"} no grading scale on file</div>
             <div class="mt-1 text-[12px] leading-tight text-muted">Those grades are numbers, and the figure above assumes the standard ten-point scale. Enter the real table and this recalculates.</div>
             <div class="mt-2 text-[12px] font-extrabold text-solid-accent" onclick="event.stopPropagation();go('scales')">Enter the grading scale</div>`,
          )}</div>`
        : ""
    }

    ${
      view.scalesUsed.length
        ? `<div class="mb-2 mt-4">${header("How the grades were converted", null, "people")}</div>
           <div class="flex flex-col gap-2">${view.scalesUsed
             .map((s) =>
               rail(
                 s.origin === "verified" ? "contact" : s.origin === "org" ? "target" : "offer",
                 `<div class="text-[12.5px] leading-tight text-ink">${esc(s.school)} numbers converted ${
                   s.origin === "verified" ? "through a confirmed table" : s.origin === "org" ? "through a table your org entered" : "on an assumed ten-point scale"
                 }</div>${s.sourceNote ? `<div class="mt-1 text-[11.5px] leading-tight text-muted">"${esc(s.sourceNote)}"</div>` : ""}`,
               ),
             )
             .join("")}</div>`
        : ""
    }

    ${
      [...view.adapterWarnings, ...e.warnings].length
        ? `<div class="mt-3 flex flex-col gap-2">${[...view.adapterWarnings, ...e.warnings]
            .map((w) => rail("offer", `<div class="text-[12.5px] leading-tight text-ink">${esc(w)}</div>`))
            .join("")}</div>`
        : ""
    }

    ${
      e.coreGpa && e.coreGpa.counted.length
        ? `<div class="mb-2 mt-5">${header("Core courses", e.coreGpa.counted.length, "committed")}</div>
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
                    <div class="min-w-0"><div class="text-[13px] font-bold text-ink">${SUBJECT_LABEL[subject]}</div>
                    <div class="text-[11.5px] text-muted">${credits.toFixed(2)} of ${min} credits</div></div>
                    <span class="text-[13px] font-extrabold tabular-nums text-ink">${(points / credits).toFixed(2)}</span>
                  </div>`,
               );
             })
             .join("")}</div>`
        : ""
    }

    ${
      e.coreGpa && e.coreGpa.excluded.length
        ? `<div class="mb-2 mt-5">${header("Not counted", e.coreGpa.excluded.length, "target")}</div>
           ${rail(
             "target",
             `<div class="text-[12.5px] leading-tight text-ink">${esc(e.coreGpa.excluded.map((x) => x.course.title).join(", "))}</div>
              <div class="mt-1 text-[11.5px] leading-tight text-muted">${esc(e.coreGpa.excluded[0].reason)}</div>`,
           )}`
        : ""
    }

    ${
      view.ageClock.applies
        ? `<div class="mb-2 mt-5">${header("The clock", null, "time")}</div>
           <div class="flex flex-col gap-2">${view.ageClock.reasons
             .map((r) => rail("time", `<div class="text-[12.5px] leading-tight text-ink">${esc(r)}</div>`))
             .join("")}</div>`
        : ""
    }

    <p class="mt-5 text-[11px] leading-relaxed text-muted">A projection until every core credit is final. Confirm with the NCAA Eligibility Center before anyone signs anything.</p>
  `;
};

SCREENS.board = () => {
  const ts = byOrg(db.targets);
  const GROUPS = ["Target", "In Contact", "Visit", "Offer", "Committed"];
  return `
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Board</h1>
    <p class="mb-5 text-[12.5px] text-muted">${ts.length} schools across the roster. Fit is calculated live, never stored.</p>
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
                  <div class="text-[13px] font-bold text-ink">${esc(a.name)}</div>
                  <div class="text-[11.5px] text-muted">${esc(s.name)} &middot; ${esc(s.division)}</div>
                </div>
                ${chip(String(fit.score), scoreRole(fit.score))}
              </div>`,
              `go('target',{id:'${t.id}'})`,
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

  const dim = (label, d) =>
    d
      ? rail(
          d.veto ? "offer" : scoreRole(d.score) === "high" ? "committed" : "contact",
          `<div class="flex items-center justify-between gap-3">
            <div class="min-w-0"><div class="text-[13px] font-bold text-ink">${esc(label)}</div>
            <div class="text-[11.5px] leading-tight text-muted">${esc(d.reasons[0] || d.warnings[0] || "No signal")}</div></div>
            <span class="text-[13px] font-extrabold tabular-nums text-ink">${d.score}</span>
          </div>`,
        )
      : "";

  return `
    ${backLink(a.name)}
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">${esc(s.name)}</h1>
    <p class="mb-4 text-[12.5px] text-muted">${esc(s.division)} &middot; ${esc(s.conference || "")} &middot; ${esc(a.name)}</p>

    <div class="mb-4 rounded-[16px] bg-paper p-4">
      <div class="mb-2 flex items-center gap-2">${chip(fit.tag, scoreRole(fit.score))}<span class="text-[24px] font-black tabular-nums text-ink">${fit.score}</span></div>
      <div class="text-[12.5px] leading-tight text-ink">${esc(fit.reasons[0] || "No reasons recorded")}</div>
    </div>

    <div class="mb-2">${header("Change the stage", null, "accent")}</div>
    <div class="mb-4 flex flex-wrap gap-2">
      ${STAGES.map(
        (g) =>
          `<button onclick="setStatus('${t.id}','${g}')" class="rounded-full px-3 py-1.5 text-[11.5px] font-bold ${
            t.status === g ? SOLID[STATUS_ROLE[g]] : "bg-paper text-muted"
          }">${esc(g)}</button>`,
      ).join("")}
    </div>
    ${rail("contact", `<div class="text-[12.5px] leading-tight text-ink">Try it. The fit score above recalculates through the real engine, because a stage change moves the offer and contact signals.</div>`)}

    <div class="mb-2 mt-5">${header("How the score is built", null, "contact")}</div>
    <div class="flex flex-col gap-2">
      ${dim("Academic", fit.academic)}
      ${dim("Athletic", fit.athletic)}
      ${dim("Financial", fit.financial)}
      ${fit.eligibility ? dim("Eligibility", fit.eligibility) : ""}
    </div>

    ${
      fit.warnings.length
        ? `<div class="mt-3 flex flex-col gap-2">${fit.warnings.map((w) => rail("offer", `<div class="text-[12.5px] leading-tight text-ink">${esc(w)}</div>`)).join("")}</div>`
        : ""
    }

    ${
      t.coachName
        ? `<div class="mb-2 mt-5">${header("Contact", null, "people")}</div>
           ${rail("people", `<div class="text-[13px] font-bold text-ink">${esc(t.coachName)}</div><div class="text-[11.5px] text-muted">${t.commCount || 0} communications &middot; ${t.visitCount || 0} visits</div>`)}`
        : ""
    }
  `;
};

SCREENS.more = () => {
  const m = org().modules;
  const you = org().you;
  const label = org().roleLabels[you.role] || you.role;
  const item = (title, sub, screen, role) =>
    rail(role, `<div class="text-[14px] font-semibold text-ink">${esc(title)}</div><div class="text-[12px] text-muted">${esc(sub)}</div>`, `tab('${screen}')`);

  return `
    <div class="mb-3">${header("More")}</div>
    <div class="flex flex-col gap-2">
      ${item("Documents", "Read a transcript or an offer letter into a record", "documents", "place")}
      ${m.donor_fundraising ? item("Fundraising", "Donors, gifts, pledges and the year against budget", "fundraising", "committed") : ""}
      ${m.board_governance ? item("Board", "Seats and give/get progress across every tier", "governance", "people") : ""}
      ${item("Grading scales", "How each high school's numbers become letters", "scales", "contact")}
      ${item(
        bugs.local.length ? `Flagged bugs (${bugs.local.length})` : "Flagged bugs",
        "Everything you have flagged while clicking through",
        "bugs",
        bugs.local.length ? "offer" : "neutral",
      )}
      ${rail("neutral", `<div class="text-[14px] font-semibold text-ink">${esc(you.name)}</div><div class="text-[12px] text-muted">${esc(label)} at ${esc(org().name)}</div>`)}
    </div>

    <div class="mb-2 mt-5">${header("Switch organization", null, "target")}</div>
    <div class="flex flex-col gap-2">
      ${Object.values(db.orgs)
        .map((o) =>
          rail(
            o.slug === state.org ? "committed" : "target",
            `<div class="flex items-center justify-between gap-3">
              <div class="min-w-0"><div class="text-[13px] font-bold text-ink">${esc(o.name)}</div>
              <div class="text-[11.5px] text-muted">${esc(o.roleLabels.staff)}s &middot; ${Object.entries(o.modules).filter(([, v]) => v).length} modules on</div></div>
              ${o.slug === state.org ? pill("Current", "committed") : ""}
            </div>`,
            `switchOrg('${o.slug}')`,
          ),
        )
        .join("")}
    </div>
    ${rail("contact", `<div class="mt-2 text-[12.5px] leading-tight text-ink">Switch to Elite Squad and the fundraising and board sections disappear, the role labels change, and the roster is different. Same code, no branching on which org it is.</div>`)}
  `;
};

SCREENS.documents = () => {
  const docs = byOrg(db.documents);
  const pending = docs.filter((d) => d.status === "pending");
  const done = docs.filter((d) => d.status !== "pending");
  const STATUS = { applied: ["Applied", "committed"], pending: ["Needs review", "offer"], failed: ["Not used", "target"] };

  return `
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Documents</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">Transcripts and letters, read and routed. No model is connected in this prototype, so every reading is simulated.</p>

    ${pending.length ? `<div class="mb-2">${header("Needs review", pending.length, "offer")}</div>
      <div class="mb-5 flex flex-col gap-2">${pending
        .map((d) => rail("offer", `<div class="text-[13px] font-bold text-ink">${esc(d.fileName)}</div><div class="text-[11.5px] text-muted">from ${esc(d.sourceRole)} &middot; ${Math.round(d.confidence * 100)}% confident</div>`, `go('document',{id:'${d.id}'})`))
        .join("")}</div>` : ""}

    <div class="mb-2">${header("Everything else", done.length, "contact")}</div>
    <div class="flex flex-col gap-2">${done
      .map((d) => {
        const [label, role] = STATUS[d.status];
        return rail(
          role,
          `<div class="flex items-center justify-between gap-3">
            <div class="min-w-0"><div class="text-[13px] font-bold text-ink">${esc(d.fileName)}</div>
            <div class="text-[11.5px] text-muted">${esc(d.athleteId ? athlete(d.athleteId).name : "Unmatched")} &middot; ${esc(d.createdAt)}</div></div>
            ${pill(label, role)}
          </div>`,
          `go('document',{id:'${d.id}'})`,
        );
      })
      .join("")}</div>
  `;
};

SCREENS.document = () => {
  const d = byOrg(db.documents).find((x) => x.id === state.params.id);
  return `
    ${backLink("Documents")}
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">${
      d.status === "failed" ? "Could not use this" : d.status === "pending" ? "Check this before it lands" : "Document read"
    }</h1>
    <p class="mb-4 text-[12.5px] text-muted">${esc(d.fileName)} &middot; from ${esc(d.sourceRole)}</p>

    ${rail("time", `<div class="text-[13px] font-bold text-ink">Simulated reading</div><div class="mt-0.5 text-[11.5px] leading-tight text-muted">No AI model is connected in this prototype. Nothing below was read off a page.</div>`)}

    ${
      d.failureReason
        ? `<div class="mt-4">${rail("target", `<div class="text-[12.5px] leading-tight text-ink">${esc(d.failureReason)}</div>`)}</div>`
        : ""
    }

    <div class="mb-2 mt-5">${header("Confidence", null, d.confidence >= 0.7 ? "committed" : "offer")}</div>
    ${rail(
      d.confidence >= 0.7 ? "committed" : "offer",
      `<div class="flex items-center justify-between gap-3">
        <div class="text-[13px] font-bold text-ink">${d.confidence >= 0.7 ? "High" : d.confidence >= 0.4 ? "Medium" : "Low"} confidence</div>
        <span class="text-[15px] font-extrabold tabular-nums text-ink">${Math.round(d.confidence * 100)}%</span>
      </div>${bar(d.confidence * 100, d.confidence >= 0.7 ? "committed" : "offer")}`,
    )}

    ${
      d.candidates
        ? `<div class="mb-2 mt-5">${header("Who is this?", d.candidates.length, "people")}</div>
           <div class="flex flex-col gap-2">${d.candidates
             .map(
               (c) =>
                 rail(
                   "people",
                   `<div class="flex items-center justify-between gap-3">
                     <div class="text-[13px] font-bold text-ink">${esc(c.name)}</div>
                     <span class="text-[12px] font-extrabold tabular-nums text-muted">${Math.round(c.score * 100)}% match</span>
                   </div>`,
                 ),
             )
             .join("")}</div>
           <div class="mt-3">${rail("contact", `<div class="text-[12.5px] leading-tight text-ink">Below the auto-apply bar, so it waits for a person. A name alone is never enough to change an athlete's record.</div>`)}</div>`
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
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Grading scales</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">How each high school's numbers become letters. The NCAA converts using the school's own published table, never a generic curve.</p>

    ${
      missing.length
        ? `<div class="mb-2">${header("Needed now", missing.length, "offer")}</div>
           <div class="mb-5 flex flex-col gap-2">${missing
             .map((n) =>
               rail(
                 "offer",
                 `<div class="flex items-center justify-between gap-3">
                   <div class="min-w-0"><div class="text-[13px] font-bold text-ink">${esc(n)}</div>
                   <div class="text-[11.5px] text-muted">Running on the assumed ten-point scale</div></div>
                   <span class="text-[12px] font-extrabold text-solid-accent">Add</span>
                 </div>`,
                 `go('scaleEdit',{school:'${esc(n)}'})`,
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
            <div class="text-[13px] font-bold text-ink">${esc(s.school_name)}</div>
            <div class="mt-0.5 text-[11.5px] leading-tight text-muted">${esc(
              [...s.bands].sort((a, b) => b.min - a.min).map((b) => `${b.letter} ${b.min}-${b.max}`).join(" · "),
            )}</div>
            <div class="mt-1 text-[11.5px] leading-tight text-muted">${s.reports_weighted_grades ? `Weighted, adds ${s.weight_bonus.toFixed(2)}` : "No weighted bonus"} &middot; ${esc(s.source_note || "")}</div>
          </div>`,
          `go('scaleEdit',{school:'${esc(s.school_name)}'})`,
        ),
      )
      .join("")}</div>

    <div class="mt-4">${rail("contact", `<div class="text-[12.5px] leading-tight text-ink">Only this org uses these. Another organization with an athlete at the same school keeps its own, so a mistake here cannot change anyone else's eligibility verdict.</div>`)}</div>
  `;
};

SCREENS.scaleEdit = () => {
  const name = state.params.school;
  const existing = db.gradingScales.find((s) => s.school_name === name);
  const bands = existing ? existing.bands : E.TEN_POINT_STARTING_POINT;
  const rowFor = (letter) => bands.find((b) => b.letter.charAt(0) === letter) || { min: "", max: "" };

  return `
    ${backLink("Grading scales")}
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">${esc(name)}</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">Copy the table exactly as the school publishes it. Saving recalculates every athlete there immediately.</p>

    <div class="mb-1 text-[11px] font-bold text-muted">THE TABLE</div>
    <p class="mb-3 text-[11.5px] leading-tight text-muted">Five rows, not twelve. The NCAA does not recognise plus or minus, so A+, A and A- are all four points.</p>
    <div class="mb-4 flex flex-col gap-2">
      ${["A", "B", "C", "D", "F"]
        .map((L) => {
          const r = rowFor(L);
          return `<div class="flex items-center gap-2">
            <span class="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[9px] bg-tint-contact text-[16px] font-black text-tint-contact-on">${L}</span>
            <input id="min_${L}" inputmode="numeric" value="${r.min}" class="${INPUT} text-center tabular-nums" />
            <span class="text-[13px] font-bold text-muted">to</span>
            <input id="max_${L}" inputmode="numeric" value="${r.max}" class="${INPUT} text-center tabular-nums" />
          </div>`;
        })
        .join("")}
    </div>

    ${field(
      "Weighted grades",
      `<label class="flex items-start gap-3 rounded-[10px] bg-paper px-3 py-2.5">
        <input type="checkbox" id="weighted" ${existing && existing.reports_weighted_grades ? "checked" : ""} class="mt-0.5 h-[18px] w-[18px] flex-shrink-0" />
        <span class="text-[13px] font-bold text-ink">The school is on record with the Eligibility Center as awarding weighted grades</span>
      </label>`,
    )}

    ${field("Bonus per weighted course", `<input id="bonus" inputmode="decimal" value="${existing ? existing.weight_bonus : "1.00"}" class="${INPUT} tabular-nums" />`, "The NCAA caps this at 1.00, and the cap is not the same as the amount.")}

    ${field("Where this came from", `<input id="sourceNote" value="${esc(existing ? existing.source_note : "")}" placeholder="Legend printed on page 2" class="${INPUT}" />`, "Required. This table governs every eligibility verdict at this school.")}

    <div id="scale-error" class="mb-3"></div>
    ${button("Save and recalculate", `saveScale('${esc(name)}')`)}
    <p class="mt-3 text-[11px] leading-relaxed text-muted">Try widening the A band down to 85 and watch the core GPA move on the eligibility screen. The calculation is the real shipped engine.</p>
  `;
};

SCREENS.fundraising = () => {
  const f = fundraising();
  const campaigns = byOrg(db.campaigns);
  const budgetPct = f.totalBudgetCents > 0 ? Math.round((f.totalCashCents / f.totalBudgetCents) * 100) : null;

  return `
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Fundraising</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">${FISCAL_YEAR}, against the board budget. Cash received only.</p>

    <div class="mb-3 grid grid-cols-2 gap-2">
      ${tile("Raised", money(f.totalCashCents), "cash in the door")}
      ${tile("Budget", money(f.totalBudgetCents), budgetPct == null ? "no budget set" : budgetPct + "% of the year's target")}
    </div>

    ${
      f.outstandingPledgeCents > 0
        ? `<div class="mb-4">${rail(
            "offer",
            `<div class="text-[13px] font-bold text-ink">${E.formatMoney(f.outstandingPledgeCents)} promised, not received</div>
             <div class="mt-1 text-[12px] leading-tight text-muted">Not counted in the ${money(f.totalCashCents)} above.${
               f.overduePledgeCents > 0 ? ` ${E.formatMoney(f.overduePledgeCents)} of it is past its due date.` : ""
             }</div>`,
          )}</div>`
        : ""
    }

    <div class="mb-2">${header("By category", null, "committed")}</div>
    <div class="flex flex-col gap-2">${f.byCategory
      .map((c) => {
        const role = pctRole(c.percentOfBudget);
        return rail(
          role,
          `<div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-3">
              <div class="text-[13px] font-bold text-ink">${esc(c.label)}</div>
              <span class="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">${c.percentOfBudget == null ? "no target" : c.percentOfBudget + "%"}</span>
            </div>
            <div class="mt-0.5 text-[11.5px] text-muted">${money(c.receivedCents)}${c.budgetCents > 0 ? " of " + money(c.budgetCents) : ""}${
              c.inKindCents > 0 ? " · " + money(c.inKindCents) + " in kind" : ""
            }</div>
            ${bar(c.percentOfBudget || 0, role)}
          </div>`,
        );
      })
      .join("")}</div>

    ${
      f.totalInKindCents > 0
        ? `<div class="mb-2 mt-5">${header("In kind", null, "place")}</div>
           ${rail(
             "place",
             `<div class="text-[13px] font-bold text-ink">${E.formatMoney(f.totalInKindCents)} donated in goods and services</div>
              <div class="mt-0.5 text-[11.5px] leading-tight text-muted">Counted as support, never as cash. Total support is ${money(f.totalSupportCents)}.</div>`,
           )}`
        : ""
    }

    ${
      campaigns.length
        ? `<div class="mb-2 mt-5">${header("Campaigns", campaigns.length, "visit")}</div>
           <div class="flex flex-col gap-2">${campaigns
             .map((c) => {
               const p = E.campaignProgress(c.id, c.goalCents, byOrg(db.gifts), byOrg(db.pledges));
               const role = pctRole(p.percentOfGoal);
               return rail(
                 role,
                 `<div class="min-w-0">
                   <div class="flex items-center justify-between gap-3">
                     <div class="text-[13px] font-bold text-ink">${esc(c.name)}</div>
                     <span class="flex-shrink-0 text-[12px] font-extrabold tabular-nums text-ink">${p.percentOfGoal == null ? "no goal" : p.percentOfGoal + "%"}</span>
                   </div>
                   <div class="mt-0.5 text-[11.5px] text-muted">${money(p.raisedCents)} raised of a ${money(p.goalCents)} goal${
                     p.pledgedCents > 0 ? " · " + money(p.pledgedCents) + " pledged" : ""
                   }</div>
                   ${bar(p.percentOfGoal || 0, role)}
                 </div>`,
               );
             })
             .join("")}</div>`
        : ""
    }

    <div class="mb-2 mt-5">${header("This year", null, "contact")}</div>
    ${rail("contact", `<div class="text-[12.5px] leading-tight text-ink">${f.giftCount} gifts from ${f.donorCount} supporters. Anonymous gifts count in the total and not in the supporter number, so the figure means people.</div>`)}

    <div class="mt-5 flex flex-col gap-2">
      ${button("Record a gift", "go('giftNew')")}
      ${button("Donors", "go('donors')", "secondary")}
    </div>
  `;
};

SCREENS.donors = () => {
  const rows = byOrg(db.donors)
    .map((d) => ({ donor: d, totals: E.donorTotals(d.id, byOrg(db.gifts), byOrg(db.pledges), FISCAL_YEAR) }))
    .sort((a, b) => b.totals.lifetimeCashCents - a.totals.lifetimeCashCents);
  const owing = rows.filter((r) => r.totals.outstandingPledgeCents > 0);

  return `
    ${backLink("Fundraising")}
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Donors</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">${rows.length} supporters. Totals are calculated from the gifts, not typed in, so they cannot go stale.</p>

    ${
      owing.length
        ? `<div class="mb-2">${header("Owes a pledge", owing.length, "target")}</div>
           <div class="mb-5 flex flex-col gap-2">${owing
             .map((r) =>
               rail(
                 "target",
                 `<div class="flex items-center justify-between gap-3">
                   <div class="min-w-0"><div class="text-[13px] font-bold text-ink">${esc(r.donor.name)}</div>
                   <div class="text-[11.5px] text-muted">Promised and not yet received</div></div>
                   <span class="text-[13px] font-extrabold tabular-nums text-ink">${E.formatMoney(r.totals.outstandingPledgeCents)}</span>
                 </div>`,
               ),
             )
             .join("")}</div>`
        : ""
    }

    <div class="mb-2">${header("All donors", rows.length, "contact")}</div>
    <div class="flex flex-col gap-2">${rows
      .map(({ donor, totals }) =>
        rail(
          "contact",
          `<div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[13px] font-bold text-ink">${esc(donor.name)}</div>
              <div class="mt-0.5 text-[11.5px] text-muted">${totals.giftCount} ${totals.giftCount === 1 ? "gift" : "gifts"}${
                totals.lastGiftOn ? " · last " + new Date(totals.lastGiftOn).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : ""
              }</div>
              <div class="mt-1.5">${chip(donor.donor_type.replace(/_/g, " "), "contact")}</div>
            </div>
            <div class="flex-shrink-0 text-right">
              <div class="text-[13px] font-extrabold tabular-nums ${totals.lifetimeCashCents === 0 ? "text-muted" : "text-ink"}">${money(totals.lifetimeCashCents)}</div>
              <div class="text-[10.5px] text-muted">${totals.lifetimeInKindCents > 0 ? money(totals.lifetimeInKindCents) + " in kind" : "lifetime"}</div>
            </div>
          </div>`,
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
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Record a gift</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">Money that has actually arrived. A promise goes in as a pledge instead.</p>

    ${field("Amount", `<input id="g_amount" inputmode="decimal" placeholder="$0.00" class="${INPUT} text-[18px] font-bold tabular-nums" />`)}
    ${field(
      "Donor",
      `<select id="g_donor" class="${INPUT}"><option value="">Anonymous</option>${donors.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select>`,
      "Anonymous still counts in the total and not in the supporter count.",
    )}
    ${field("Received", `<input id="g_date" type="date" value="${TODAY}" class="${INPUT} tabular-nums" />`)}
    ${field(
      "How",
      `<select id="g_method" class="${INPUT}">${["check", "stripe", "cash", "in_kind", "other"].map((m) => `<option value="${m}">${m === "in_kind" ? "In kind" : m[0].toUpperCase() + m.slice(1)}</option>`).join("")}</select>`,
      "In kind is counted as support, never as cash.",
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
            "Credits this toward their give/get. If they are also the donor, it still counts once.",
          )
        : ""
    }

    <div id="gift-error" class="mb-3"></div>
    ${button("Record it", "saveGift()")}
    <p class="mt-3 text-[11px] leading-relaxed text-muted">The totals on the previous screen recalculate through the real rollup. Try an in-kind gift and watch it stay out of the cash figure.</p>
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
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Board</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">${FISCAL_YEAR}. Each tier carries a give/get commitment, and progress is cash in the door, given or brought in.</p>

    <div class="mb-3 grid grid-cols-2 gap-2">
      ${tile("Committed", money(totals.committed), `across ${totals.seats} active seats`)}
      ${tile("Delivered", money(totals.raised), `${pct == null ? "no commitments" : pct + "%"} · ${totals.meeting} of ${totals.seats} met`)}
    </div>

    ${rail("contact", `<div class="text-[12.5px] leading-tight text-ink">Give/get counts both halves. A member meets their number by giving it or by bringing it in, and a gift is never counted twice when they did both.</div>`)}

    <div class="mb-2 mt-5">${header("Boards", boards.length, "committed")}</div>
    <div class="flex flex-col gap-2">${boards
      .map((b) => {
        const s = boardSummary(b.id);
        const role = pctRole(s.percent);
        return rail(
          role,
          `<div class="min-w-0">
            <div class="flex items-start justify-between gap-3">
              <div class="text-[13px] font-bold text-ink">${esc(b.name)}</div>
              <span class="flex-shrink-0 text-[12px] font-extrabold tabular-nums text-ink">${s.percent == null ? "no target" : s.percent + "%"}</span>
            </div>
            <div class="mt-0.5 text-[11.5px] text-muted">${money(b.giveGetCents)} give/get &middot; ${s.seatsFilled} of ${b.maxSeats} seats</div>
            ${s.belowMinimum ? `<div class="mt-0.5 text-[11.5px] leading-tight text-muted">Below the floor of ${b.minSeats} seats.</div>` : ""}
            ${bar(s.percent || 0, role)}
          </div>`,
          `go('boardDetail',{id:'${b.id}'})`,
        );
      })
      .join("")}</div>
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
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">${esc(b.name)}</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">${money(b.giveGetCents)} give/get per seat. ${esc(E.BOARD_KIND_PURPOSE[b.kind])}</p>

    <div class="mb-4">${rail(
      role,
      `<div class="min-w-0">
        <div class="flex items-start justify-between gap-3">
          <div class="text-[13px] font-bold text-ink">${money(s.raisedCents)} of ${money(s.committedCents)}</div>
          <span class="flex-shrink-0 text-[12px] font-extrabold tabular-nums text-ink">${s.percent == null ? "no target" : s.percent + "%"}</span>
        </div>
        <div class="mt-0.5 text-[11.5px] text-muted">${s.seatsFilled} filled &middot; ${s.seatsOpen} open &middot; ${s.membersMeeting} of ${s.seatsFilled} fully met</div>
        ${bar(s.percent || 0, role)}
      </div>`,
    )}</div>

    <div class="mb-2">${header("Seats", ordered.length, "contact")}</div>
    <div class="flex flex-col gap-2">${ordered
      .map((m) => {
        const p = giveGetFor(m.id);
        const mRole = m.status === "active" ? pctRole(p.percent) : "target";
        return rail(
          mRole,
          `<div class="min-w-0">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0"><div class="text-[13px] font-bold text-ink">${esc(m.name)}</div>
              <div class="mt-0.5 text-[11.5px] text-muted">${esc(m.roleTitle || "No role set")}</div></div>
              ${m.status === "active" ? `<span class="flex-shrink-0 text-[12px] font-extrabold tabular-nums text-ink">${p.percent == null ? "no target" : p.percent + "%"}</span>` : chip(m.status, "low")}
            </div>
            ${
              m.status === "active"
                ? `<div class="mt-1.5 text-[11.5px] text-muted">${money(p.givenCents)} given &middot; ${money(p.raisedCents)} brought in${
                    m.donorId == null ? " · no donor record linked" : ""
                  }</div>
                   ${p.pledgedCents > 0 ? `<div class="mt-0.5 text-[11.5px] leading-tight text-muted">${E.formatMoney(p.pledgedCents)} pledged, not yet received.</div>` : ""}
                   ${bar(p.percent || 0, mRole)}`
                : ""
            }
          </div>`,
        );
      })
      .join("")}</div>

    <div class="mt-4">${rail("contact", `<div class="text-[12.5px] leading-tight text-ink">Only an active seat counts toward the board's total. A prospect has not joined and an emeritus member is not on the hook, so counting either would make the board look further behind than it is.</div>`)}</div>
  `;
};

SCREENS.bugs = () => {
  const list = bugs.local;
  const anyLocalOnly = list.some((b) => b.localOnly) || !bugs.store;

  return `
    ${backLink("More")}
    <h1 class="mb-1 text-[20px] font-extrabold text-ink">Flagged bugs</h1>
    <p class="mb-5 text-[12.5px] leading-tight text-muted">${
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
                    <div class="text-[13px] font-bold leading-tight text-ink">${esc(b.note)}</div>
                    <div class="mt-1 text-[11.5px] leading-tight text-muted">${esc(b.screen)}${
                      b.params && b.params !== "{}" ? " " + esc(b.params) : ""
                    } &middot; ${esc(b.org)} &middot; ${esc(new Date(b.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</div>
                    ${b.localOnly ? `<div class="mt-1.5">${chip("this device only", "target")}</div>` : ""}
                  </div>
                  <button onclick="deleteBug('${b.id}')" class="flex-shrink-0 text-[11.5px] font-bold text-muted">Remove</button>
                </div>
              </div>`,
            )
            .join("")}</div>`
    }

    ${
      list.length && anyLocalOnly
        ? `<div class="mt-5">${button("Copy them all", "copyBugs()", "secondary")}</div>
           <div class="mt-3 rounded-[10px] bg-paper px-3.5 py-3">
             <div class="text-[11px] leading-relaxed text-muted" style="white-space:pre-wrap">${esc(bugsAsText())}</div>
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
  const row = {
    school_name: name,
    bands,
    reports_weighted_grades: document.getElementById("weighted").checked,
    weighting_is_class_rank_only: false,
    weight_bonus: Number(document.getElementById("bonus").value) || 0,
    origin: "org",
    source_note: note,
  };
  if (existing) Object.assign(existing, row);
  else db.gradingScales.push(row);

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

function showError(id, message) {
  document.getElementById(id).innerHTML = `<div class="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[13px] font-semibold text-danger">${esc(message)}</div>`;
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
    class="flex h-[44px] items-center gap-2 rounded-full bg-solid-danger px-4 text-[12.5px] font-bold text-solid-danger-on shadow-lg">
    <span aria-hidden="true">&#9873;</span> Flag a bug</button>`;

  if (!bugs.sheetOpen) return `<div class="flagwrap">${fab}</div>`;

  return `<div class="sheetbackdrop" onclick="closeBugSheet()"></div>
    <div class="sheet">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div class="text-[15px] font-extrabold text-ink">Flag a bug</div>
        <button onclick="closeBugSheet()" class="text-[12.5px] font-bold text-muted">Cancel</button>
      </div>
      <textarea id="bug_note" rows="3" placeholder="What looks wrong?" class="${INPUT}"></textarea>
      <div id="bug-error" class="mt-2"></div>
      <div class="mt-3 rounded-[10px] bg-bg px-3 py-2.5">
        <div class="text-[10.5px] font-bold uppercase tracking-[0.03em] text-muted">Recorded with it</div>
        <div class="mt-1 text-[11.5px] leading-tight text-muted">${esc(ctx.screen)}${
          ctx.params !== "{}" ? " " + esc(ctx.params) : ""
        } &middot; ${esc(db.orgs[ctx.org].shortName)} &middot; what is on screen right now</div>
      </div>
      <div class="mt-3">${button("Flag it", "saveBug()")}</div>
      <p class="mt-2 text-[11px] leading-relaxed text-muted">${
        bugs.store
          ? "Goes straight to Claude with the screen you were on, so you do not have to describe where you were."
          : "Kept on this device. The Bugs list under More has a copy button."
      }</p>
    </div>`;
}

function render() {
  const body = SCREENS[state.screen] ? SCREENS[state.screen]() : `<div class="p-8 text-center text-muted">Not built in this prototype.</div>`;
  const activeTab = ["today", "athletes", "board", "more"].includes(state.screen)
    ? state.screen
    : ["fundraising", "donors", "giftNew", "governance", "boardDetail", "documents", "document", "scales", "scaleEdit", "bugs"].includes(state.screen)
      ? "more"
      : ["athlete", "eligibility"].includes(state.screen)
        ? "athletes"
        : "board";

  document.getElementById("screen").innerHTML = `<main class="px-4 pt-3 pb-24">${body}</main>`;

  document.getElementById("tabbar").innerHTML = TABS.map(
    (t) =>
      `<button onclick="tab('${t.key}')" class="flex-1 py-2 text-[10.5px] font-bold ${
        activeTab === t.key ? "text-solid-accent" : "text-muted"
      }">${t.label}</button>`,
  ).join("");

  document.getElementById("buglayer").innerHTML = bugLayer();
  document.getElementById("orgbadge").textContent = org().shortName;
  document.getElementById("toast").innerHTML = state.toast
    ? `<div class="mx-auto mb-2 w-fit max-w-[340px] rounded-full bg-ink px-4 py-2 text-center text-[12px] font-bold text-paper">${esc(state.toast)}</div>`
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
window.saveGift = saveGift;

render();
initBugs();
