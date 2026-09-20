// The app's Supabase client, replaced by the fixture.
//
// Built in with FIXTURE_MODE=1 (next.config.ts aliases
// @/lib/supabase/server to this file), so the real Next app, with its
// real fonts, hydration and chrome, runs on the same fixture the render
// law and the preview use. That is the honest way to look at the app
// from here: not a string render, the app itself in a browser, at every
// phone width. Never built for production: Vercel does not set the flag.

import { cache } from "react";
import { buildFixture, OWNER_ID } from "@/testing/fixture";
import { createFakeClient } from "@/testing/fakeSupabase";

export const createClient = cache(async () => createFakeClient(buildFixture(), { userId: OWNER_ID }));
