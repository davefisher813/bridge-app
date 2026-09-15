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
  },
});
