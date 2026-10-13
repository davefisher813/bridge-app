// An Athlete login sends a document for its own athlete, outside any
// assignment (Doc AI Piece 5, migration 0066). Pure: the field names,
// the types a family may name, and the path rules both the browser and
// the server action hold, so the three (form, action, database function)
// cannot disagree on where a file goes.

import { READER_TYPES } from "@/lib/documents/fileTypes";
import type { DocCategoryId } from "@/lib/docai/types";

export const FAMILY_SEND_FIELDS = {
  note: "note",
  type: "docType",
  storagePath: "storagePath",
  readerPath: "readerPath",
  fileName: "fileName",
  mediaType: "mediaType",
} as const;

// PDF, JPG and PNG: what the family folder takes (migration 0048) and
// what the assignment upload takes. HEIC stays off on purpose, so an
// iPhone converts a camera photo to JPEG.
export const FAMILY_SEND_ACCEPT = "application/pdf,image/jpeg,image/png";

// The reader types, less Board Document, which is an org's and never an
// athlete's. The same list migration 0066 checks.
export const FAMILY_SEND_TYPES: { id: DocCategoryId; label: string }[] = READER_TYPES.filter((t) => t.id !== "board_document");

export function isFamilySendType(v: unknown): v is DocCategoryId {
  return typeof v === "string" && FAMILY_SEND_TYPES.some((t) => t.id === v);
}

// The request folder: the athlete's id, an underscore, a request id. The
// family folder's storage policy (0066) admits a login only under a
// folder that starts with an athlete it is linked to.
export function familyRequestFolder(athleteId: string, requestId: string): string {
  return `${athleteId}_${requestId}`;
}

const SEND_PATH = /^[0-9a-f-]{36}\/family\/[0-9a-f-]{36}_[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/;

// True when the path is under this athlete's family folder in this org,
// with no bare dot segment for a file name and a PDF, JPG or PNG name.
export function isFamilySendPathFor(path: string, orgId: string, athleteId: string): boolean {
  return SEND_PATH.test(path) && path.startsWith(`${orgId}/family/${athleteId}_`) && !/\/\.\.?$/.test(path) && /\.(pdf|jpe?g|png)$/i.test(path);
}

// The folder a path sits in, so a photo's reader copy can be held to the
// same one.
export function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

// The file name cleaning the uploaders do, so a path the rules accept.
export function safeSendFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return cleaned || "file";
}

// The path a sent file goes to, or null when the pieces would not make a
// path the rules accept. `prefix` names the reader copy of a photo.
export function familySendPath(orgId: string, athleteId: string, requestId: string, fileName: string, prefix = ""): string | null {
  const path = `${orgId}/family/${familyRequestFolder(athleteId, requestId)}/${prefix}${safeSendFileName(fileName)}`;
  return isFamilySendPathFor(path, orgId, athleteId) ? path : null;
}
