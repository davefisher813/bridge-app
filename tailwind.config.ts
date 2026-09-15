import type { Config } from "tailwindcss";

// Palette is a placeholder. Real org branding (Bridge red/gold, Elite Squad's
// own colors, etc.) is applied per org via the org config, not hardcoded here.
// See docs/DESIGN_SYSTEM.md.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        bg: "var(--bg)",
        paper: "var(--paper)",
        muted: "var(--muted)",
        line: "var(--line)",
        accent: "var(--accent)",
        success: "var(--success)",
        danger: "var(--danger)",
        info: "var(--info)",
        // Solid fill pairs for pills, badges, group tabs and toasts.
        // Always used as a pair: bg-solid-accent with text-solid-accent-on,
        // never a fill with some other foreground. See globals.css and
        // docs/STYLING_CATALOG.md.
        solid: {
          accent: "var(--solid-accent)",
          "accent-on": "var(--solid-accent-on)",
          success: "var(--solid-success)",
          "success-on": "var(--solid-success-on)",
          info: "var(--solid-info)",
          "info-on": "var(--solid-info-on)",
          neutral: "var(--solid-neutral)",
          "neutral-on": "var(--solid-neutral-on)",
          time: "var(--solid-time)",
          "time-on": "var(--solid-time-on)",
          people: "var(--solid-people)",
          "people-on": "var(--solid-people-on)",
          place: "var(--solid-place)",
          "place-on": "var(--solid-place-on)",
        },
        // Tint pairs for surfaces that sit beside a solid one: stat tiles
        // and group tabs. Same pairing rule as the solids.
        tint: {
          accent: "var(--tint-accent)",
          "accent-on": "var(--tint-accent-on)",
          success: "var(--tint-success)",
          "success-on": "var(--tint-success-on)",
          info: "var(--tint-info)",
          "info-on": "var(--tint-info-on)",
          neutral: "var(--tint-neutral)",
          "neutral-on": "var(--tint-neutral-on)",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
