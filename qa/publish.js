#!/usr/bin/env node
// qa/publish.js, pushes QA artifacts to the shared artifacts repo.
//
// Same shape as jarvis-backend/qa/publish.js. Clemenza cannot read a
// private repo and Dave is not a courier. So at the end of every qa:check
// run the evidence goes to one PUBLIC repo that holds artifacts only: the
// report, the filled checklist, GAPS.md and any previews. Never source,
// never config, never an env file, never a secret.
//
// Layout in that repo: /bridge-app/<YYYY-MM-DD>-<task>/
//   report.json     qa/reports/latest.json as it was at the end of the run
//   checklist.md    qa/checklist.md
//   gaps.md         qa/GAPS.md
//   previews/       qa/previews/<task>/*.png when they exist
//
// The push is GATED on a secret scan of the exact bytes about to leave. Not
// the lint stage's scan of the repo: that one runs on source and only when
// the earlier stages passed, and a failing run is evidence Clemenza needs
// too. So this file scans what it is about to publish, every time, and
// refuses on any hit. It also refuses when the report's own lint stage
// recorded a secret finding, and when the report describes a dirty tree,
// because evidence that matches no commit is worse than none. A refusal is
// printed with the rule that fired and never the value.
//
// Nothing here knows any protected person by name. Those live in
// qa/publish-deny.txt, which is gitignored and local, one term per line.
//
// Run: npm run qa:publish            (check.js calls this at the end of a run)
//      QA_PUBLISH=0 npm run qa:check  to skip the push for one run
//
// Configuration, all optional:
//   QA_PUBLISH_REPO   git URL of the artifacts repo
//   QA_PUBLISH_DIR    where the local clone lives
//   QA_TASK           task name for the folder; defaults to the preview's
//                     change name, else "unnamed"
//   QA_PUBLISH_DRY_RUN=1  stage the folder and scan, but do not push

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO_NAME = 'bridge-app';
const REPO_URL = process.env.QA_PUBLISH_REPO || 'https://github.com/davefisher813/basecode-qa.git';
const CLONE = process.env.QA_PUBLISH_DIR || path.join(os.tmpdir(), 'basecode-qa');
const DENY_FILE = path.join(__dirname, 'publish-deny.txt');
const DRY = process.env.QA_PUBLISH_DRY_RUN === '1';

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

function git(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

// ── what goes ────────────────────────────────────────────────────────────────

function collect() {
  const reportPath = path.join(__dirname, 'reports', 'latest.json');
  if (!exists(reportPath)) throw new Error('no qa/reports/latest.json to publish; run qa:check first');
  const report = JSON.parse(read(reportPath));

  const task = (process.env.QA_TASK || (report.preview && report.preview.change) || 'unnamed').replace(/[^a-z0-9._-]/gi, '-');
  const date = String(report.startedAt || new Date().toISOString()).slice(0, 10);

  const files = [{ to: 'report.json', from: reportPath, text: true }];
  if (exists(path.join(__dirname, 'checklist.md'))) files.push({ to: 'checklist.md', from: path.join(__dirname, 'checklist.md'), text: true });
  if (exists(path.join(__dirname, 'GAPS.md'))) files.push({ to: 'gaps.md', from: path.join(__dirname, 'GAPS.md'), text: true });
  const previews = path.join(__dirname, 'previews', task);
  if (exists(previews)) {
    for (const f of fs.readdirSync(previews).filter((f) => f.endsWith('.png')).sort()) {
      files.push({ to: path.join('previews', f), from: path.join(previews, f), text: false });
    }
  }
  return { report, task, date, files };
}

// ── the gate ─────────────────────────────────────────────────────────────────
//
// Every rule reports WHICH rule fired and in WHICH file, never the matched
// text. A refusal that echoed the secret would be a second leak.

function envSecrets() {
  const out = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!/(SECRET|KEY|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)/i.test(k)) continue;
    if (typeof v === 'string' && v.length >= 8) out.push({ name: k, value: v });
  }
  return out;
}

