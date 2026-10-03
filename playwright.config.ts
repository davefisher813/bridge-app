import { defineConfig, devices } from "@playwright/test";

// Browser tests for the flows that matter most: signing in with a magic
// link, reading a document through to Apply, matching, and the fundraising
// records. They drive the real app in a real browser.
//
// What they run against: the app built with FIXTURE_MODE=1 and
// FIXTURE_PERSIST=1 (scripts/e2e/serve.sh). The two Supabase seams are
// swapped for the in-memory fixture and the model for the stand-in, so the
// whole thing runs on a laptop or in CI with no database, no email and no
// AI account, and cannot spend anything. A record a test creates is still
// there on the next screen (FIXTURE_PERSIST), so create, edit and remove
// are real round trips. It is not a test of Supabase itself: row-level
// security is src/laws and scripts/rls_test.sql, and a real session is
// Supabase's.
//
//   npm run e2e                       builds the fixture app, starts it, runs
//   E2E_SKIP_BUILD=1 npm run e2e      reuses an existing .next build
//   E2E_BASE_URL=http://host:3120 npm run e2e
//                                     runs against a fixture server that is
//                                     already up (it must be a FIXTURE_PERSIST
//                                     build; a deployed app will not do)
//   PW_CHROMIUM=/path/to/chromium     use that browser instead of Playwright's
//
// One worker and no parallelism: the fixture is one shared dataset.

const port = Number(process.env.E2E_PORT ?? 3120);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    // The phone first: iPhone width, touch, the app's own breakpoint.
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: ["--no-sandbox"],
    },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "bash scripts/e2e/serve.sh",
        url: `${baseURL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 600_000,
        stdout: "pipe",
      },
});
