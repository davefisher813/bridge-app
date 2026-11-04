// The staging upload test for 0078 (Tony's gate): does a real Supabase Storage
// upload by a signed-in Athlete login, and by a non-master Admin, still work
// when an object with no document row is the master's alone?
//
// Run it against a STAGING project that has 0078 applied, never production.
// It uses test accounts you create there; it holds no keys. Set:
//   STAGING_URL        the staging project URL (https://<ref>.supabase.co)
//   STAGING_ANON_KEY   the staging publishable (anon) key
//   ATHLETE_EMAIL / ATHLETE_PASSWORD   a family login linked to ATHLETE_ID
//   ADMIN_EMAIL / ADMIN_PASSWORD       an owner who is NOT the master account
//   ORG_ID, ASSIGNMENT_ID              the org, and an open upload assignment of that athlete
// Uploads are plain (upsert: false), exactly as the app does them. Each step
// prints PASS or FAIL with what Storage said. Exit code 1 on any FAIL.
import { createClient } from "@supabase/supabase-js";

const need = ["STAGING_URL", "STAGING_ANON_KEY", "ATHLETE_EMAIL", "ATHLETE_PASSWORD", "ADMIN_EMAIL", "ADMIN_PASSWORD", "ORG_ID", "ASSIGNMENT_ID"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) { console.error("Missing: " + missing.join(", ")); process.exit(2); }
const env = process.env;
if (/yfrhuecavyfhwdlgssrv|emllcefqxyxyhqolrllo/.test(env.STAGING_URL)) { console.error("Refusing to run against the production or old project."); process.exit(2); }

let failed = 0;
const step = (name, ok, note = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  (" + note + ")" : ""}`); };
const pdf = () => new Blob(["%PDF-1.4\n%synthetic test file\n"], { type: "application/pdf" });
const stamp = Date.now();

async function as(email, password) {
  const c = createClient(env.STAGING_URL, env.STAGING_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in as ${email}: ${error.message}`);
  return c;
}

// 1. The Athlete login: upload into the assignment folder, submit, read it back.
const athlete = await as(env.ATHLETE_EMAIL, env.ATHLETE_PASSWORD);
const aPath = `${env.ORG_ID}/family/${env.ASSIGNMENT_ID}/${stamp}-answer.pdf`;
const up = await athlete.storage.from("documents").upload(aPath, pdf(), { contentType: "application/pdf", upsert: false });
step("Athlete uploads the answer file (plain upload)", !up.error, up.error?.message);
if (!up.error) {
  const sub = await athlete.rpc("submit_assignment", { p_assignment: env.ASSIGNMENT_ID, p_note: "staging test", p_file_name: "answer.pdf", p_file_size: 31, p_media_type: "application/pdf", p_storage_path: aPath });
  step("Athlete submits it with submit_assignment", !sub.error, sub.error?.message);
  const back = await athlete.storage.from("documents").download(aPath);
  step("Athlete reads the answer back", !back.error && !!back.data, back.error?.message);
}

// 2. A non-master Admin: upload an object with no document row yet, then the row.
const admin = await as(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
const dPath = `${env.ORG_ID}/doc_stagingtest_${stamp}/a.pdf`;
const up2 = await admin.storage.from("documents").upload(dPath, pdf(), { contentType: "application/pdf", upsert: false });
step("Non-master Admin uploads a file (plain upload)", !up2.error, up2.error?.message);
if (!up2.error) {
  const mine = await admin.rpc("upload_is_mine", { p_path: dPath });
  step("upload_is_mine says it is their own unlisted upload", mine.data === true, mine.error?.message);
  const read = await admin.storage.from("documents").download(dPath);
  step("Non-master Admin cannot read it back before a row exists (master-only rule)", !!read.error);
}

console.log(failed ? `\n${failed} step(s) FAILED` : "\nAll steps passed");
process.exit(failed ? 1 : 0);
