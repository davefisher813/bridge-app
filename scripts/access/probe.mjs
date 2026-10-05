// Production access probe (launch gate 6, docs/LAUNCH_GATES.md).
//
// Signs in as each test account and tries reads and writes straight
// against the database API with that account's own session, to prove row
// level security does what the screens assume. It is the part of the
// access test a screen cannot show.
//
// Safe by default:
//   - Run with nothing set, it prints the plan and exits. Nothing is read.
//   - It runs only with CONFIRM_PROD_ACCESS_TEST=yes.
//   - It writes only to the test organization. Bridge is read-only here,
//     and the only thing asserted about Bridge is "zero rows".
//   - The service role key mints one sign-in per test address and is never
//     printed or kept. Run it where that key already lives (Dave's machine,
//     or a CI job), not in a chat.
//
// Needs, in the environment:
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
//   TEST_ORG_ID        the access-test org's id
//   BRIDGE_ORG_ID      Bridge's id (25eb1763-fe05-450f-ad41-cbf79215c316)
//   ADMIN_EMAIL, ADVISOR_EMAIL, VIEWER_EMAIL, ATHLETE_EMAIL
//   TEST_ATHLETE_ID    the synthetic athlete's id
//
// Exit 0 when every expectation holds, 1 when any does not.

import { createClient } from "@supabase/supabase-js";

// Tables whose rows an Admin reads and nobody else here may (the table
// level policies), and the tables where nobody but members of the org may
// read anything at all. A column is the org filter each table carries.
const ADMIN_ONLY = ["athlete_notes", "donors", "gifts", "pledges", "docai_usage", "activity_log"];
const EVERY_ORG_TABLE = ["athletes", "athlete_notes", "athlete_checkins", "donors", "gifts", "pledges", "documents", "activity_log", "recruiting_targets", "board_members", "assignments", "athlete_messages", "org_school_notes", "contacts"];

const ROLES = ["admin", "advisor", "viewer", "athlete"];

const PLAN = [
  "1. Sign in as each of the four test accounts (admin, advisor, viewer, athlete).",
  "2. Bridge, read only: every org table returns zero rows to every account.",
  "3. Test org: Admin and Advisor read the synthetic athlete.",
  "4. Test org: Viewer and Athlete read no rows from the admin-only tables.",
  "5. Test org: Viewer reads no rows from athletes directly; Athlete reads exactly one (its own).",
  "6. Viewer gets the program summary function for the test org, and null from the giving function for Bridge.",
  "7. Writes: Viewer and Athlete cannot insert or update in the test org; no account can insert into Bridge.",
  "8. A signed-out client reads zero rows from every org table.",
];

if (process.env.CONFIRM_PROD_ACCESS_TEST !== "yes") {
  console.log("Dry run. Nothing was read or written.\n");
  console.log(PLAN.join("\n"));
  console.log("\nTo run it for real, set the variables listed at the top of this file and CONFIRM_PROD_ACCESS_TEST=yes.");
  process.exit(0);
}

const need = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TEST_ORG_ID", "BRIDGE_ORG_ID", "ADMIN_EMAIL", "ADVISOR_EMAIL", "VIEWER_EMAIL", "ATHLETE_EMAIL", "TEST_ATHLETE_ID"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}`);
  process.exit(1);
}
const E = process.env;
if (E.TEST_ORG_ID === E.BRIDGE_ORG_ID) {
  console.error("TEST_ORG_ID is Bridge's id. Refusing: this probe writes to the test org.");
  process.exit(1);
}

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures += 1;
};

const admin = createClient(E.SUPABASE_URL, E.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// A client that is signed in as one address: a one-time link minted with
// the service role, redeemed with the publishable key, as the app does.
async function clientFor(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new Error(`could not mint a sign-in for ${email}: ${error?.message ?? "no token"}`);
  const c = createClient(E.SUPABASE_URL, E.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: verifyError } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (verifyError) throw new Error(`could not sign in ${email}: ${verifyError.message}`);
  return c;
}

const count = async (c, table, orgId) => {
  let q = c.from(table).select("*", { count: "exact", head: true });
  if (orgId) q = q.eq("org_id", orgId);
  const { count: n, error } = await q;
  // A table the role may not even select answers with an error: that is
  // "zero rows" for this purpose.
  return error ? 0 : (n ?? 0);
};

const clients = {};
const emails = { admin: E.ADMIN_EMAIL, advisor: E.ADVISOR_EMAIL, viewer: E.VIEWER_EMAIL, athlete: E.ATHLETE_EMAIL };
for (const role of ROLES) clients[role] = await clientFor(emails[role]);
const anon = createClient(E.SUPABASE_URL, E.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });

