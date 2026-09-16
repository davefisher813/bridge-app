#!/usr/bin/env bash
# Regenerates every preview artifact and the functional test bench from the
# CURRENT state of the repo.
#
# Per Dave (2026-09): "I need a preview for everything we build it should be
# automatic once you complete it." So this runs after a feature is finished,
# not when someone remembers. Every generator reads the real compiled CSS and
# parses the real colour maps, and the bench bundles the real modules, so a
# preview that disagrees with the app is a bug in the generator rather than
# something to eyeball.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Compiling the app's own CSS"
npx tailwindcss -i src/app/globals.css -o /tmp/preview.css --minify 2>&1 | tail -1

echo "==> Full app preview"
python3 scripts/build_preview.py

echo "==> Doc AI upload preview"
python3 scripts/build_docai_preview.py

echo "==> Eligibility screen preview"
python3 scripts/build_eligibility_preview.py

echo "==> Bundling the real modules for the test bench"
npx esbuild scripts/testbench_entry.ts --bundle --format=iife --target=es2020 --minify \
  --outfile=/tmp/testbench.min.js 2>&1 | tail -1

echo "==> Functional test bench"
python3 scripts/build_testbench.py

echo "==> Checking the bench's own assertions actually pass in a browser"
node scripts/verify_testbench.mjs

echo "==> Done. Publish the HTML files above as artifacts."
