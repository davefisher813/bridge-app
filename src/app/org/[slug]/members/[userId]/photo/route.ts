import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_PATH_SHAPE } from "@/lib/people/photo";

// A person's photo in an org (migration 0049): /org/<slug>/members/<user>/photo
//
// Anyone signed in who belongs to this org may see the photos of the
// people in it, the way they see their names. Nobody else, and the same
// 404 whether the person, the photo or the access is missing, so the
// route does not say who is in an org. The bucket has no policies; the
// service role reads it here, after those checks.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string; userId: string }> }) {
  const { slug, userId } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const org = await getOrgBySlug(slug);
  if (!org) return notFound();
  const viewer = await getCurrentUser(org.id);
  if (!viewer) return notFound();

  const admin = createAdminClient();
  const { data } = await admin.from("org_members").select("photo_path").eq("org_id", org.id).eq("user_id", userId).maybeSingle();
  const path = (data as { photo_path?: string | null } | null)?.photo_path ?? null;
  if (!path || !PHOTO_PATH_SHAPE.test(path) || !path.startsWith(`${org.id}/${userId}/`)) return notFound();

  const { data: blob, error } = await admin.storage.from("member-photos").download(path);
  if (error || !blob) return notFound();

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      // Private to the signed-in viewer; the address changes with every new photo.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
