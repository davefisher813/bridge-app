// Reading a file straight after it was uploaded, before any document lists it.
//
// Migration 0078 makes a file nobody lists yet the master's alone. An Admin
// who is not the master uploaded it a moment ago and must still be able to
// have it read, so the read-back asks Storage as the person first, and only
// if Storage refuses does it ask the database whether this object is the
// person's own unlisted upload (public.upload_is_mine, 0078 section 8). Only
// then does it read with the service client. A file a document already
// lists is never reached this way: the document rule decides, as before.
//
// No Next, Supabase or DOM import: the two clients are passed in, so the
// rule is tested without a database.

export type DownloadResult = { data: Blob | null; error: { message: string } | null };

export type BucketClient = {
  storage: { from(bucket: string): { download(path: string): Promise<DownloadResult> } };
};

export type UploadAsker = {
  rpc(fn: "upload_is_mine", args: { p_path: string }): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function downloadAfterUpload(
  supabase: BucketClient & Partial<UploadAsker>,
  admin: () => BucketClient,
  path: string
): Promise<DownloadResult> {
  const first = await supabase.storage.from("documents").download(path);
  if (!first.error && first.data) return first;
  if (typeof supabase.rpc !== "function") return first;
  try {
    const { data, error } = await supabase.rpc("upload_is_mine", { p_path: path });
    if (error || data !== true) return first;
    return await admin().storage.from("documents").download(path);
  } catch {
    return first;
  }
}
