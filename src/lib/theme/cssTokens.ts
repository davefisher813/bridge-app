// The colour tokens, read out of src/app/globals.css by the few server
// files that need a literal colour and cannot use a CSS variable: the
// viewport theme colour, the web app manifest and the generated icons.
//
// Read from the stylesheet rather than copied, for the reason
// src/laws/stylingLaws.test.ts gives: a copy drifts and a literal is a
// second source of truth. This is server-only and runs at build time.

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Theme = "light" | "dark";

let cache: Record<Theme, Record<string, string>> | null = null;

function parse(): Record<Theme, Record<string, string>> {
  if (cache) return cache;
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(selector);
    if (start < 0) return "";
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}") depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
    return "";
  };
  const tokens = (body: string) => {
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
  };
  const light = tokens(block(":root"));
  const dark = { ...light, ...tokens(block('[data-theme="dark"]')) };
  cache = { light, dark };
  return cache;
}

export function cssToken(name: string, theme: Theme = "light"): string {
  const value = parse()[theme][name];
  if (!value) throw new Error(`globals.css has no --${name} token for the ${theme} theme`);
  return value;
}