function denyTerms() {
  if (!exists(DENY_FILE)) return [];
  return read(DENY_FILE).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

const PATTERNS = [
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
  { rule: 'env-assignment', re: /^\s*(export\s+)?[A-Z][A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*(?!.*(placeholder|not-a-real|example|<|\$\{|your[-_]))\S{16,}\s*$/m }
];

function scan(files, report) {
  const hits = [];
  const secrets = envSecrets();
  const deny = denyTerms();

  for (const f of files) {
    if (!f.text) continue;
    const body = read(f.from);
    for (const p of PATTERNS) if (p.re.test(body)) hits.push({ rule: p.rule, file: f.to });
    for (const s of secrets) {
      if (body.includes(s.value)) hits.push({ rule: 'value-of-env-' + s.name, file: f.to });
    }
    const lower = body.toLowerCase();
    deny.forEach((term, i) => {
      if (lower.includes(term.toLowerCase())) hits.push({ rule: `denied-term-${i + 1}-of-${deny.length}`, file: f.to });
    });
  }

  const lint = (report.stages || []).find((s) => s.name === 'lint');
  if (lint) {
    for (const f of lint.findings || []) {
      if (/secret/i.test(f.rule || '')) hits.push({ rule: 'lint-stage-' + f.rule, file: f.file });
    }
  }
  return { hits, denyCount: deny.length, envCount: secrets.length };
}

// ── the push ─────────────────────────────────────────────────────────────────

const ARTIFACTS_README = `# basecode-qa

**This repository is PUBLIC.** It holds QA artifacts only, so that a reviewer
who cannot read a private repo can still read its evidence.

What is here, per repo and per change, at \`/<repo-name>/<YYYY-MM-DD>-<task>/\`:

- \`report.json\`, the machine gate's report for that run
- \`checklist.md\`, the filled manual walkthrough
- \`gaps.md\`, what that repo's suite does not protect, at that point in time
- \`previews/\`, phone width screenshots when the change had a screen

What is never here: source code, configuration, environment files, keys,
tokens, or any secret. The publisher scans every byte before it pushes and
refuses on a hit. **Anything secret found in this repo is a defect. Report it,
do not commit around it, and rotate what leaked.**

Pushes come from \`qa/publish.js\` in each repo at the end of its \`qa:check\`
run. Nothing here is edited by hand.
`;

function ensureClone() {
  if (exists(path.join(CLONE, '.git'))) {
    const r = git(CLONE, 'pull', '--ff-only', '--quiet');
    if (r.status !== 0 && !/couldn't find remote ref|no such ref|no tracking information/i.test(r.stderr || '')) {
      throw new Error('could not update the artifacts clone: ' + (r.stderr || '').trim());
    }
    return;
  }
  fs.mkdirSync(path.dirname(CLONE), { recursive: true });
  const r = git(ROOT, 'clone', '--quiet', '--depth', '50', REPO_URL, CLONE);
  if (r.status !== 0) throw new Error('could not clone ' + REPO_URL + ': ' + (r.stderr || '').trim());
  if (git(CLONE, 'rev-parse', '--verify', '--quiet', 'HEAD').status !== 0) git(CLONE, 'checkout', '--quiet', '-B', 'main');
}

function stage({ report, task, date, files }, base) {
  const readme = path.join(base, 'README.md');
  if (!exists(readme)) { fs.mkdirSync(base, { recursive: true }); fs.writeFileSync(readme, ARTIFACTS_README); }
  const dest = path.join(base, REPO_NAME, `${date}-${task}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.join(dest, 'previews'), { recursive: true });
  for (const f of files) fs.copyFileSync(f.from, path.join(dest, f.to));
  if (!fs.readdirSync(path.join(dest, 'previews')).length) fs.rmdirSync(path.join(dest, 'previews'));
  return { dest, rel: path.relative(base, dest), msg: `${REPO_NAME} ${date} ${task}: ${String(report.result || 'unknown').toUpperCase()} at ${report.commit || 'no commit'}` };
}

function push(bundle) {
  ensureClone();
  const { rel, msg } = stage(bundle, CLONE);
  git(CLONE, 'add', '-A', rel, 'README.md');
  const c = git(CLONE, '-c', 'user.name=qa-publish', '-c', 'user.email=qa-publish@users.noreply.github.com', 'commit', '--quiet', '-m', msg);
  if (c.status !== 0 && !/nothing to commit/.test(c.stdout + c.stderr)) throw new Error('commit failed: ' + (c.stderr || '').trim());
  const p = git(CLONE, 'push', '--quiet', '-u', 'origin', 'HEAD');
  if (p.status !== 0) throw new Error('push failed: ' + (p.stderr || '').trim());
  return { path: rel, files: bundle.files.map((f) => f.to) };
}

// ── run ──────────────────────────────────────────────────────────────────────

function main() {
  const bundle = collect();
  const { hits, denyCount, envCount } = scan(bundle.files, bundle.report);

  if (hits.length) {
    process.stdout.write(`PUBLISH REFUSED: the secret scan hit ${hits.length} time(s). Nothing was pushed.\n`);
    for (const h of hits) process.stdout.write(`  ${h.rule}  in ${h.file}\n`);
    process.stdout.write('Values are never printed. Fix the source of the hit, rerun qa:check, and it will publish.\n');
    process.exit(2);
  }

  if (bundle.report.dirty) {
    process.stdout.write(`PUBLISH REFUSED: the report is from a dirty tree at ${bundle.report.commit || 'no commit'}. Nothing was pushed.\n`);
    process.stdout.write('Commit first, rerun qa:check on the clean tree, and the report will name the commit it describes.\n');
    process.exit(4);
  }

  process.stdout.write(`publish scan clean: ${bundle.files.length} file(s), ${PATTERNS.length} patterns, ${envCount} env value(s), ${denyCount} denied term(s)\n`);
  if (!denyCount) process.stdout.write('  note: qa/publish-deny.txt is absent or empty, so no protected term was checked\n');

  if (DRY) {
    const base = path.join(os.tmpdir(), 'basecode-qa-dry-run');
    fs.rmSync(base, { recursive: true, force: true });
    const s = stage(bundle, base);
    process.stdout.write(`dry run: staged ${s.rel}/ under ${base}, commit message would be "${s.msg}". Nothing was pushed.\n`);
    return;
  }

  try {
    const r = push(bundle);
    process.stdout.write(`published ${r.path}/ (${r.files.join(', ')}) to ${REPO_URL}\n`);
  } catch (e) {
    process.stdout.write(`PUBLISH FAILED: ${e.message}\nThe scan passed; this is delivery, not a leak. The artifacts are still in qa/ locally.\n`);
    process.exit(3);
  }
}

if (require.main === module) main();

module.exports = { collect, scan, PATTERNS };
