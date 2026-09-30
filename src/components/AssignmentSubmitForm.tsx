"use client";

import { useActionState, useState } from "react";
import { submitAssignment, type AssignmentActionState } from "@/lib/actions/assignments";
import { SUBMIT_FIELDS, ASSIGNMENT_TEXT_MAX, familyStoragePath, type AssignmentKind } from "@/lib/data/assignments";
import { MAX_INGEST_BYTES } from "@/lib/docai/limits";
import { createClient } from "@/lib/supabase/client";
import { Button, FileField, Form, Notice, Stack, TextAreaField } from "@/components/kit";

// The Athlete login's answer to one assignment: a note, and for an
// upload assignment a file. A client component because the file goes to
// the documents bucket from the browser, under <org>/family/<request>/,
// and only its path rides the action (Next caps a server action body at
// 1MB, the same reason DocumentUploader uploads first). Then the one
// write is submitAssignment, which reads the bytes back, checks them and
// calls the database function. Nothing here reads the file or a model.
//
// The size limit is the shared one (src/lib/docai/limits.ts). The check
// below is a courtesy so a person is told before a slow upload; the
// action and the bucket both check it again.

function newRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const EMPTY_STATE: AssignmentActionState = { errors: {} };

const NOTE_LABEL: Record<AssignmentKind, string> = {
  upload: "Note",
  complete_info: "Your Answer",
  confirm: "Note",
  other: "Note",
};

const NOTE_HINT: Record<AssignmentKind, string> = {
  upload: "Optional. Anything the reviewer should know about the file.",
  complete_info: "Write what was asked for.",
  confirm: "Optional. Add a line if there is something to say.",
  other: "Optional. Say what you did.",
};

export interface AssignmentSubmitFormProps {
  slug: string;
  orgId: string;
  athleteId: string;
  assignmentId: string;
  kind: AssignmentKind;
  // True when the row was sent back: the button says so.
  resubmit: boolean;
}

export function AssignmentSubmitForm({ slug, orgId, athleteId, assignmentId, kind, resubmit }: AssignmentSubmitFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<string | null>(null);

  // The form's action: upload the file first when there is one, then hand
  // the server only its path, name and type (SUBMIT_FIELDS).
  async function send(prev: AssignmentActionState, formData: FormData): Promise<AssignmentActionState> {
    const note = String(formData.get(SUBMIT_FIELDS.note) ?? "");
    const out = new FormData();
    out.set(SUBMIT_FIELDS.note, note);

    if (kind === "upload") {
      if (!file || file.size === 0) return { errors: { file: "Choose a file to send." }, note };
      if (file.size > MAX_INGEST_BYTES) {
        return { errors: { file: `${file.name} is over ${Math.floor(MAX_INGEST_BYTES / (1024 * 1024))} MB. Send a smaller file.` }, note };
      }
      const path = familyStoragePath(orgId, newRequestId(), file.name);
      if (!path) return { errors: { file: "That file could not be sent from this screen. Try again." }, note };

      setStage("Uploading");
      const { error: uploadError } = await createClient()
        .storage.from("documents")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (uploadError) {
        setStage(null);
        return { errors: { file: `Could not upload ${file.name}: ${uploadError.message}` }, note };
      }
      out.set(SUBMIT_FIELDS.storagePath, path);
      out.set(SUBMIT_FIELDS.fileName, file.name);
      out.set(SUBMIT_FIELDS.mediaType, file.type);
    }

    setStage("Sending");
    try {
      // A good submission redirects to the athlete's page and never returns.
      return await submitAssignment(slug, athleteId, assignmentId, prev, out);
    } finally {
      setStage(null);
    }
  }

  const [state, formAction, pending] = useActionState(send, EMPTY_STATE);
  const label = resubmit ? "Fix and Resubmit" : "Submit";

  return (
    <Form action={formAction} error={state.errors.form}>
      <Stack gap={4}>
        {kind === "upload" && (
          <Stack gap={2}>
            <FileField
              name="file"
              label={file ? "1 File Chosen" : "Take a Photo or Choose a File"}
              hint={file ? file.name : "A PDF, a JPEG or PNG, or a photo from the camera."}
              // HEIC stays off the list on purpose, as in DocumentUploader:
              // an iPhone converts a camera photo to JPEG only when HEIC
              // is not accepted.
              accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {state.errors.file && (
              <Notice tone="danger" title="Could Not Send That">
                {state.errors.file}
              </Notice>
            )}
          </Stack>
        )}
        <TextAreaField
          name={SUBMIT_FIELDS.note}
          label={NOTE_LABEL[kind]}
          hint={NOTE_HINT[kind]}
          maxLength={ASSIGNMENT_TEXT_MAX}
          defaultValue={state.note ?? ""}
          error={state.errors.note}
        />
        <Button disabled={pending || (kind === "upload" && !file)}>{pending ? (stage ? `${stage}...` : "Sending...") : label}</Button>
      </Stack>
    </Form>
  );
}
