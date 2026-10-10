import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { PREVIEW_BLOCKED_MESSAGE, previewBlocked } from "@/lib/deploy/previewGuard";

export async function proxy(request: NextRequest) {
  // A preview never reaches the production database (backend audit F-02).
  if (previewBlocked(process.env)) {
    return new NextResponse(PREVIEW_BLOCKED_MESSAGE, { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
