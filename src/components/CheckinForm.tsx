"use client";

import { orgToday } from "@/lib/datetime/today";
import { useActionState, useState } from "react";
import { CHECKIN_KINDS, CHECKIN_KIND_LABEL } from "@/lib/checkins";
import { CHECKIN_PHOTO_EDGE, checkinPhotoPath } from "@/lib/checkinPhoto";
import type { CheckinActionState } from "@/lib/actions/checkins";
import { createClient } from "@/lib/supabase/client";
import { Button, CheckField, Field, FileField, Form, Grid2, Hidden, Label, Notice, Photo, SelectField, TextAreaField } from "@/components/kit";

// Logging a check-in on an athlete. Staff only: the log and its notes
// never reach a family login (migration 0039), and the hint says so.
//
// A photo (migration 0056): the phone shrinks it to a JPEG, longest
// side 1600px, and puts it in the bucket the moment it is picked; only
// its path rides with the form, and the server checks the bytes before
// the check-in points at them.

type ServerAction = (prevState: CheckinActionState, formData: FormData) => Promise<CheckinActionState>;

const EMPTY_STATE: CheckinActionState = { errors: {} };

// `initial` is the Edit screen for one entry (audit crud F21): the same
// form, prefilled.
export interface CheckinFormInitial {
  kind: string;
  occurredOn: string;
  notes: string | null;
  photoUrl?: string;
}

async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, CHECKIN_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot shrink the photo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be shrunk."))), "image/jpeg", 0.8));
}

export function CheckinForm({ action, orgId, athleteId, initial, submitLabel = "Log Check-In" }: { action: ServerAction; orgId: string; athleteId: string; initial?: CheckinFormInitial; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [photoPath, setPhotoPath] = useState("");
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function onPick(file: File | null) {
    setPhotoError(null);
    setPhotoPath("");
    setPreview(file ? URL.createObjectURL(file) : undefined);
    if (!file) return;
    setUploading(true);
    try {
      const jpeg = await toJpeg(file);
      const path = checkinPhotoPath(orgId, athleteId, Date.now());
      const { error } = await createClient().storage.from("checkin-photos").upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error(`The photo could not be uploaded: ${error.message}`);
      setPhotoPath(path);
    } catch (e) {
      setPreview(undefined);
      setPhotoError((e as Error).message || "The photo could not be uploaded.");
    }
    setUploading(false);
  }

  const shown = preview ?? initial?.photoUrl;

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <SelectField name="kind" label="Type" defaultValue={initial?.kind ?? "call"} error={state.errors.kind}>
          {CHECKIN_KINDS.map((k) => (
            <option key={k} value={k}>
              {CHECKIN_KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
        <Field name="occurredOn" label="Date" type="date" defaultValue={initial?.occurredOn ?? orgToday()} error={state.errors.occurredOn} />
      </Grid2>
      <TextAreaField name="notes" label="Notes" maxLength={2000} defaultValue={initial?.notes ?? undefined} error={state.errors.notes} />
      {shown && <Photo src={shown} alt="Photo from this check-in" />}
      <FileField
        name="photoFile"
        label={shown ? "Choose a Different Photo" : "Add a Photo"}
        hint="A JPG or PNG from the meeting. Only Admins see it."
        accept="image/jpeg,image/png"
        onChange={(e) => {
          // Emptied straight away: the file itself never rides with the
          // form (a camera photo is over the server's body limit); only
          // the path of the shrunk copy does.
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          void onPick(file);
        }}
      />
      <Hidden name="photoPath" value={photoPath} />
      {uploading && <Label>Uploading the photo...</Label>}
      {(photoError || state.errors.photo) && <Notice tone="danger" title={photoError ?? state.errors.photo} />}
      {initial?.photoUrl && !preview && <CheckField name="removePhoto" label="Remove Photo" hint="Take the photo off this check-in when you save." />}
      <Button variant="secondary" disabled={pending || uploading}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </Form>
  );
}
