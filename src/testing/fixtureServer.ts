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
// screens as the family login (scripts/live/drive.mjs).

import { cache } from "react";
import { cookies } from "next/headers";
import { buildFixture, OWNER_ID, FAMILY_ID, MEMBER_ID } from "@/testing/fixture";
import { createFakeClient } from "@/testing/fakeSupabase";

const KNOWN = new Set([OWNER_ID, FAMILY_ID, MEMBER_ID]);

export const createClient = cache(async () => {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) throw new Error("The fixture client must never run on Vercel");
  let userId = OWNER_ID;
  try {
    const picked = (await cookies()).get("fixture_user")?.value;
    if (picked && KNOWN.has(picked)) userId = picked;
  } catch {
    // Outside a request (a build-time render) there are no cookies.
  }
  return createFakeClient(buildFixture(), { userId });
});
