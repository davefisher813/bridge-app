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

// Normally every request gets a fresh fixture, so a write is gone by the
// next page: right for the live driver, which only looks. The browser
// tests (e2e/) need a record they create to be there on the next screen,
// so FIXTURE_PERSIST=1 keeps one dataset for the life of the server, on
// globalThis so every route and action shares it. Off by default.
const persist = process.env.FIXTURE_PERSIST === "1";
const store = globalThis as unknown as { __fixtureDb?: ReturnType<typeof buildFixture> };
const dataset = () => (persist ? (store.__fixtureDb ??= buildFixture()) : buildFixture());

// With persistence on, the browser uploads straight to Storage (which a
// test intercepts, so nothing arrives), and the server then reads the file
// back to process it. An object nobody stored reads back as a tiny valid
// PDF, which is all the stand-in model ever needed. The path is written
// into the bytes, so two uploads are two different files and the
// duplicate-file guard (which hashes what it reads back) has something
// true to compare.
const tinyPdf = (path: string) => Buffer.from(`%PDF-1.4\n%fixture upload ${path}\n1 0 obj << >> endobj\n%%EOF\n`);
type FakeClient = ReturnType<typeof createFakeClient>;
function withUploadReadback(client: FakeClient): FakeClient {
  const from = client.storage.from.bind(client.storage);
  client.storage.from = (bucket: string) => {
    const bucketApi = from(bucket);
    const download = bucketApi.download.bind(bucketApi);
    bucketApi.download = async (path: string) => {
      const found = await download(path);
      return found.data ? found : { data: new Blob([tinyPdf(path)]), error: null };
    };
    return bucketApi;
  };
  return client;
}

export const createClient = cache(async () => {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) throw new Error("The fixture client must never run on Vercel");
  let userId = OWNER_ID;
  try {
    const picked = (await cookies()).get("fixture_user")?.value;
    if (picked && KNOWN.has(picked)) userId = picked;
  } catch {
    // Outside a request (a build-time render) there are no cookies.
  }
  const client = createFakeClient(dataset(), { userId });
  return persist ? withUploadReadback(client) : client;
});
