// The app preview, rendered from the real pages.
//
// Until 2026-09-19 the previews were six Python generators and a 2,700
// line prototype, each a second implementation of the screens with its
// own copy of the markup. They drifted from the app three times in one
// sitting even after they were taught to parse the colour maps, because
// the markup itself was still a copy. The clean slate retired them.
//
// This renders every page in src/testing/pages.ts, the same list the
// render law executes, with the same fake Supabase client and fixture,
// and writes the output into one HTML file with the app's own compiled
// stylesheet. Every screen is the page code's actual output on fixture
// data. A link between screens works because every screen the fixture
// can reach is in the file. What is not here cannot drift.
//
// Run: PREVIEW_OUT_DIR=... npx vitest run --config scripts/preview/vitest.config.mts
// (build_previews.sh does this after compiling the CSS to /tmp/preview.css)

import { parseBranding } from "@/lib/org/branding";
import { it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { buildFixture, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient } from "@/testing/fakeSupabase";
import { PAGES, p, routeFor } from "@/testing/pages";

let currentPath = "/";

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error("NEXT_REDIRECT:" + url);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => currentPath,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(buildFixture(), { userId: OWNER_ID }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("a page reached for the service-role client");
  },
}));

type PageFn = (props: Record<string, unknown>) => Promise<ReactNode>;

async function renderPage(modulePath: string, props: Record<string, unknown>): Promise<ReactNode> {
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: PageFn };
  return mod.default(props);
}

const OUT_DIR = process.env.PREVIEW_OUT_DIR ?? "/tmp/previews";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

it("builds the app preview from the real pages", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Chrome } = await import("@/components/kit");
  const css = readFileSync("/tmp/preview.css", "utf8");
  // The app's own font, embedded, so the preview measures text the way
  // the phone does. Without it the preview fell back to a narrower
  // system face and hid every overflow that Inter causes.
  const inter = readFileSync("src/app/fonts/InterVariable.woff2").toString("base64");
  const fontFace = `@font-face{font-family:"Inter Preview";font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${inter}) format("woff2")}\n:root{--font-inter:"Inter Preview"}`;
  const org = buildFixture().orgs.find((o) => o.slug === ORG_WITH_MODULES);
  if (!org) throw new Error("fixture org missing");

  const screens: Array<{ route: string; name: string; html: string }> = [];

  for (const page of PAGES) {
    const route = await routeFor(page);
    currentPath = route.split("?")[0];
    const tree = await renderPage(page.path, page.props);
    // Every org screen sits inside the org layout's chrome, so the
    // preview wraps it the same way rather than rendering the bare page.
    const inOrg = route.startsWith("/org/");
    const html = renderToStaticMarkup(inOrg ? createElement(Chrome, { orgName: String(org.name), slug: ORG_WITH_MODULES, logo: parseBranding(org.branding).logo, children: tree }) : tree);
    screens.push({ route, name: page.name, html });
  }

  // The screens outside an org: sign-in in both modes, and the gate.
  const loginMod = (await import("@/app/login/page")) as { default: PageFn };
  for (const [name, search] of [
    ["sign-in", {}],
    ["sign-in-link", { mode: "link" }],
  ] as const) {
    const route = name === "sign-in" ? "/login" : "/login?mode=link";
    currentPath = "/login";
    const tree = await loginMod.default({ searchParams: p(search as Record<string, string>) });
    screens.push({ route, name, html: renderToStaticMarkup(tree) });
  }
  const unauthorized = (await import("@/app/unauthorized/page")) as { default: () => ReactNode };
  screens.push({ route: "/unauthorized", name: "unauthorized", html: renderToStaticMarkup(unauthorized.default()) });

  // The marks under /public travel inside the one file.
  for (const s of screens) {
    s.html = s.html.replace(/src="(\/logos\/[^"]+)"/g, (_m, path) => `src="data:image/png;base64,${readFileSync(`public${path}`).toString("base64")}"`);
  }

  const first = screens.find((s) => s.name === "today") ?? screens[0];

  const sections = screens
    .map((s) => `<section class="screen" data-route="${escapeAttr(s.route)}" data-name="${escapeAttr(s.name)}" hidden>${s.html}</section>`)
    .join("\n");

  const options = screens.map((s) => `<option value="${escapeAttr(s.route)}">${escapeAttr(s.name)}</option>`).join("");

  const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>BFFSA app preview</title>
