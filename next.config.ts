import path from "node:path";
import type { NextConfig } from "next";

// FIXTURE_MODE=1 builds the real app on the test fixture instead of
// Supabase, so it can be opened in a browser from a machine that cannot
// reach the database. Only the two seams are swapped; every page, form,
// font and client component is the shipped one.
const fixture = process.env.FIXTURE_MODE === "1";

// A fixture build signs every visitor in as the fixture owner with no
// auth, so it must never be what a deployment serves. Vercel sets
// VERCEL=1 (and VERCEL_ENV) on every build it runs. A NODE_ENV check
// would not do: scripts/live/check.sh runs `next start`, which is
// production mode, on purpose. The same stop is repeated at runtime in
// src/testing/fixtureServer.ts.
if (fixture && (process.env.VERCEL === "1" || process.env.VERCEL_ENV)) {
  throw new Error("FIXTURE_MODE must never be set on a Vercel build");
}
const seams: Record<string, string> = fixture
  ? {
      "@/lib/supabase/server": "src/testing/fixtureServer.ts",
      "@/lib/supabase/middleware": "src/testing/fixtureMiddleware.ts",
    }
  : {};

const turbopackAliases = Object.fromEntries(
  Object.entries(seams).map(([from, to]) => [from, `./${to}`])
);
const webpackAliases = Object.fromEntries(
  Object.entries(seams).map(([from, to]) => [from, path.resolve(__dirname, to)])
);

const nextConfig: NextConfig = {
  // The short address people try for the Campaigns screen, which lives
  // under Fundraising with the rest of the money screens.
  async redirects() {
    return [{ source: "/org/:slug/campaigns", destination: "/org/:slug/fundraising/campaigns", permanent: false }];
  },
  turbopack: { resolveAlias: turbopackAliases },
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, ...webpackAliases };
    return config;
  },
};

export default nextConfig;
