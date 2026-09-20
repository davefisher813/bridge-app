import path from "node:path";
import type { NextConfig } from "next";

// FIXTURE_MODE=1 builds the real app on the test fixture instead of
// Supabase, so it can be opened in a browser from a machine that cannot
// reach the database. Only the two seams are swapped; every page, form,
// font and client component is the shipped one. Vercel never sets it.
const fixture = process.env.FIXTURE_MODE === "1";
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
  turbopack: { resolveAlias: turbopackAliases },
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, ...webpackAliases };
    return config;
  },
};

export default nextConfig;
