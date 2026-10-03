#!/usr/bin/env bash
# The app the browser tests drive: the real Next app on the in-memory
# fixture (FIXTURE_MODE), keeping what a test writes between screens
# (FIXTURE_PERSIST), with the stand-in where the AI model would be.
#
# Nothing here can reach Supabase, an email service or Anthropic:
#   - the fixture build swaps both Supabase seams and the model caller
#     (next.config.ts), so those modules are not in the bundle at all;
#   - ANTHROPIC_API_KEY is a placeholder that only switches the app to its
#     "a model is connected" path (a real key in the environment is
#     overwritten);
#   - the Supabase URL points at a port nothing listens on, and the one
#     browser call that would use it (the document upload to Storage) is
#     intercepted by the tests.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "${VERCEL:-}" = "1" ] || [ -n "${VERCEL_ENV:-}" ]; then
  echo "refusing to build a fixture app on Vercel" >&2
  exit 1
fi

PORT="${E2E_PORT:-3120}"
export FIXTURE_MODE=1
export FIXTURE_PERSIST=1
export ANTHROPIC_API_KEY="e2e-fixture-not-a-real-key"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="fixture-placeholder-anon"

if [ "${E2E_SKIP_BUILD:-0}" != "1" ] || [ ! -d .next ]; then
  npx next build
fi
exec npx next start -p "$PORT"
