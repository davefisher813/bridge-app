import type { Config } from "tailwindcss";

// Colors come in two tiers, matching src/app/globals.css. `ios` is the
// palette (Apple's system colors, the only real colors in the app) and
// `solid` / `tint` are what they mean here, each a contrast-checked pair.
// A pair is always used together: bg-solid-offer with text-solid-offer-on,
// never a fill with some other foreground. src/laws/stylingLaws.test.ts
// enforces that.
const ROLES = [
  "target",
  "contact",
  "visit",
  "offer",
  "committed",
  "high",
  "mid",
  "low",
  "time",
  "people",
  "place",
  "accent",
  "danger",
  "neutral",
] as const;

const pairs = (prefix: "solid" | "tint") =>
  Object.fromEntries(
    ROLES.flatMap((r) => [
      [r, `var(--${prefix}-${r})`],
      [`${r}-on`, `var(--${prefix}-${r}-on)`],
    ])
  );

const IOS = [
  "red",
  "orange",
  "yellow",
  "green",
  "mint",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "purple",
  "pink",
  "brown",
  "gray",
] as const;

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
        ios: Object.fromEntries(IOS.map((n) => [n, `var(--ios-${n})`])),
        solid: pairs("solid"),
        tint: pairs("tint"),
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
