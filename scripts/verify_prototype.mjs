// Drives the prototype in real headless Chromium and asserts it works.
//
// The point of a click-through prototype is that it is clickable, so
// "it built" is not the same as "it works". This taps through every
// screen, exercises every interaction, and checks that the numbers on
// screen actually change when the real engines say they should.
//
// Same approach as scripts/verify_testbench.mjs, and the same reason:
// shipping something that looks fine and throws on the second tap is
// worse than not shipping it.

// Absolute path, matching verify_testbench.mjs: playwright is installed
// globally in this environment rather than as a project dependency.
import pw from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { readFileSync } from "node:fs";

const FILE = "/tmp/claude-0/-home-claude/29e8f462-8fb8-51f4-a493-bd698cb56848/scratchpad/prototype.html";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

// When a check breaks the app, the next tap usually cannot find what it
// is looking for and Playwright throws a timeout thirty seconds later.
// Left alone that hides every check already recorded and every check
// after it. So the report prints either way, and the crash itself is
// recorded as the failure it is.
function report(err) {
  if (err) check("the walkthrough ran to the end", false, String(err).split("\n")[0]);
  const passed = results.filter((r) => r.ok).length;
  for (const r of results) {
    if (!r.ok) console.log(`FAIL  ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
  }
  console.log(`${passed}/${results.length} prototype checks pass`);
  process.exit(passed === results.length ? 0 : 1);
}
process.on("unhandledRejection", report);
process.on("uncaughtException", report);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.setContent(readFileSync(FILE, "utf8"), { waitUntil: "load" });

const text = () => page.locator("#screen").innerText();

// Section headers and tile labels are uppercased by CSS, so innerText
// gives them back in caps. Every content assertion is case-insensitive
// rather than each one remembering which is which.
const has = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());
// "NCAA CORE\n3.30" on screen. The label case varies; the number does not.
const numberUnder = (t, label) => {
  const m = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\n?\\s*\\$?([\\d,.]+)", "i").exec(t);
  return m ? m[1] : null;
};
const tap = async (selector) => {
  await page.locator(selector).first().click();
  await page.waitForTimeout(60);
};

// ── The shell renders at all ─────────────────────────────────────────
check("the app renders", has(await text(), "Today"));
check("the real engines are bundled in", await page.evaluate(() => typeof window.Engines?.scoreFit === "function"));

// ── Today ────────────────────────────────────────────────────────────
let t = await text();
check("Today shows the roster count", has(t, "Athletes") && numberUnder(t, "Athletes") === "4", numberUnder(t, "Athletes") ?? "none");
check("Today shows fundraising for Bridge", /raised this year/.test(t));

// ── Athletes and the NCAA engine ─────────────────────────────────────
await tap("button:has-text('Athletes')");
t = await text();
check("the roster lists athletes", has(t, "Marcus Ellery") && has(t, "Andre Whitlock"));

await tap("text=Marcus Ellery");
t = await text();
check("an athlete page opens", has(t, "Marcus Ellery") && has(t, "School GPA"));
// The whole point of the eligibility work: the two numbers differ.
const schoolGpa = numberUnder(t, "School GPA");
const coreGpa = numberUnder(t, "NCAA core");
check(
  "the core GPA differs from the transcript GPA",
  !!schoolGpa && !!coreGpa && schoolGpa !== coreGpa,
  schoolGpa && coreGpa ? `${schoolGpa} vs ${coreGpa}` : "one of them did not render",
);

await tap("button:has-text('NCAA eligibility')");
t = await text();
check("the eligibility screen renders a verdict", /qualifier|redshirt|nonqualifier|insufficient/i.test(t));
check("it shows the core-course breakdown", has(t, "Core courses"));
check("it shows which table converted the grades", has(t, "How the grades were converted"));
const coreBefore = numberUnder(t, "NCAA core");
check("the eligibility screen shows a core GPA", !!coreBefore, coreBefore ?? "none");

// ── Editing a grading scale moves the GPA ────────────────────────────
await tap("button:has-text('More')");
await tap("text=Grading scales");
t = await text();
check("the grading scales screen lists what is on file", has(t, "Cardinal Ridge"));

await tap("text=Cardinal Ridge High School");
t = await text();
check("the scale editor opens with the stored bands", has(t, "the table"));

// Widen the A band so more grades become A. The core GPA must rise.
await page.locator("#min_A").fill("85");
await page.locator("#max_B").fill("84");
await tap("button:has-text('Save and recalculate')");
await page.waitForTimeout(80);

await tap("button:has-text('Athletes')");
await tap("text=Marcus Ellery");
await tap("button:has-text('NCAA eligibility')");
t = await text();
const coreAfter = numberUnder(t, "NCAA core");
check(
  "editing the grading scale moved the core GPA",
  !!coreAfter && !!coreBefore && Number(coreAfter) > Number(coreBefore),
  `${coreBefore} then ${coreAfter}`,
);

// ── The scale checker refuses a table that cannot be right ───────────
await tap("button:has-text('More')");
await tap("text=Grading scales");
await tap("text=Cardinal Ridge High School");
await page.locator("#min_A").fill("50");
await page.locator("#max_A").fill("100");
await tap("button:has-text('Save and recalculate')");
await page.waitForTimeout(60);
t = await text();
check("a nonsense grading table is refused", /cannot be right/i.test(t), t.slice(0, 120));

// ── The recruiting engine reacts to a stage change ───────────────────
await tap("button:has-text('Board')");
t = await text();
check("the board groups targets by stage", has(t, "Committed") && has(t, "In Contact"));

await tap("text=Andre Whitlock");
t = await text();
check("a target page shows a fit score and its dimensions", has(t, "How the score is built"));

await tap("button:has-text('Committed')");
await page.waitForTimeout(80);
t = await text();
check("changing the stage re-renders without error", has(t, "How the score is built"));

// ── The fundraising rollup ───────────────────────────────────────────
await tap("button:has-text('More')");
await tap("text=Fundraising");
t = await text();
check("fundraising shows the five P&L categories", has(t, "Individual Donations") && has(t, "Foundation Grants"));
check("pledges are reported outside the total", /promised, not received/i.test(t));
check("in-kind is reported separately", /in kind/i.test(t));
const raisedBefore = numberUnder(t, "Raised");
check("it shows an amount raised", !!raisedBefore, raisedBefore ?? "none");

// ── Recording a gift moves the total ─────────────────────────────────
await tap("button:has-text('Record a gift')");
t = await text();
check("the gift form opens", has(t, "Record a gift"));
check("the gift form offers the give/get credit for Bridge", has(t, "Brought in by"));

await page.locator("#g_amount").fill("1000");
await tap("button:has-text('Record it')");
await page.waitForTimeout(80);
t = await text();
const raisedAfter = numberUnder(t, "Raised");
check(
  "recording a gift raised the total by the amount given",
  !!raisedAfter && !!raisedBefore && Number(raisedAfter.replace(/,/g, "")) === Number(raisedBefore.replace(/,/g, "")) + 1000,
  `${raisedBefore} then ${raisedAfter}`,
);

// ── An in-kind gift stays out of cash ────────────────────────────────
await tap("button:has-text('Record a gift')");
await page.locator("#g_amount").fill("5000");
await page.locator("#g_method").selectOption("in_kind");
await tap("button:has-text('Record it')");
await page.waitForTimeout(80);
t = await text();
const raisedInKind = numberUnder(t, "Raised");
check(
  "an in-kind gift did not move the cash total",
  raisedInKind === raisedAfter,
  `${raisedAfter} then ${raisedInKind}`,
);

// ── A gift of zero is refused ────────────────────────────────────────
await tap("button:has-text('Record a gift')");
await page.locator("#g_amount").fill("0");
await tap("button:has-text('Record it')");
await page.waitForTimeout(60);
t = await text();
check("a gift of zero is refused", /cannot be zero/i.test(t));
await tap("a:has-text('Fundraising')");

// ── Donors, derived totals ───────────────────────────────────────────
await tap("button:has-text('Donors')");
t = await text();
check("donors show derived lifetime totals", has(t, "lifetime") || has(t, "in kind"));
check("a donor owing a pledge is flagged", /Owes a pledge/i.test(t));

// ── Board give/get ───────────────────────────────────────────────────
await tap("button:has-text('More')");
await tap("text=Seats and give/get");
t = await text();
check("the board overview renders", has(t, "Executive Board") && has(t, "give/get"));

await tap("text=Baseball Board");
t = await text();
check("a board page shows its seats", has(t, "Sport Director"));
check("give/get splits given from brought in", /given/.test(t) && /brought in/.test(t));
check("a prospect seat is not counted as active", /Prospect/i.test(t));

// ── Documents ────────────────────────────────────────────────────────
await tap("button:has-text('More')");
await tap("text=Documents");
t = await text();
check("the document queue renders", has(t, "Needs review"));
await tap("text=IMG_4471.jpeg");
t = await text();
check("a pending document asks who it belongs to", has(t, "Who is this?"));
check("it says the reading is simulated", /Simulated reading/i.test(t));

// ── Multi-tenancy: the modules really disappear ──────────────────────
await tap("button:has-text('More')");
await tap("text=Elite Squad NY");
await page.waitForTimeout(80);
check("switching org changes the visible org", has(await page.locator("#orgbadge").innerText(), "Elite"));
// Switching lands on Today, deliberately, so the module check goes back
// to More rather than reading whichever screen happened to be showing.
await tap("button:has-text('More')");
t = await text();
check("fundraising disappears for an org without the module", !has(t, "Donors, gifts, pledges"));
check("board governance disappears too", !has(t, "Seats and give/get"));
check("the role label changes with the org", has(t, "Owner at Elite Squad NY"));
check("the other org still sees the modules that are on for everyone", has(t, "Documents") && has(t, "Grading scales"));

await tap("button:has-text('Athletes')");
t = await text();
check("the roster is the other org's", has(t, "Jonah Petrakis") && !has(t, "Marcus Ellery"));

await tap("button:has-text('Today')");
t = await text();
check("Today hides the fundraising block for that org", !/raised this year/.test(t));

// ── Flagging a bug ───────────────────────────────────────────────────
// Under setContent there is no artifact host, so claude.use("db")
// resolves null and this exercises the on-device fallback: the path
// that has to work when the capability is absent, which is also the
// path a published page falls back to if the store ever fails.
check("the flag button is on screen", await page.locator("#flagbtn").isVisible());

await tap("#flagbtn");
check("the sheet opens", await page.locator("#bug_note").isVisible());
// Read through a helper: when a check below breaks the sheet, the run
// should report that check as a failure, not time out and take the
// remaining checks down with it.
const sheetText = async () => ((await page.locator(".sheet").count()) ? page.locator(".sheet").innerText() : "");
const sheet = await sheetText();
check("the sheet names the screen it will record", has(sheet, "today"), sheet.slice(0, 80));
check("the sheet names the org it will record", has(sheet, "Elite"), sheet.slice(0, 80));

// An empty note is refused rather than filed as a blank report.
await tap("button:has-text('Flag it')");
check("an empty report is refused", has(await sheetText(), "What went wrong"));
check("the sheet stays open after a refusal", await page.locator("#bug_note").isVisible());

await page.locator("#bug_note").fill("The roster count looks off on Today.");
await tap("button:has-text('Flag it')");
await page.waitForTimeout(80);
check("the sheet closes once the report is filed", (await page.locator("#bug_note").count()) === 0);
check("filing it confirms on screen", has(await page.locator("#toast").innerText(), "Flagged"));

// It has to survive navigating away, which is the whole point.
await tap("button:has-text('More')");
t = await text();
check("More shows the count", has(t, "Flagged bugs (1)"), t.slice(0, 60));

await tap("text=Flagged bugs (1)");
t = await text();
check("the report is listed with what was written", has(t, "The roster count looks off"));
check("the report carries the screen it was flagged on", has(t, "today"));
check("the report carries the org it was flagged on", has(t, "elite-squad-ny") || has(t, "elite"));
check("a device-only report offers a way to copy it out", has(t, "Copy them all"));

// Flagged from a different screen, the context has to be that screen.
await tap("button:has-text('Athletes')");
await tap("#flagbtn");
await page.locator("#bug_note").fill("Second one, from the roster.");
await tap("button:has-text('Flag it')");
await page.waitForTimeout(80);
await tap("button:has-text('More')");
await tap("text=Flagged bugs (2)");
t = await text();
check("a second report records its own screen", has(t, "athletes") && has(t, "Second one"), t.slice(0, 200));

// And removing one removes only that one.
await tap("button:has-text('Remove')");
await page.waitForTimeout(60);
t = await text();
check("removing a report leaves the others", !has(t, "Second one") && has(t, "The roster count looks off"));

// ── Nothing threw anywhere in all of that ────────────────────────────
check("no page errors during the whole walkthrough", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
report();
