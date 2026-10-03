// The service-role client, replaced for FIXTURE_MODE builds (next.config.ts
// aliases @/lib/supabase/admin to this file). The actions that write
// through the service role (the scoring preset, a school, a member's name)
// write to the same fixture dataset the signed-in client reads, so the
// browser tests see them land. There is no key and no network: a fixture
// build cannot reach a real database with elevated rights.

import { createFakeClient } from "@/testing/fakeSupabase";
import { fixtureDataset } from "@/testing/fixtureServer";
import { OWNER_ID } from "@/testing/fixture";

export function createAdminClient() {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) throw new Error("The fixture admin client must never run on Vercel");
  return createFakeClient(fixtureDataset(), { userId: OWNER_ID });
}
