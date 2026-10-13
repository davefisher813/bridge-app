"use client";

import { useActionState, useState } from "react";
import { sendFamilyDocument, type FamilySendState } from "@/lib/actions/familyDocuments";
import { ASSIGNMENT_TEXT_MAX } from "@/lib/data/assignments";
import { FAMILY_SEND_ACCEPT, FAMILY_SEND_FIELDS, FAMILY_SEND_TYPES, familySendPath } from "@/lib/data/familySend";
import { MAX_INGEST_BYTES } from "@/lib/docai/limits";
import { ingestFile } from "@/lib/docai/ingest";
import { createClient } from "@/lib/supabase/client";
import { Button, FileField, Form, Notice, SelectField, Stack, TextAreaField } from "@/components/kit";

// The Athlete login sends a document for its own athlete, outside any
// assignment (Doc AI Piece 5, migration 0066): a PDF, JPG or PNG, with
// an optional type and note. The file goes to the documents bucket from
// the browser, under <org>/family/<athlete>_<request>/, and only its
// path rides the action (Next caps a server action body at 1MB), the
// same as an assignment's file (AssignmentSubmitForm).
//
// A photo also gets the copy the staff uploader makes for the reader:
// scaled down on the phone (ingestFile, longest side MAX_IMAGE_EDGE), put
// beside the original. The original is kept as it came. Nothing here
// reads the file with a model; the document is filed for an Admin.

function newRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function base64ToBlob(base64: string, mediaType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}

const EMPTY_STATE: FamilySendState = { errors: {} };

export interface FamilyDocumentFormProps {
  slug: string;
  orgId: string;
  athleteId: string;
}

export function FamilyDocumentForm({ slug, orgId, athleteId }: FamilyDocumentFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<string | null>(null);

  async function send(prev: FamilySendState, formData: FormData): Promise<FamilySendState> {
    const note = String(formData.get(FAMILY_SEND_FIELDS.note) ?? "");
    if (!file || file.size === 0) return { errors: { file: "Choose a file to send." }, note };
    // A courtesy before a slow upload; the action and the bucket check again.
    if (file.size > MAX_INGEST_BYTES) {
      return { errors: { file: `${file.name} is over ${Math.floor(MAX_INGEST_BYTES / (1024 * 1024))} MB. Send a smaller file.` }, note };
    }
    const requestId = newRequestId();
    const path = familySendPath(orgId, athleteId, requestId, file.name);
    if (!path) return { errors: { file: "Send a PDF, JPG or PNG." }, note };

    const out = new FormData();
    out.set(FAMILY_SEND_FIELDS.note, note);
    out.set(FAMILY_SEND_FIELDS.type, String(formData.get(FAMILY_SEND_FIELDS.type) ?? ""));

    setStage("Uploading");
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) {
      setStage(null);
      return { errors: { file: `Could not upload ${file.name}: ${uploadError.message}` }, note };
    }
    out.set(FAMILY_SEND_FIELDS.storagePath, path);
    out.set(FAMILY_SEND_FIELDS.fileName, file.name);
    out.set(FAMILY_SEND_FIELDS.mediaType, file.type);

    // The reader's copy of a photo. A browser that cannot prepare one
    // sends the original alone.
    if (file.type === "image/jpeg" || file.type === "image/png") {
      try {
        const record = await ingestFile(file, { sourceRole: "parent", requestId });
        const readerPath = record.base64 ? familySendPath(orgId, athleteId, requestId, file.name, "reader-") : null;
        if (readerPath) {
          const { error: copyError } = await supabase.storage.from("documents").upload(readerPath, base64ToBlob(record.base64, record.mediaType), { contentType: record.mediaType, upsert: false });
          if (!copyError) out.set(FAMILY_SEND_FIELDS.readerPath, readerPath);
        }
      } catch {
        // The original is enough to send.
      }
    }

    setStage("Sending");
    try {
      // A good send redirects to the athlete's page and never returns.
      return await sendFamilyDocument(slug, athleteId, prev, out);
    } finally {
      setStage(null);
    }
  }

  const [state, formAction, pending] = useActionState(send, EMPTY_STATE);

  return (
    <Form action={formAction} error={state.errors.form}>
      <Stack gap={4}>
        <Stack gap={2}>
          <FileField
            name="file"
            label={file ? "1 File Chosen" : "Take a Photo or Choose a File"}
            hint={file ? file.name : "PDF, JPG or PNG."}
            accept={FAMILY_SEND_ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {state.errors.file && (
            <Notice tone="danger" title="Could Not Send That">
              {state.errors.file}
            </Notice>
          )}
        </Stack>
        <SelectField name={FAMILY_SEND_FIELDS.type} label="Type" hint="Optional." defaultValue="" error={state.errors.docType}>
          <option value="">Not Sure</option>
          {FAMILY_SEND_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </SelectField>
        <TextAreaField name={FAMILY_SEND_FIELDS.note} label="Note" hint="Optional." maxLength={ASSIGNMENT_TEXT_MAX} defaultValue={state.note ?? ""} error={state.errors.note} />
        <Button disabled={pending || !file}>{pending ? (stage ? `${stage}...` : "Sending...") : "Send Document"}</Button>
      </Stack>
    </Form>
  );
}
