// Session refresh middleware. Ported from tucci-admin's
// src/lib/supabase/middleware.ts (the standard @supabase/ssr pattern,
// not Tucci-specific), adapted to this repo's route set.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Self-registration is disabled (same as tucci-admin): accounts are
// created by an org owner, not open signup, so there is no /signup
// route to allow through here.
//
// The app icon and manifest are public too. iOS fetches them without the
// session when a page is added to the Home Screen; behind the sign-in
// redirect it got the login page instead of an image and drew a letter
// in place of the logo (Dave, 2026-09-26).
const PUBLIC_EXACT = new Set(["/unauthorized", "/icon", "/apple-icon", "/manifest.webmanifest"]);

export function isPublicPath(path: string): boolean {
  return path.startsWith("/login") || path.startsWith("/auth") || PUBLIC_EXACT.has(path);
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session. Do not run code between createServerClient and
  // getUser, or the session can desync.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
