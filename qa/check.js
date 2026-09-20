#!/usr/bin/env node
// qa/check.js, the gate every change passes before it reaches Dave.
//
// Same shape as jarvis-backend/qa/check.js, on purpose. Four stages, in
// order, stopping at the first failure: tests, build, lint, types. No
// browser: this runs on a machine with nothing installed beyond what the
// app already needs to build, and imports nothing from qa/preview.mjs, so
// a missing Chromium can never turn the gate red. The phone preview is a
// SEPARATE script.
//
// Writes qa/reports/latest.json plus a dated copy, and exits nonzero on a
// failure so this can gate a push later without any rewriting.
//
// Run: npm run qa:check
//      QA_PUBLISH=0 npm run qa:check   to skip the artifacts push

'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORTS = path.join(__dirname, 'reports');
const BIN = (name) => path.join(ROOT, 'node_modules', '.bin', name);

// Boot log words that mean something went wrong. Deprecations are judged
// separately, by where they came from, so they are not in this list.
const BAD_LOG = /\b(Error|failed|Unhandled)\b/;

const read = (p) => fs.readFileSync(p, 'utf8');
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

function git(...args) {
  const r = sh('git', args);
  return r.status === 0 ? r.stdout.trim() : null;
}

// Files this change touched: anything differing from origin/main, which
// covers commits already on a branch as well as uncommitted edits, plus
// anything untracked. Used by the em dash ratchet, where touching a file
// costs you its grandfathering.
function changedFiles() {
  const out = new Set();
  const hasBase = sh('git', ['rev-parse', '--verify', '--quiet', 'origin/main']).status === 0;
  if (hasBase) {
    for (const f of (git('diff', '--name-only', 'origin/main', '--') || '').split('\n')) {
      if (f.trim()) out.add(f.trim());
    }
  }
  for (const f of (git('ls-files', '--others', '--exclude-standard') || '').split('\n')) {
    if (f.trim()) out.add(f.trim());
  }
  return out;
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'out', 'dist', 'coverage']);

// Every file this repo owns with one of the given extensions. node_modules
// and build output are not ours to judge.
function ownedFiles(exts) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (exts.includes(path.extname(entry.name))) out.push(full);
    }
  };
  walk(ROOT);
  return out.map((f) => path.relative(ROOT, f)).sort();
}

const TEXT_EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json', '.md', '.sql', '.sh', '.py', '.css', '.csv', '.txt', '.yml', '.yaml', '.html'];

// ── stage 1: tests ───────────────────────────────────────────────────────────
//
// Vitest, with its JSON reporter, so the gate reads counts rather than
// scraping a terminal. Pass means failed 0, skipped 0, todo 0, AND every
// test FILE on disk was actually loaded and ran at least one real test. A
// file that throws on import or registers nothing is a failure, not a
// quiet absence.

function testFilesOnDisk() {
  return ownedFiles(['.ts', '.tsx']).filter((f) => f.startsWith('src/') && /\.test\.tsx?$/.test(f));
}

