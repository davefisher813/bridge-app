import path from "node:path";
import { defineConfig } from "vitest/config";

// The preview builder runs under vitest rather than tsx because it needs
// vi.mock to stand in for next/headers, next/navigation and the Supabase
// client, exactly as src/laws/pageRender.test.ts does. Same alias, its
// own include, so `npm test` never writes a file.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/preview/build_app_preview.ts"],
    // One test renders every screen in both themes; past 120 screens it
    // runs longer than vitest's 5 second default (6.6s on Oct 13).
    testTimeout: 60_000,
    root: path.resolve(__dirname, "../.."),
  },
});
