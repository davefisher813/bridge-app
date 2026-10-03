import path from "node:path";
import { defineConfig } from "vitest/config";

// src/lib/data/fitAdapters.ts (and future non-fit modules) import via the
// "@/" alias, same as tsconfig.json's paths mapping used by the app and
// Next.js's bundler. Vitest doesn't read tsconfig paths on its own, so it
// needs the same mapping here or those imports fail to resolve in tests.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The default is 5 seconds. The first test in a file that renders a page
    // or an action pays for compiling the app's modules, which on a cold
    // machine or a busy one runs past that: four laws timed out at exactly
    // 5000ms on a run where every one of them passes in well under a second
    // once warm. A slow first import is not a failure, so allow for it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
