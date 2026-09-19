import type { Config } from "tailwindcss";

// The scale Dave locked on 2026-09-19 (docs/STYLING_CATALOG.md, "The
// kit"). This file REPLACES Tailwind's defaults rather than extending
// them, so a size, a radius or a spacing step outside the scale has no
// class to reach for: `text-[15px]` is forbidden by src/laws/kitLaws.test.ts
// and `text-sm` simply does not exist. Fourteen font sizes, seven radii
// and seventeen paddings were in use the day this was written; that is
// what the replacement is for.

// Four text sizes. Body is 16px because iPhone Safari zooms the page on
// any focused input smaller than that, which was the single biggest
// source of the "sliding" Dave saw.
type Theme = NonNullable<Config["theme"]>;

const fontSize: Theme["fontSize"] = {
  label: ["13px", { lineHeight: "16px" }],
  body: ["16px", { lineHeight: "22px" }],
  heading: ["20px", { lineHeight: "26px" }],
  title: ["28px", { lineHeight: "34px" }],
};

// 12 / 16 / 24 as the working steps, with 4 and 8 for the gaps inside a
// row and 44 / 48 / 56 for touch targets. Nothing else exists.
const spacing: Theme["spacing"] = {
  0: "0px",
  px: "1px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  6: "24px",
  8: "32px",
  11: "44px",
  12: "48px",
  14: "56px",
  16: "64px",
  20: "80px",
  24: "96px",
};

// One radius. `full` is for avatars and dots.
const borderRadius: Theme["borderRadius"] = {
  none: "0px",
  DEFAULT: "12px",
  full: "9999px",
};

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
    fontSize,
    spacing,
    borderRadius,
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
