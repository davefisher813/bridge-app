"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setMemberPhoto } from "@/lib/actions/members";
import { PHOTO_EDGE, photoPath } from "@/lib/people/photo";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Button, FileField, Notice, Stack } from "@/components/kit";

// Pick a photo of a person, on their page. The phone does the work: the
// picture is cropped to a centred square and shrunk to 512px as a JPEG
// before it is sent, so a 12 megapixel camera shot goes up as about a
// hundred kilobytes. It goes to the bucket, and the server checks it.

async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  const edge = Math.min(PHOTO_EDGE, side);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot shrink the photo.");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, edge, edge);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be shrunk."))), "image/jpeg", 0.85));
}

export function MemberPhotoForm({ slug, orgId, userId, name, photo }: { slug: string; orgId: string; userId: string; name: string; photo?: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(f: File | null) {
    setError(null);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : undefined);
  }

  async function onSave() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const jpeg = await toSquareJpeg(file);
      // Straight to the bucket from the phone; only the path goes to the server.
      const path = photoPath(orgId, userId, Date.now());
      const { error: uploadError } = await createClient().storage.from("member-photos").upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      if (uploadError) {
        setError(`The photo could not be uploaded: ${uploadError.message}`);
        setBusy(false);
        return;
      }
      const r = await setMemberPhoto(slug, userId, path);
      if (!r.ok) {
        setError(r.error ?? "The photo could not be saved.");
        setBusy(false);
        return;
      }
      setFile(null);
      setPreview(undefined);
      setBusy(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "The photo could not be saved.");
      setBusy(false);
    }
  }

  return (
    <Stack gap={3}>
      <Avatar name={name} size="xl" photo={preview ?? photo} />
      <FileField name="photo" label={photo ? "Choose a New Photo" : "Choose a Photo"} hint="A JPG or PNG. It is cropped to a square." accept="image/jpeg,image/png" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      {error && <Notice tone="danger" title={error} />}
      <Button type="button" variant="secondary" onClick={onSave} disabled={!file || busy}>
        {busy ? "Saving" : "Save Photo"}
      </Button>
    </Stack>
  );
}
