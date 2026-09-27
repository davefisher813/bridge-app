// One-off loader: fills the shared high school directory (migration
// 0040, high_schools) from the public NCES school files. Never a
// migration, never run by the app, never fed anything but those public
// files: the directory holds no org's data (Dave, 2026-09-27; enforced
// by src/laws/autofillLaws.test.ts).
//
// Run it from the repo root, with the service role key in the
// environment (it writes a table only the service role may write):
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   npx esbuild scripts/load_high_schools.ts --bundle --platform=node --log-level=warning \
//     | node - --states CT,NY,NJ --file ccd_sch_029_2324_w_1a_073124.csv --file pss2122_pu.csv
//
// Add --dry-run to parse and count without writing anything. See
// scripts/README.md for where the files come from.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseNcesCsv, type NcesSchool } from "../src/lib/lookup/ncesParse";
import { nameKey } from "../src/lib/lookup/nameKey";

const BATCH = 500;

interface Args {
  states: string[];
  files: string[];
  year: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { states: [], files: [], year: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--states") args.states = (argv[++i] ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === "--file") args.files.push(argv[++i] ?? "");
    else if (a === "--year") args.year = argv[++i] ?? null;
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

// "ccd_sch_029_2324_w_1a_073124.csv" -> "2324"; "pss2122_pu.csv" -> "2122".
function yearFromFile(file: string): string {
  const m = basename(file).match(/(?:^pss|_)(\d{4})(?:_|\.|$)/i);
  return m ? m[1] : "unknown";
}

interface Row {
  nces_id: string;
  name: string;
  city: string | null;
  state: string;
  country: string;
  source: string;
}

function toRows(schools: NcesSchool[], source: string): Row[] {
  return schools.map((s) => ({ nces_id: s.ncesId, name: s.name, city: s.city, state: s.state, country: "US", source }));
}

// high_schools is unique on (name_key, state, city) as well as on
// nces_id, and one batch that breaks the first fails whole. So each
// batch is deduplicated on that key first, and a batch that still fails
// is retried one row at a time, with the rows that clash reported.
function dedupe(rows: Row[]): Row[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${nameKey(r.name)}|${r.state}|${nameKey(r.city)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2).filter((a) => a !== "-" && a !== "--"));
  if (args.states.length === 0 || args.files.length === 0) {
    console.error("Usage: ... | node - --states CT,NY,NJ --file <ccd.csv> --file <pss.csv> [--year 2324] [--dry-run]");
    process.exit(2);
  }

  const all: Row[] = [];
  for (const file of args.files) {
    const parsed = parseNcesCsv(readFileSync(file, "utf8"), { states: args.states });
    const source = `nces_${parsed.format === "ccd" ? "ccd" : "pss"}_${args.year ?? yearFromFile(file)}`;
    const perState = new Map<string, number>();
    for (const s of parsed.schools) perState.set(s.state, (perState.get(s.state) ?? 0) + 1);
    console.log(`${basename(file)}: ${parsed.format.toUpperCase()}, kept ${parsed.schools.length} (${[...perState].map(([st, n]) => `${st} ${n}`).join(", ") || "none"}), skipped ${JSON.stringify(parsed.skipped)}, source ${source}`);
    all.push(...toRows(parsed.schools, source));
  }

  const rows = dedupe(all);
  console.log(`${rows.length} schools to write (${all.length - rows.length} same-name-same-town duplicates dropped).`);
  if (args.dryRun) {
    console.log("Dry run: nothing written.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(2);
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  let written = 0;
  let clashed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await admin.from("high_schools").upsert(batch, { onConflict: "nces_id" });
    if (!error) {
      written += batch.length;
      continue;
    }
    for (const r of batch) {
      const one = await admin.from("high_schools").upsert(r, { onConflict: "nces_id" });
      if (one.error) {
        clashed++;
        console.warn(`Skipped ${r.name}, ${r.city ?? "no city"}, ${r.state} (${r.nces_id}): ${one.error.message}`);
      } else written++;
    }
  }
  console.log(`Wrote ${written} schools; skipped ${clashed}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
