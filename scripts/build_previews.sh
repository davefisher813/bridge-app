#!/usr/bin/env bash
# Regenerates the app preview and the functional test bench from the
# CURRENT state of the repo, and fails if either disagrees with a browser.
#
# Per Dave (2026-09): "I need a preview for everything we build it should be
# automatic once you complete it." So this runs after a feature is finished,
# not when someone remembers.
#
# Since the clean slate (2026-09-19) the preview is not a mockup: it is
# every page in src/testing/pages.ts rendered by the page code itself, on
# the fixture, with the app's compiled stylesheet, so it cannot drift from
# the app. The bench bundles the real engine modules and runs them in the
# page. The audit inspects what the browser computed on every screen in
# both themes.
#
# Env: PREVIEW_OUT_DIR (default /tmp/previews), PW_CHROMIUM (optional
# executable for the browser scripts).
set -euo pipefail
cd "$(dirname "$0")/.."

export PREVIEW_OUT_DIR="${PREVIEW_OUT_DIR:-/tmp/previews}"
mkdir -p "$PREVIEW_OUT_DIR"

echo "==> Compiling the app's own CSS"
npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify 2>&1 | tail -1

echo "==> App preview, rendered from the real pages"
npx vitest run --config scripts/preview/vitest.config.mts 2>&1 | grep -E "wrote|Tests|FAIL|Error" || true
test -s "$PREVIEW_OUT_DIR/app_preview.html"

echo "==> Bundling the real modules for the test bench"
npx esbuild scripts/testbench_entry.ts --bundle --format=iife --target=es2020 --minify \
  --outfile=/tmp/testbench.min.js 2>&1 | tail -1

echo "==> Functional test bench"
python3 scripts/build_testbench.py

echo "==> Checking the bench's own assertions actually pass in a browser"
node scripts/verify_testbench.mjs

echo "==> Auditing every screen of the preview in both themes"
node scripts/audit_preview.mjs

echo "==> Done. Publish $PREVIEW_OUT_DIR/app_preview.html and test_bench.html as artifacts."
