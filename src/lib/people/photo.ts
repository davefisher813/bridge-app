// A person's photo in an org (migration 0049). Pure: the server checks
// what arrived with these, and a test can hand them a few bytes.
//
// The browser shrinks every photo to a 512px square JPEG and puts it in
// the bucket itself, under <org>/<user>/ (an Admin of the org may add
// there and nothing else, migration 0049). The server then reads the
// bytes back and checks them, because a server action is a public
// endpoint, before any row points at them.

export const PHOTO_MAX_BYTES = 1024 * 1024;
export const PHOTO_EDGE = 512;
export const PHOTO_BUCKET = "member-photos";

export type PhotoCheck = { ok: true } | { ok: false; error: string };

// The bytes that are really in the bucket: a JPEG, not empty, under 1 MB.
export function checkPhoto(bytes: Uint8Array | null | undefined): PhotoCheck {
  if (!bytes || bytes.length === 0) return { ok: false, error: "No photo arrived. Pick one and try again." };
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, error: "That photo is over 1 MB after shrinking. Try a different one." };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return { ok: false, error: "That is not a JPG photo." };
  return { ok: true };
}

// <org>/<user>/<stamp>.jpg, the one shape migration 0049 allows. A new
// name per upload, so a replaced photo is never served from a cache.
export function photoPath(orgId: string, userId: string, stamp: number): string {
  return `${orgId}/${userId}/${Math.floor(stamp)}.jpg`;
}

export const PHOTO_PATH_SHAPE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9]+\.jpg$/;

// Where a screen points an <img> for a person's photo, or undefined when
// they have none. The stored file's name rides along so a new photo is a
// new address.
export function photoUrl(slug: string, userId: string, path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const version = path.split("/").pop()?.replace(/\.jpg$/, "") ?? "";
  return `/org/${slug}/members/${userId}/photo?v=${version}`;
}
