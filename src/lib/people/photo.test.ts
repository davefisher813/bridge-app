import { describe, expect, it } from "vitest";
import { checkPhoto, PHOTO_MAX_BYTES, PHOTO_PATH_SHAPE, photoPath, photoUrl } from "./photo";

const b64 = (bytes: number[]) => new Uint8Array(bytes);
const ORG = "25eb1763-fe05-450f-ad41-cbf79215c316";
const USER = "c47ea52f-6805-47c0-8703-9ed71fa39a74";

describe("a person's photo", () => {
  it("accepts a JPEG", () => {
    const r = checkPhoto(b64([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]));
    expect(r.ok).toBe(true);
  });
  it("refuses a PNG, text, nothing and anything over 1 MB", () => {
    expect(checkPhoto(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])).ok).toBe(false);
    expect(checkPhoto(b64([...Buffer.from("hello world")])).ok).toBe(false);
    expect(checkPhoto(new Uint8Array(0)).ok).toBe(false);
    expect(checkPhoto(undefined).ok).toBe(false);
    const big = new Array(PHOTO_MAX_BYTES + 3).fill(0);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    expect(checkPhoto(b64(big))).toMatchObject({ ok: false, error: expect.stringMatching(/over 1 MB/) });
  });
  it("names the file the one way the database allows", () => {
    const p = photoPath(ORG, USER, 1791600000000);
    expect(p).toMatch(PHOTO_PATH_SHAPE);
    expect(p).toBe(`${ORG}/${USER}/1791600000000.jpg`);
  });
  it("points a screen at the photo route, with the file as the version", () => {
    expect(photoUrl("bridge", USER, `${ORG}/${USER}/17.jpg`)).toBe(`/org/bridge/members/${USER}/photo?v=17`);
    expect(photoUrl("bridge", USER, null)).toBeUndefined();
  });
});