function stageTests() {
  const onDisk = testFilesOnDisk();
  const outFile = path.join(os.tmpdir(), `bridge-qa-vitest-${process.pid}.json`);
  const r = sh(BIN('vitest'), ['run', '--reporter=json', `--outputFile=${outFile}`], { env: { ...process.env, CI: '1' } });
  let data = null;
  try { data = JSON.parse(read(outFile)); } catch (e) { /* no report means the runner died */ }
  try { fs.unlinkSync(outFile); } catch (e) { /* fine */ }

  const problems = [];
  const failing = [];
  if (!data) {
    problems.push('vitest produced no JSON report: ' + (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' '));
    return { name: 'tests', result: 'fail', counts: { filesOnDisk: onDisk.length }, failing, problems };
  }

  const perFile = new Map(onDisk.map((f) => [f, 0]));
  const loaded = new Set();
  for (const t of data.testResults || []) {
    const rel = path.relative(ROOT, t.name);
    loaded.add(rel);
    const real = (t.assertionResults || []).length;
    perFile.set(rel, real);
    for (const a of t.assertionResults || []) {
      if (a.status === 'failed') failing.push(`${a.fullName} (${rel})`);
    }
    if (t.status === 'failed' && real === 0) failing.push(`${rel}: ${(t.message || 'failed to load').split('\n')[0]}`);
  }
  const counts = {
    pass: data.numPassedTests || 0,
    fail: data.numFailedTests || 0,
    skipped: data.numPendingTests || 0,
    todo: data.numTodoTests || 0,
    suitesFailed: data.numFailedTestSuites || 0,
    filesOnDisk: onDisk.length,
    filesLoaded: onDisk.filter((f) => loaded.has(f)).length
  };
  const missing = onDisk.filter((f) => !loaded.has(f));
  const empty = onDisk.filter((f) => loaded.has(f) && perFile.get(f) === 0);

  if (counts.fail) problems.push(`${counts.fail} failing`);
  if (counts.suitesFailed) problems.push(`${counts.suitesFailed} suite(s) failed`);
  if (counts.skipped) problems.push(`${counts.skipped} skipped`);
  if (counts.todo) problems.push(`${counts.todo} todo`);
  if (missing.length) problems.push(`${missing.length} test file(s) produced no result, so they did not load: ${missing.join(', ')}`);
  if (empty.length) problems.push(`${empty.length} test file(s) ran no tests: ${empty.join(', ')}`);
  if (r.status !== 0 && !problems.length) problems.push(`vitest exited ${r.status} with no failing test reported`);

  return {
    name: 'tests',
    result: problems.length ? 'fail' : 'pass',
    counts,
    filesNotLoaded: missing,
    filesWithNoTests: empty,
    testsPerFile: Object.fromEntries([...perFile].filter(([f]) => f.startsWith('src/'))),
    failing,
    problems
  };
}

// ── stage 2: build ───────────────────────────────────────────────────────────
//
// Vercel runs an install and `next build`. So a clean build means the
// lockfile resolves, the production build compiles, the built app boots and
// answers the sign-in screen, protected routes send a stranger to sign in,
// and the boot log said nothing alarming.
//
// Checked before this was written: the app does not exit when Supabase is
// unreachable. The session refresh asks Supabase who the visitor is, gets
// nobody, and redirects to /login. So the boot runs against
// qa/env.qa.example, which is placeholder values only, and the stage is not
// permanently red for want of credentials it should never have.

function qaEnv() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME || os.homedir(), NEXT_TELEMETRY_DISABLED: '1' };
  for (const line of read(path.join(__dirname, 'env.qa.example')).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function loadAllowlist() {
  const file = JSON.parse(read(path.join(__dirname, 'boot-allowlist.json')));
  const entries = Array.isArray(file.allow) ? file.allow : [];
  // Enforced in code, not in a comment: an allowlist may never be used to
  // silence a real error, and no entry is a pattern.
  for (const e of entries) {
    if (!e || typeof e.line !== 'string') throw new Error('boot-allowlist.json: every entry needs a "line"');
    if (!e.reason || !e.added) throw new Error(`boot-allowlist.json: entry needs a reason and a date: ${e.line}`);
    if (/[*?]/.test(e.line) && /wildcard|glob|regex/i.test(e.reason)) throw new Error(`boot-allowlist.json: no wildcards, exact lines only: ${e.line}`);
    if (/\b(Error|Unhandled)\b/.test(e.line)) {
      throw new Error(`boot-allowlist.json refuses this entry, an allowlist may not cover an error: ${e.line}`);
    }
  }
  return entries;
}

// A DeprecationWarning block is the warning line plus the indented stack
// frames under it. Ours if any frame points inside this repo and outside
// node_modules; otherwise it belongs to a dependency or to Node itself and
// is recorded as a warning rather than failing the stage.
function deprecations(logText) {
  const lines = logText.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/DeprecationWarning/.test(lines[i])) continue;
    const frames = [];
    for (let j = i + 1; j < lines.length && /^\s+at\s/.test(lines[j]); j++) frames.push(lines[j].trim());
    const ours = frames.some((f) => f.includes(ROOT) && !f.includes('node_modules'));
    out.push({ line: lines[i].trim(), ours, frames: frames.slice(0, 4) });
  }
  return out;
}