<style>${fontFace}</style>
<style>${css}</style>
<style>
/* The preview's own chrome: a toolbar and a phone-width frame. The
   frame carries a transform so the app's fixed tab bar pins to the
   frame rather than the desktop viewport. Nothing here styles the app. */
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; background: #111; font-family: -apple-system, system-ui, sans-serif; }
.bar { flex: none; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; background: #222; color: #eee; font-size: 13px; }
.bar select, .bar button { font: inherit; min-height: 36px; border-radius: 8px; border: 0; padding: 0 10px; background: #333; color: #eee; }
.bar button[aria-pressed="true"] { background: #e5e5ea; color: #111; }
.bar .grow { flex: 1; min-width: 80px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.frame { flex: 1; min-height: 0; width: 390px; max-width: 100%; margin: 0 auto; overflow-y: auto; overflow-x: hidden; transform: translateZ(0); background: var(--bg); font-family: "Inter Preview", system-ui, sans-serif; }
.screen { min-height: 100%; }
.frame form { pointer-events: none; }
.frame form button, .frame form input, .frame form select, .frame form textarea { pointer-events: auto; }
</style>
</head>
<body>
<div class="bar">
  <select id="pick" aria-label="Screen">${options}</select>
  <button type="button" id="back" aria-label="Back">&larr;</button>
  <span class="grow" id="where"></span>
  <button type="button" data-theme-pick="light">Light</button>
  <button type="button" data-theme-pick="dark">Dark</button>
  <button type="button" data-theme-pick="system">Phone</button>
</div>
<div class="frame" id="frame">
${sections}
</div>
<script>
(function () {
  var frame = document.getElementById("frame");
  var pick = document.getElementById("pick");
  var where = document.getElementById("where");
  var history = [];
  function find(route) {
    var path = route.split("#")[0];
    var exact = frame.querySelector('.screen[data-route="' + path.replace(/"/g, '\\\\"') + '"]');
    if (exact) return exact;
    var bare = path.split("?")[0];
    return frame.querySelector('.screen[data-route="' + bare + '"]');
  }
  function show(route, push) {
    var target = find(route);
    if (!target) { where.textContent = route + " is not in this preview"; return false; }
    var current = frame.querySelector(".screen:not([hidden])");
    if (current && push !== false) history.push(current.getAttribute("data-route"));
    frame.querySelectorAll(".screen").forEach(function (s) { s.hidden = true; });
    target.hidden = false;
    frame.scrollTop = 0;
    pick.value = target.getAttribute("data-route");
    where.textContent = target.getAttribute("data-route");
    return true;
  }
  function theme(t) {
    var dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.querySelectorAll("[data-theme-pick]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-pick") === t)); });
  }
  frame.addEventListener("click", function (e) {
    var a = e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href.charAt(0) !== "/") return;
    e.preventDefault();
    show(href, true);
  });
  frame.addEventListener("submit", function (e) { e.preventDefault(); where.textContent = "Forms do not post in the preview"; });
  pick.addEventListener("change", function () { show(pick.value, true); });
  document.getElementById("back").addEventListener("click", function () { var r = history.pop(); if (r) show(r, false); });
  document.querySelectorAll("[data-theme-pick]").forEach(function (b) { b.addEventListener("click", function () { theme(b.getAttribute("data-theme-pick")); }); });
  window.__preview = { show: show, theme: theme, routes: Array.prototype.map.call(frame.querySelectorAll(".screen"), function (s) { return s.getAttribute("data-route"); }) };
  theme("system");
  show(${JSON.stringify(first.route)}, false);
})();
</script>
</body>
</html>
`;

  mkdirSync(OUT_DIR, { recursive: true });
  const out = `${OUT_DIR}/app_preview.html`;
  writeFileSync(out, html);
  console.log(`wrote ${out}: ${screens.length} screens`);
});
