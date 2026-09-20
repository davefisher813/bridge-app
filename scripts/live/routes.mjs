// Routes from src/testing/pages.ts, by substituting the fixture constants.
import { readFileSync } from "node:fs";
const src = readFileSync("src/testing/pages.ts", "utf8");
const fx = readFileSync("src/testing/fixture.ts", "utf8");
const consts = {};
for (const m of fx.matchAll(/^(?:export )?const (\w+) = "([^"]+)";/gm)) consts[m[1]] = m[2];
for (const m of fx.matchAll(/^export const (\w+) = (\w+);/gm)) consts[m[1]] = consts[m[2]];
const ids = {};
const idsBlock = fx.match(/export const IDS = \{([\s\S]*?)\}/)[1];
for (const m of idsBlock.matchAll(/(\w+): "([^"]+)"/g)) ids[m[1]] = m[2];
const val = (tok) => {
  tok = tok.trim();
  if (tok.startsWith('"')) return tok.slice(1, -1);
  if (tok.startsWith("IDS.")) return ids[tok.slice(4)];
  return consts[tok];
};
export const routes = [];
for (const m of src.matchAll(/name: "([^"]+)", path: "@\/app([^"]+)\/page", props: \{ params: p\(\{([^}]*)\}\)(?:, searchParams: p\(\{([^}]*)\}\))?/g)) {
  let route = m[2];
  for (const kv of m[3].split(",")) { const [k, v] = kv.split(":"); if (k) route = route.replace(`[${k.trim()}]`, val(v)); }
  const qs = new URLSearchParams(); for (const kv of (m[4] || "").split(",")) { const [k, v] = kv.split(":"); if (k && k.trim()) qs.set(k.trim(), val(v)); }
  routes.push({ name: m[1], route: qs.toString() ? `${route}?${qs}` : route });
}
routes.push({ name: "login", route: "/login" }, { name: "unauthorized", route: "/unauthorized" }, { name: "home", route: "/" });
