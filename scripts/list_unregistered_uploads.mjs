#!/usr/bin/env node
// Read-only report: files in the documents bucket that no document row
// refers to. A tab closed between the browser's upload and the server's
// check can leave one. NOTHING IS DELETED OR CHANGED by this script; it
// only lists. A person decides what to do with each.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/list_unregistered_uploads.mjs
//
// The service role key is read from the environment and is never printed.
// Only paths with the three part shape <org>/<request>/<file> are
// considered; the Athlete login's family folder is reported by its own
// assignment rows, not here.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function listAll(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from("documents").list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list ${prefix || "/"}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

const referenced = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from("documents").select("storage_paths, original_paths").range(from, from + 999);
  if (error) throw new Error(`documents: ${error.message}`);
  for (const r of data ?? []) for (const p of [...(r.storage_paths ?? []), ...(r.original_paths ?? [])]) referenced.add(p);
  if ((data ?? []).length < 1000) break;
}

const loose = [];
for (const org of await listAll("")) {
  if (org.id) continue; // a file at the top level, not an org folder
  for (const req of await listAll(org.name)) {
    if (req.id || req.name === "family") continue;
    for (const f of await listAll(`${org.name}/${req.name}`)) {
      if (!f.id) continue;
      const path = `${org.name}/${req.name}/${f.name}`;
      if (!referenced.has(path)) loose.push({ path, bytes: f.metadata?.size ?? null, created: f.created_at ?? null });
    }
  }
}

if (!loose.length) console.log("No unregistered uploads. Every file in the bucket belongs to a document.");
else {
  console.log(`${loose.length} file(s) in the bucket that no document refers to:`);
  for (const l of loose) console.log(`  ${l.path}  ${l.bytes ?? "?"} bytes  ${l.created ?? ""}`);
  console.log("Nothing was changed.");
}
