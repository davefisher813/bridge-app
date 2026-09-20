#!/usr/bin/env node
// qa/preview.mjs, phone width screenshots of the real app.
//
// DELIBERATELY SEPARATE FROM qa:check. The gate must go green on a machine
// with no browser installed, so nothing here is imported by check.js and
// playwright is a devDependency the app never ships.
//
// What it shoots: the shipped Next app, built with FIXTURE_MODE=1, which
// swaps the two Supabase seams for src/testing/fixture.ts and nothing else
// (see scripts/README.md). Every page, form, font and client component is
// the real one. 390px wide, light and dark, both from the phone's own
// colour scheme the way the app reads it.
//
// Covered, as required: sign-in, the email (magic link) page, the first
// screen after sign-in (the organization picker, then Today).
//
// Run: npm run qa:preview -- <change-name>

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = (name) => path.join(ROOT, 'node_modules', '.bin', name);
const WIDTH = 390;
const HEIGHT = 844;
const SCALE = 2;

const change = (process.argv[2] || 'unnamed').replace(/[^a-z0-9._-]/gi, '-');
const outDir = path.join(HERE, 'previews', change);

// Fixture routes. The org slug is the fixture's; the fixture is invented,
// and the checklist asks a human to confirm what the shots show before any
// leaves the repo.
const SHOTS = [
  { name: 'login', route: '/login' },
  { name: 'login-email', route: '/login?mode=link' },
  { name: 'choose-org', route: '/' },
  { name: 'today', route: '/org/bridge-fixture' }
];
const themes = ['light', 'dark'];

const env = { ...process.env, FIXTURE_MODE: '1', NEXT_TELEMETRY_DISABLED: '1' };

if (process.env.QA_PREVIEW_SKIP_BUILD !== '1') {
  console.log('building the app with FIXTURE_MODE=1 (the next qa:check rebuilds for production)');
  const b = spawnSync(BIN('next'), ['build'], { cwd: ROOT, env, stdio: 'inherit' });
  if (b.status !== 0) { console.error('the fixture build failed; nothing was written'); process.exit(1); }
}

const port = 31000 + Math.floor(Math.random() * 9000);
const server = spawn(BIN('next'), ['start', '-p', String(port)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const base = `http://127.0.0.1:${port}`;
const stop = () => { try { process.kill(-server.pid, 'SIGKILL'); } catch (e) { try { server.kill('SIGKILL'); } catch (e2) { /* gone */ } } };

let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try { const r = await fetch(`${base}/login`); up = r.status > 0; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
}
if (!up) { stop(); console.error('the fixture app did not come up'); process.exit(1); }

mkdirSync(outDir, { recursive: true });

// Playwright's own browser first. The fallback exists because some build
// environments ship a Chromium already and block the download, and a
// preview that cannot run is a preview nobody looks at.
async function launch() {
  try {
    return { browser: await chromium.launch(), via: 'playwright' };
  } catch (first) {
    const candidates = [process.env.PW_CHROMIUM, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
    const root = '/opt/pw-browsers';
    if (existsSync(root)) for (const d of readdirSync(root)) if (d.startsWith('chromium')) candidates.push(path.join(root, d, 'chrome-linux', 'chrome'), path.join(root, d, 'chrome-linux64', 'chrome'));
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      try { return { browser: await chromium.launch({ executablePath: p, args: ['--no-sandbox'] }), via: p }; } catch (e) { /* next */ }
    }
    throw first;
  }
}

let browser, via;
try {
  ({ browser, via } = await launch());
} catch (e) {
  stop();
  console.error('Could not launch Chromium: ' + e.message);
  console.error('Run: npx playwright install chromium');
  console.error('Nothing was written. A UI change without a preview does not pass review.');
  process.exit(1);
}

const written = [];
const failed = [];
for (const theme of themes) {
  // The viewport is STATED, and checked after the shot: Chromium ignores a
  // window size below about 500px in headless, so a preview asked for at
  // 390 can quietly render wider. A phone preview that is not phone width
  // is worse than no preview.
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, colorScheme: theme });
  for (const s of SHOTS) {
    const file = path.join(outDir, `${s.name}-${theme}.png`);
    try {
      const p = await context.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      const res = await p.goto(base + s.route, { waitUntil: 'load', timeout: 60000 });
      if (!res || res.status() >= 400) throw new Error(`answered ${res ? res.status() : 'nothing'}`);
      await p.evaluate(() => document.fonts.ready);
      await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await p.screenshot({ path: file, fullPage: true });
      const size = await p.evaluate(() => document.documentElement.clientWidth);
      if (size !== WIDTH) throw new Error(`rendered at ${size}px, expected ${WIDTH}px`);
      if (errs.length) throw new Error('page error: ' + errs[0]);
      await p.close();
      written.push(path.relative(ROOT, file));
    } catch (e) {
      failed.push(`${s.name}-${theme}: ${e.message}`);
    }
  }
  await context.close();
}

await browser.close();
stop();

const reportPath = path.join(HERE, 'reports', 'latest.json');
if (existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  report.preview = { applicable: true, change, width: WIDTH, height: HEIGHT, scale: SCALE, files: written, failed };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}

for (const f of written) console.log('wrote ' + f);
for (const f of failed) console.log('FAILED ' + f);
console.log(`\n${written.length} of ${themes.length * SHOTS.length} at ${WIDTH}px, light and dark. Browser: ${via}`);
if (failed.length) { console.log('A UI change with a missing shot does not pass review.'); process.exit(1); }
