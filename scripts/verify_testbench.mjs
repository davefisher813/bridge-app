// Runs the test bench in a real headless browser and fails if any of its
// checks fail. This is what stops a bench from being published green when
// it is not: the assertions run against the bundled shipped code, so a
// regression in the fit engine or the Doc AI pipeline fails here before
// Dave ever opens the artifact.
import pw from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const FILE = "/tmp/claude-0/-home-claude/29e8f462-8fb8-51f4-a493-bd698cb56848/scratchpad/test_bench.html";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("file://" + FILE);
await page.waitForTimeout(700);

const results = await page.evaluate(async () => {
  const sync = window.Bridge.runSuite();
  const async_ = await window.Bridge.runDocSuite();
  return sync.concat(async_);
});

const failed = results.filter((c) => !c.pass);
for (const c of failed) console.error(`FAIL [${c.suite}] ${c.name} -> ${c.detail}`);
for (const e of errors) console.error(`PAGE ERROR: ${e}`);

console.log(`${results.length - failed.length}/${results.length} bench checks pass`);
await browser.close();
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
