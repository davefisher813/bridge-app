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
    root: path.resolve(__dirname, "../.."),
  },
});