async function fetchStatus(url) {
  const r = await fetch(url, { redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location') || null };
}

// Starts the built app on a spare port, asks it the questions below, and
// kills the whole process group (next start forks a server child).
function bootProbe(port) {
  const env = { ...qaEnv(), PORT: String(port), NODE_OPTIONS: '--trace-deprecation' };
  const child = spawn(BIN('next'), ['start', '-p', String(port)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d; });
  child.stderr.on('data', (d) => { logs += d; });
  const started = Date.now();
  return (async () => {
    const deadline = started + 45000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/login`, { redirect: 'manual' });
        if (r.status > 0) { up = true; break; }
      } catch (e) { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    const answers = {};
    if (up) {
      for (const p of ['/login', '/login?mode=link', '/unauthorized', '/', '/org/qa-probe']) {
        try { answers[p] = await fetchStatus(`http://127.0.0.1:${port}${p}`); } catch (e) { answers[p] = { status: 0, error: e.message }; }
      }
    }
    await new Promise((r) => setTimeout(r, 500)); // let the log finish
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) { /* gone */ } }
    return { up, answers, logs, ms: Date.now() - started };
  })();
}

async function stageBuild() {
  const errors = [];
  const warnings = [];
  const allowlistFired = [];
  const allow = loadAllowlist();
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));

  // 1. Playwright is a devDependency only. The app never ships it, and the
  //    gate never imports it.
  if ((pkg.dependencies || {}).playwright || (pkg.dependencies || {})['@playwright/test']) errors.push('playwright is in dependencies; it belongs in devDependencies only');
  if (!(pkg.devDependencies || {}).playwright) warnings.push('playwright is not a devDependency; qa:preview will not run');
  // What the install would pull in. Recorded, not judged: Next needs
  // typescript, tailwind and postcss at build time, so a Vercel install
  // brings devDependencies with it. What matters is that nothing in them
  // downloads a browser on install, and playwright 1.63 has no install
  // script; the check below reads that from the installed package.
  try {
    const pw = JSON.parse(read(path.join(ROOT, 'node_modules', 'playwright', 'package.json')));
    const scripts = Object.keys(pw.scripts || {}).filter((k) => /install/.test(k));
    if (scripts.length) warnings.push(`playwright ${pw.version} has an install script (${scripts.join(', ')}): a Vercel install would run it`);
  } catch (e) { warnings.push('playwright is not installed here, so qa:preview cannot run on this machine'); }

  // 2. The lockfile resolves for the install Vercel performs.
  const ci = sh('npm', ['ci', '--dry-run', '--no-audit', '--no-fund', '--ignore-scripts']);
  if (ci.status !== 0) {
    errors.push('npm ci --dry-run failed: ' + (ci.stderr || '').trim().split('\n').slice(-3).join(' '));
    return { name: 'build', result: 'fail', boot: null, errors, warnings, deprecations: [], allowlistFired };
  }

  // 3. The production build compiles. Not the fixture build: FIXTURE_MODE is
  //    unset here on purpose, so what is checked is what Vercel would build.
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  delete env.FIXTURE_MODE;
  const build = sh(BIN('next'), ['build'], { env });
  if (build.status !== 0) {
    const tail = ((build.stdout || '') + '\n' + (build.stderr || '')).trim().split('\n').filter(Boolean).slice(-12);
    errors.push('next build failed');
    return { name: 'build', result: 'fail', boot: null, errors, warnings, deprecations: [], allowlistFired, buildTail: tail };
  }

  // 4. It boots on placeholder env and behaves like a fresh deploy with no
  //    session: sign-in renders, the rest redirects there.
  const port = 31000 + Math.floor(Math.random() * 9000);
  const probe = await bootProbe(port);
  if (!probe.up) {
    errors.push('the built app did not answer /login within 45s');
  } else {
    const expect = (p, status, redirectTo) => {
      const a = probe.answers[p];
      if (!a || a.status !== status) errors.push(`${p} answered ${a ? a.status : 'nothing'}, expected ${status}`);
      else if (redirectTo && !(a.location || '').endsWith(redirectTo)) errors.push(`${p} redirected to ${a.location}, expected ${redirectTo}`);
    };
    expect('/login', 200);
    expect('/login?mode=link', 200);
    expect('/unauthorized', 200);
    expect('/', 307, '/login');
    expect('/org/qa-probe', 307, '/login');
  }

  // 5. Nothing alarming in the boot log.
  const deps = deprecations(probe.logs);
  for (const d of deps) {
    if (d.ours) errors.push(`deprecation in our own code: ${d.line} :: ${d.frames[0] || 'no frame'}`);
    else warnings.push(`third party deprecation, recorded not failed: ${d.line}`);
  }
  const depLines = new Set(deps.map((d) => d.line));
  for (const raw of probe.logs.split('\n')) {
    const t = raw.trim();
    if (!t || !BAD_LOG.test(t)) continue;
    if (depLines.has(t)) continue;
    const hit = allow.find((e) => e.line === t); // exact match, by design
    if (hit) { allowlistFired.push({ line: hit.line, reason: hit.reason, added: hit.added }); continue; }
    errors.push(t);
  }

  return {
    name: 'build',
    result: errors.length ? 'fail' : 'pass',
    boot: { up: probe.up, answers: probe.answers, ms: probe.ms },
    errors,
    warnings,
    deprecations: deps.map((d) => ({ line: d.line, ours: d.ours })),
    allowlistFired
  };
}

