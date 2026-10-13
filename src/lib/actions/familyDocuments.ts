"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireFamily, requireFamilyAthlete } from "@/lib/data/family";
import { findFamilyTwin } from "@/lib/data/familyReads";
import { FAMILY_SEND_FIELDS, folderOf, isFamilySendPathFor, isFamilySendType } from "@/lib/data/familySend";
import { parseSubmissionNote } from "@/lib/validation/assignment";
import { checkIngestedRecord } from "@/lib/docai/acceptance";

// An Athlete login sends a document for its own athlete, outside any
// assignment (Doc AI Piece 5, migration 0066). The same rules as an
// assignment's file (submitAssignment): the browser has put the file at
// <org>/family/<athlete>_<request>/<file>, the form carries only its
// path, name and claimed type, and none of that is believed:
//
//   - the bytes are read back with the service role (an Athlete login
//     has no read on the bucket and is meant not to) and checked by
//     checkIngestedRecord, the staff uploader's check, from what arrived;
//   - the size and the type filed are the bytes' own;
//   - the same bytes already sent for one of the login's athletes are
//     refused with a pointer to the first copy.
//
// The one write is the database function, which checks the link, the
// path, the owner of the file and the duplicate again, files the row
// (filed, Needs Review, never read) and writes the log line. No model
// runs here: an Admin chooses to Read Again from the document screen.

export interface FamilySendState {
  errors: Record<string, string>;
  // What was typed, handed back on a refusal so the form keeps it.
  note?: string;
}

// The bytes a sent file can really be, and the media type each one is
// filed under. PDF, JPG and PNG only: the family folder takes no other.
const MEDIA_TYPE_OF: Record<string, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
};

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

async function readBack(path: string): Promise<Uint8Array | null> {
  const { data: blob, error } = await createAdminClient().storage.from("documents").download(path);
  if (error || !blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

function verdictOf(name: string, claimedType: string, bytes: Uint8Array) {
  return checkIngestedRecord({
    originalName: name,
    originalSize: bytes.byteLength,
    mediaType: claimedType,
    kind: claimedType === "application/pdf" ? "pdf" : "image",
    base64Length: Math.ceil(bytes.byteLength / 3) * 4,
    byteLength: bytes.byteLength,
    header: bytes.slice(0, 64),
  });
}

export async function sendFamilyDocument(slug: string, athleteId: string, _prevState: FamilySendState, formData: FormData): Promise<FamilySendState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireFamily(org.id);
  await requireFamilyAthlete(org.id, user.id, athleteId);

  const typedNote = String(formData.get(FAMILY_SEND_FIELDS.note) ?? "");
  const noted = parseSubmissionNote(formData.get(FAMILY_SEND_FIELDS.note));
  if (!noted.ok) return { errors: noted.errors, note: typedNote };

  const rawType = String(formData.get(FAMILY_SEND_FIELDS.type) ?? "").trim();
  if (rawType && !isFamilySendType(rawType)) return { errors: { docType: "Pick a type from the list, or leave it empty." }, note: typedNote };

  const storagePath = String(formData.get(FAMILY_SEND_FIELDS.storagePath) ?? "").trim();
  if (!storagePath) return { errors: { file: "Choose a file to send." }, note: typedNote };
  if (!isFamilySendPathFor(storagePath, org.id, athleteId)) return { errors: { file: "That file was not uploaded to this athlete's folder." }, note: typedNote };

  const claimedName = String(formData.get(FAMILY_SEND_FIELDS.fileName) ?? "").trim() || baseName(storagePath);
  const claimedType = String(formData.get(FAMILY_SEND_FIELDS.mediaType) ?? "").trim();

  const bytes = await readBack(storagePath);
  if (!bytes) return { errors: { file: `${claimedName} could not be read back after upload. Try again.` }, note: typedNote };
  // The claimed type only decides which way a mismatch is refused; the
  // bytes decide what the file is.
  const verdict = verdictOf(claimedName, claimedType, bytes);
  if (!verdict.ok) return { errors: { file: verdict.reason ?? "That file cannot be sent." }, note: typedNote };
  const mediaType = MEDIA_TYPE_OF[verdict.sniffed];
  if (!mediaType) return { errors: { file: `${claimedName} is not a PDF, JPG or PNG.` }, note: typedNote };

  // A photo's reader copy, scaled down on the phone: beside the original,
  // and itself a photo. A copy that fails the check is left out, not
  // fatal: the original is what is kept, and Read Again reads it.
  const rawReader = String(formData.get(FAMILY_SEND_FIELDS.readerPath) ?? "").trim();
  let readerPath: string | null = null;
  if (rawReader && mediaType !== "application/pdf" && rawReader !== storagePath && isFamilySendPathFor(rawReader, org.id, athleteId) && folderOf(rawReader) === folderOf(storagePath)) {
    const readerBytes = await readBack(rawReader);
    const readerVerdict = readerBytes ? verdictOf(claimedName, "image/jpeg", readerBytes) : null;
    if (readerVerdict?.ok && (readerVerdict.sniffed === "jpeg" || readerVerdict.sniffed === "png")) readerPath = rawReader;
  }

  const supabase = await createClient();
  const hash = createHash("sha256").update(bytes).digest("hex");
  // The same bytes twice is the same document twice, among the documents
  // this login may see (migration 0063's function).
  const earlier = await findFamilyTwin(supabase, org.id, hash);
  if (earlier) {
    const when = new Date(earlier.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { errors: { file: `This exact file was already sent on ${when} as ${earlier.file_name}.` }, note: typedNote };
  }

  const fileName = claimedName.slice(0, 200);
  const { error } = await supabase.rpc("family_send_document", {
    p_athlete: athleteId,
    p_file_name: fileName,
    p_file_size: bytes.byteLength,
    p_media_type: mediaType,
    p_storage_path: storagePath,
    p_content_hash: hash,
    p_note: noted.note,
    p_type: rawType || null,
    p_reader_path: readerPath,
  });
  if (error) return { errors: { form: error.message.replace(/^family_send_document:\s*/, "") }, note: typedNote };

  revalidatePath(`/org/${slug}/family/${athleteId}`);
  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}`);
  // Back to the athlete's page, where the file is listed as filed.
  redirect(`/org/${slug}/family/${athleteId}`);
}
