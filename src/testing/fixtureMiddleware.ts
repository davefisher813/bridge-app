// The session refresh, replaced for FIXTURE_MODE: nothing to refresh,
// nobody to redirect. See fixtureServer.ts.
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  return NextResponse.next({ request });
}