// ── stage 3: lint, which here means the house rules ──────────────────────────
//
// No ESLint and no new dependency for it. The laws in src/laws/ already
// police the source under Vitest; this stage covers what they do not: the
// whole repo for em dashes and secrets, the test data rule, and the
// package layout.

const EM_DASH = new RegExp(String.fromCharCode(0x2014), 'g');

// Shapes of secrets, never values. Every rule reports which rule fired and
// in which file, never the matched text.
const SECRET_PATTERNS = [
  { rule: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { rule: 'supabase-secret-key', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { rule: 'jwt-token', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { rule: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { rule: 'anthropic-or-openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { rule: 'github-token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/ },
  { rule: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { rule: 'stripe-key', re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/ },
  { rule: 'vercel-token', re: /\bvercel_[A-Za-z0-9]{20,}/ },
  { rule: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  // An env assignment with a real looking value. Placeholders say so.
  { rule: 'env-assignment', re: /^\s*(export\s+)?[A-Z][A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*(?!.*(placeholder|not-a-real|example|<|\$\{|your[-_]))\S{16,}\s*$/m }
];

function scanForSecrets(files) {
  const hits = [];
  for (const f of files) {
    const body = read(path.join(ROOT, f));
    for (const p of SECRET_PATTERNS) if (p.re.test(body)) hits.push({ rule: p.rule, file: f });
  }
  return hits;
}

// The test data rule (Clemenza, 2026-09-20): minors appear by name and role
// only. No ages, no birthdates, no schools, no contact details, no photos.
// Applied to the fixture and to every SQL seed. An athlete record is the
// object between `athletes: [` and its closing bracket in the fixture, and
// an insert into athletes in a seed.
const MINOR_FIELDS = /^\s*(date_of_birth|dob|birth_date|birthdate|age|email|phone|phone_number|address|photo|photo_url|avatar|avatar_url|high_school|current_high_school)\s*:\s*(?!null\b|undefined\b)\S/;

function minorsCheck() {
  const findings = [];
  const fixture = 'src/testing/fixture.ts';
  if (fs.existsSync(path.join(ROOT, fixture))) {
    const lines = read(path.join(ROOT, fixture)).split('\n');
    let depth = 0, inAthletes = false, inCourses = false;
    for (const [i, line] of lines.entries()) {
      if (/^\s*athletes:\s*\[/.test(line)) { inAthletes = true; depth = 0; }
      if (/^\s*athlete_courses:\s*\[/.test(line)) { inCourses = true; depth = 0; }
      if (inAthletes || inCourses) {
        if (inAthletes && MINOR_FIELDS.test(line)) findings.push({ rule: 'minor-field', file: `${fixture}:${i + 1}`, detail: line.trim().split(':')[0] + ' on an athlete record' });
        if (inCourses && /\bschool_name:\s*"(?!")/.test(line)) findings.push({ rule: 'minor-school', file: `${fixture}:${i + 1}`, detail: 'a course row names the school a minor attends' });
        depth += (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length;
        if (depth <= 0 && /\]/.test(line)) { inAthletes = false; inCourses = false; }
      }
    }
  }
  for (const f of ownedFiles(['.sql'])) {
    const lines = read(path.join(ROOT, f)).split('\n');
    for (const [i, line] of lines.entries()) {
      if (/insert\s+into\s+athletes\b/i.test(line) && /\b(date_of_birth|email|phone|photo)\b/i.test(line)) {
        findings.push({ rule: 'minor-field', file: `${f}:${i + 1}`, detail: 'an athlete seed carries a birthdate, contact detail or photo column' });
      }
    }
  }
  return findings;
}

function stageLint() {
  const baseline = JSON.parse(read(path.join(__dirname, 'baseline.json')));
  const findings = [];
  const text = ownedFiles(TEXT_EXTS).filter((f) => !f.startsWith('qa/previews/'));

  // Rule 1: no em dashes anywhere. THE BASELINE IS A RATCHET WITH TEETH
  // (Clemenza, 2026-09-20): a file this change touched must be zero,
  // baselined or not; an untouched baselined file must match its recorded
  // count exactly; everything else must be zero.
  const emBase = baseline.emDash || {};
  const touched = changedFiles();
  const burndown = [];
  for (const f of text) {
    const n = (read(path.join(ROOT, f)).match(EM_DASH) || []).length;
    const recorded = emBase[f];
    const isTouched = touched.has(f);
    if (isTouched) {
      if (n > 0) {
        findings.push({
          rule: 'no-em-dash', file: f,
          detail: recorded !== undefined
            ? `${n} em dashes in a file this change touched. A baselined file loses its grandfathering the moment you edit it: clean all ${n} or leave the file alone.`
            : `${n} em dashes in a file this change touched.`
        });
      } else if (recorded !== undefined) {
        burndown.push({ file: f, was: recorded, now: 0, note: 'cleaned, remove it from baseline.json' });
      }
      continue;
    }
    if (recorded === undefined) {
      if (n > 0) findings.push({ rule: 'no-em-dash', file: f, detail: `${n} em dashes.` });
      continue;
    }
    if (n > recorded) findings.push({ rule: 'no-em-dash', file: f, detail: `${n} em dashes, baseline records ${recorded}, so ${n - recorded} were added.` });
    else if (n < recorded) burndown.push({ file: f, was: recorded, now: n, note: 'lower the baseline to match' });
  }

  // Rule 2: no secret anywhere the repo owns, reports included. The repo is
  // going public; keys live in environment config only.
  for (const h of scanForSecrets(text)) findings.push({ rule: 'no-secret-in-source', file: h.file, detail: `matched the shape ${h.rule}` });

  // Rule 3: no .only in a test, which silently shrinks a run to one case.
  for (const f of testFilesOnDisk()) {
    if (/\b(test|describe|it)\.only\(/.test(read(path.join(ROOT, f)))) findings.push({ rule: 'no-only', file: f, detail: '.only would hide every other test in the file' });
  }

  // Rule 4: the test data rule.
  for (const m of minorsCheck()) findings.push(m);

  // Rule 5: the allowlist file is well formed even when the build stage did
  // not get as far as reading it.
  try { loadAllowlist(); } catch (e) { findings.push({ rule: 'boot-allowlist', file: 'qa/boot-allowlist.json', detail: e.message }); }

  return {
    name: 'lint',
    result: findings.length ? 'fail' : 'pass',
    findings,
    baselined: emBase,
    baselineTotal: Object.values(emBase).reduce((a, b) => a + b, 0),
    burndown,
    touchedFiles: touched.size,
    filesScanned: text.length
  };
}

// ── stage 4: types ───────────────────────────────────────────────────────────

function stageTypes() {
  const r = sh(BIN('tsc'), ['--noEmit']);
  return { name: 'types', result: r.status === 0 ? 'pass' : 'fail', output: r.status === 0 ? [] : (r.stdout || '').trim().split('\n').slice(0, 40) };
}

// ── the manual checklist ─────────────────────────────────────────────────────
//
// qa/checklist.md is filled by hand. It covers HEAD when its Commit line is
// HEAD or HEAD's parent (a checklist is committed with its change, so it
// cannot name the commit it is part of). Anything else is some other
// change's checklist, and the verdict is provisional with the reason said.

function manualVerdict(head, parent) {
  const file = path.join(__dirname, 'checklist.md');
  if (!fs.existsSync(file)) return { checklist: null, result: 'provisional', reason: 'no qa/checklist.md' };
  const body = read(file);
  const commit = (body.match(/^Commit:\s*([0-9a-f]{7,40})/m) || [])[1] || null;
  const says = (body.match(/^Result:\s*(pass|fail)/mi) || [])[1] || null;
  const short = (s) => (s ? s.slice(0, 7) : null);
  const covers = commit && (head.startsWith(commit) || parent.startsWith(commit) || commit.startsWith(short(head)) || commit.startsWith(short(parent)));
  if (!says) return { checklist: 'qa/checklist.md', checklistCommit: short(commit), checklistSays: null, result: 'provisional', reason: 'the checklist has no Result line' };
  if (!covers) return { checklist: 'qa/checklist.md', checklistCommit: short(commit), checklistSays: says.toLowerCase(), result: 'provisional', reason: `checklist.md is for commit ${short(commit)}, not this one` };
  return { checklist: 'qa/checklist.md', checklistCommit: short(commit), checklistSays: says.toLowerCase(), result: says.toLowerCase(), reason: `checklist.md covers this commit and says ${says.toLowerCase()}` };
}

// ── run ──────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
  const stages = [];

  const order = [stageTests, stageBuild, stageLint, stageTypes];
  for (const runStage of order) {
    const stage = await runStage();
    stages.push(stage);
    const mark = stage.result === 'pass' ? 'PASS' : stage.result === 'not_applicable' ? 'N/A ' : 'FAIL';
    process.stdout.write(`${mark}  ${stage.name}\n`);
    if (stage.result === 'fail') break;
  }

  const failed = stages.some((s) => s.result === 'fail');
  const notRun = order.length - stages.length;
  const fired = stages.flatMap((s) => s.allowlistFired || []);
  const head = git('rev-parse', 'HEAD') || '';
  const parent = git('rev-parse', 'HEAD~1') || '';
  const onMain = sh('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']).status === 0;

  // The preview block survives from the last run when it was for this same
  // commit, so running the gate after the preview does not erase the shots
  // it recorded. Any other commit starts blank.
  let preview = { applicable: null, files: [] };
  try {
    const prev = JSON.parse(read(path.join(REPORTS, 'latest.json')));
    if (prev.commitFull === head && prev.preview && prev.preview.files && prev.preview.files.length) preview = prev.preview;
  } catch (e) { /* first run */ }

  const report = {
    repo: 'bridge-app',
    version: pkg.version,
    commit: head.slice(0, 7) || null,
    commitFull: head || null,
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: (git('status', '--porcelain') || '') !== '',
    onMain,
    startedAt,
    durationMs: Date.now() - t0,
    result: failed ? 'fail' : 'pass',
    stagesNotRun: notRun,
    allowlistFired: fired,
    stages,
    manual: manualVerdict(head, parent),
    preview
  };

  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(path.join(REPORTS, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(REPORTS, startedAt.replace(/[:.]/g, '-') + '.json'), JSON.stringify(report, null, 2) + '\n');

  process.stdout.write(`\n${report.result.toUpperCase()}  ${report.commit || 'no commit'}  ${report.durationMs}ms\n`);
  if (notRun) process.stdout.write(`stopped early, ${notRun} stage(s) not run\n`);
  if (fired.length) process.stdout.write(`boot allowlist covered ${fired.length} line(s), listed in the report\n`);
  process.stdout.write('qa/reports/latest.json\n');
  if (report.result === 'pass') {
    process.stdout.write('\nNot done yet: fill qa/checklist.md by hand, and run npm run qa:preview -- <task> if this change has a screen.\n');
  }

  // Then the evidence leaves for the artifacts repo, pass or fail, so the
  // reviewer who cannot read this repo sees the same thing Dave does. The
  // publisher gates itself on a secret scan of the exact bytes it sends.
  // Its outcome is printed, not folded into this exit code: a push that
  // could not reach GitHub is a delivery problem, and the gate's verdict on
  // the code stands on its own.
  if (process.env.QA_PUBLISH !== '0') {
    process.stdout.write('\n');
    const pub = sh(process.execPath, [path.join(__dirname, 'publish.js')], { stdio: 'inherit' });
    if (pub.status !== 0) process.stdout.write('(the gate result above is unchanged by this)\n');
  }
  process.exit(report.result === 'pass' ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write('qa:check crashed: ' + (e && e.stack ? e.stack : e) + '\n');
  process.exit(1);
});