// 2. Bridge: zero to everyone, because none of these accounts belongs to it.
for (const role of ROLES) {
  for (const table of EVERY_ORG_TABLE) {
    const n = await count(clients[role], table, E.BRIDGE_ORG_ID);
    check(`bridge ${table} as ${role} is empty`, n === 0, `(saw ${n})`);
  }
}

// 3 and 4. The test org, table level.
for (const role of ["admin", "advisor"]) {
  check(`test org athletes as ${role} includes the synthetic athlete`, (await count(clients[role], "athletes", E.TEST_ORG_ID)) >= 1);
}
for (const role of ["viewer", "athlete"]) {
  for (const table of ADMIN_ONLY) {
    const n = await count(clients[role], table, E.TEST_ORG_ID);
    check(`test org ${table} as ${role} is empty`, n === 0, `(saw ${n})`);
  }
}

// 5. Athletes by role.
check("test org athletes as viewer is empty (the summary function is the viewer's way in)", (await count(clients.viewer, "athletes", E.TEST_ORG_ID)) === 0);
{
  const { data, error } = await clients.athlete.from("athletes").select("id").eq("org_id", E.TEST_ORG_ID);
  const ids = (data ?? []).map((r) => r.id);
  check("athlete login reads exactly its own athlete", !error && ids.length === 1 && ids[0] === E.TEST_ATHLETE_ID, `(saw ${ids.length})`);
}

// 6. The summary functions.
{
  const { data, error } = await clients.viewer.rpc("member_program", { p_org: E.TEST_ORG_ID });
  check("viewer gets the program summary for the test org", !error && Array.isArray(data) && data.length >= 1, `(${error?.message ?? "empty"})`);
  const giving = await clients.viewer.rpc("member_giving", { p_org: E.BRIDGE_ORG_ID });
  check("viewer gets nothing from the giving function for Bridge", !giving.error && giving.data === null, `(saw ${JSON.stringify(giving.data)?.slice(0, 40)})`);
  const program = await clients.viewer.rpc("member_program", { p_org: E.BRIDGE_ORG_ID });
  check("viewer gets nothing from the program function for Bridge", !program.error && (program.data ?? []).length === 0);
}

// 7. Writes. Every attempt must be refused or change nothing. If one is
// accepted that is the failure being looked for; it is undone at once with
// the service role so a failed run never leaves a row behind.
const PROBE_NAME = "Probe Should Not Exist";
const undoInsert = async (orgId) => {
  await admin.from("athletes").delete().eq("org_id", orgId).eq("name", PROBE_NAME);
};
for (const role of ["viewer", "athlete"]) {
  const ins = await clients[role].from("athletes").insert({ org_id: E.TEST_ORG_ID, name: PROBE_NAME, sport: "baseball", recruit_type: "hs" });
  check(`${role} cannot add an athlete to the test org`, !!ins.error, "(insert was accepted; removed)");
  if (!ins.error) await undoInsert(E.TEST_ORG_ID);
  const before = await admin.from("athletes").select("name").eq("id", E.TEST_ATHLETE_ID).single();
  const upd = await clients[role].from("athletes").update({ name: "Probe Rename" }).eq("id", E.TEST_ATHLETE_ID).select("id");
  const changed = !upd.error && (upd.data ?? []).length > 0;
  check(`${role} cannot rename the athlete`, !changed, "(update changed a row; restored)");
  if (changed && before.data) await admin.from("athletes").update({ name: before.data.name }).eq("id", E.TEST_ATHLETE_ID);
}
for (const role of ROLES) {
  const ins = await clients[role].from("athletes").insert({ org_id: E.BRIDGE_ORG_ID, name: PROBE_NAME, sport: "baseball", recruit_type: "hs" });
  check(`${role} cannot add an athlete to Bridge`, !!ins.error, "(insert was accepted; removed)");
  if (!ins.error) await undoInsert(E.BRIDGE_ORG_ID);
}

// 8. Signed out.
for (const table of EVERY_ORG_TABLE) {
  const n = await count(anon, table, null);
  check(`signed out reads nothing from ${table}`, n === 0, `(saw ${n})`);
}

console.log(failures === 0 ? "\nAll expectations held." : `\n${failures} expectation(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
