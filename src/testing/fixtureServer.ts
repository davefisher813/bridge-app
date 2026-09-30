// The app's Supabase client, replaced by the fixture.
//
// Built in with FIXTURE_MODE=1 (next.config.ts aliases
// @/lib/supabase/server to this file), so the real Next app, with its
// real fonts, hydration and chrome, runs on the same fixture the render
// law and the preview use. That is the honest way to look at the app
// from here: not a string render, the app itself in a browser, at every
// phone width. Never built for production: next.config.ts refuses a
// fixture build on Vercel, and createClient below refuses to run there
// too, in case the alias ever reaches a deployment another way.
//
// Who is signed in is the fixture owner unless a `fixture_user` cookie
// names another fixture id: that is how the live driver opens the family
// screens as the family login (scripts/live/drive.mjs). A
// `fixture_view_as` cookie naming the Athlete login, the Viewer or the
// second Admin makes the signed-in user an Admin who is viewing as that
// person (Stage 5 Phase 5): the fake refuses every write and follows the
// person for every read, as the database does. Only the user's client
// gets it; nothing here builds a service-role client.

import { cache } from "react";
import { cookies } from "next/headers";
import { ADMIN_TWO_ID, buildFixture, OWNER_ID, FAMILY_ID, MEMBER_ID, withSecondAdmin } from "@/testing/fixture";
import { createFakeClient } from "@/testing/fakeSupabase";

const KNOWN = new Set([OWNER_ID, FAMILY_ID, MEMBER_ID]);
const VIEWABLE = new Set([FAMILY_ID, MEMBER_ID, ADMIN_TWO_ID]);

export const createClient = cache(async () => {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) throw new Error("The fixture client must never run on Vercel");
  let userId = OWNER_ID;
  let viewing: string | null = null;
  try {
    const jar = await cookies();
    const picked = jar.get("fixture_user")?.value;
    if (picked && KNOWN.has(picked)) userId = picked;
    const looking = jar.get("fixture_view_as")?.value;
    if (looking && VIEWABLE.has(looking) && userId === OWNER_ID) viewing = looking;
  } catch {
    // Outside a request (a build-time render) there are no cookies.
  }
  // The second Admin exists only for the request that views them, so no
  // other screen's counts move.
  const data = buildFixture();
  if (viewing === ADMIN_TWO_ID) withSecondAdmin(data);
  return createFakeClient(data, { userId, viewing });
});
