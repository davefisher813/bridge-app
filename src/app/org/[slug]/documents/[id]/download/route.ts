import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { VAULT_MEDIA_TYPES } from "@/lib/vault/format";

// Download one stored original: /org/<slug>/documents/<id>/download?n=1
// (n is the page, 1 for a single file).
//
// Staff only. The bytes are read with the caller's own session, so storage
// policy decides too, and they stream straight back: no public link and no
// signed URL is ever handed out, so nothing can be shared by link. The
// original, never the reader's shrunk copy, is what comes back. It is sent
// as an attachment with the stored type and nosniff, so the browser saves
// it rather than rendering anything it holds.
//
// Anyone who is not staff of the org, or any id that is not theirs, gets
// the same 404, so the route does not say which documents exist.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const org = await getOrgBySlug(slug);
  if (!org) return notFound();
  const user = await getCurrentUser(org.id);
  if (!user || !STAFF_ROLES.includes(user.role)) return notFound();

  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("file_name, media_type, original_paths, storage_paths").eq("id", id).eq("org_id", org.id).maybeSingle();
  const doc = data as { file_name: string; media_type: string; original_paths: string[] | null; storage_paths: string[] | null } | null;
  if (!doc) return notFound();

  // Rows from before the vault have no original_paths; their one stored
  // copy is the only bytes there ever were.
  const paths = doc.original_paths?.length ? doc.original_paths : (doc.storage_paths ?? []);
  const requested = Number(new URL(request.url).searchParams.get("n") ?? "1");
  const page = Number.isInteger(requested) && requested >= 1 && requested <= paths.length ? requested : null;
  if (page === null) return notFound();
  const path = paths[page - 1]!;
  if (!path.startsWith(`${org.id}/`)) return notFound();

  const { data: blob, error } = await supabase.storage.from("documents").download(path);
  if (error || !blob) return notFound();

  // The name the person gave it for page one; later pages keep their own
  // stored name. Only characters that are safe in a header.
  const stored = paths.length === 1 ? doc.file_name : (path.split("/").pop() ?? doc.file_name);
  const asciiName = stored.replace(/[^A-Za-z0-9._ -]+/g, "_").slice(0, 120) || "document";
  const type = VAULT_MEDIA_TYPES.includes(doc.media_type) ? doc.media_type : "application/octet-stream";

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(stored)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
