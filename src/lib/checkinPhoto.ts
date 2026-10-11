// A photo on a check-in (migration 0056). Pure, like src/lib/people/photo.ts,
// whose byte check it shares: a JPEG, not empty, under 1 MB.
//
// The phone shrinks the picture (longest side 1600px, JPEG) and puts it
// in the checkin-photos bucket under <org>/<athlete>/<n>.jpg; the server
// reads it back and checks it before a check-in points at it.

export { checkPhoto } from "@/lib/people/photo";

export const CHECKIN_PHOTO_EDGE = 1600;
export const CHECKIN_PHOTO_SHAPE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9]+\.jpg$/;

export function checkinPhotoPath(orgId: string, athleteId: string, stamp: number): string {
  return `${orgId}/${athleteId}/${Math.floor(stamp)}.jpg`;
}

// The path came from the browser, so it is checked for shape and for
// being this org's and this athlete's before anything reads it.
export function isCheckinPhotoFor(path: string, orgId: string, athleteId: string): boolean {
  return CHECKIN_PHOTO_SHAPE.test(path) && path.startsWith(`${orgId}/${athleteId}/`);
}

export function checkinPhotoUrl(slug: string, athleteId: string, checkinId: string, path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const version = path.split("/").pop()?.replace(/\.jpg$/, "") ?? "";
  return `/org/${slug}/roster/${athleteId}/checkins/${checkinId}/photo?v=${version}`;
}
