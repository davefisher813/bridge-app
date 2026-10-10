"use client";

import { FILE_TYPE_LABEL, FILE_TYPES, type FileTypeId } from "@/lib/documents/fileTypes";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ingestFile } from "@/lib/docai/ingest";
import type { DocCategoryId, SourceRole, StoredRecord } from "@/lib/docai/types";
import { processDocument, type OriginalUpload } from "@/lib/actions/documents";
import { createClient } from "@/lib/supabase/client";
import { checkVaultFile, readerCanRead, safeStorageName, VAULT_ACCEPT, VAULT_FORMATS_SENTENCE } from "@/lib/vault/format";
import { Button, Choice, ChoiceRow, FileField, Label, Notice, SelectField, Stack } from "@/components/kit";

// A client component because the checks and the upload are: the file is
// read here, checked here (the same pure function the server runs again
// on the stored bytes), and sent straight to the documents bucket from
// the browser, bytes untouched. Only a path goes to the server action;
// a server action's body is capped at 1MB and a document is not.
//
// Seven formats are stored: PDF, Word, Excel, CSV, JPG, PNG and TXT. A
// file is stored exactly as picked. Picking one of the six types also
// has the existing reader read a PDF or a photo; a photo then goes up
// twice, once untouched and once shrunk for the reader (src/lib/docai/
// ingest.ts, as before). No type means: stored, and straight to Needs
// Review.

// No Type is the default. The six types still read as they always did.
// After them, the types the reader never reads (migration 0054): stored
// and labelled, straight to Needs Review.
const FILE_ONLY: { id: FileTypeId; label: string }[] = FILE_TYPES.map((id) => ({ id, label: FILE_TYPE_LABEL[id] }));
const CATEGORIES: { id: DocCategoryId | null; label: string }[] = [
  { id: null, label: "No Type" },
  { id: "transcript", label: "Transcript" },
  { id: "test_scores", label: "Test Scores" },
  { id: "offer_letter", label: "Offer Letter" },
  { id: "recommendation", label: "Recommendation" },
  { id: "financial_aid", label: "Financial Aid" },
  { id: "metrics", label: "Metrics Report" },
];

const SOURCE_ROLES: { id: SourceRole; label: string }[] = [
  { id: "coordinator", label: "I uploaded it" },
  { id: "admin", label: "An Admin uploaded it" },
  { id: "parent", label: "A parent sent it" },
  { id: "athlete", label: "The athlete sent it" },
  { id: "email", label: "It came in by email" },
];

function newRequestId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function base64ToBlob(base64: string, mediaType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}

export interface DocumentUploaderProps {
  slug: string;
  orgId: string;
  // Bound to one athlete: the category is fixed, the athlete is pinned
  // rather than matched by name, and the user goes back where they
  // started instead of to the documents list. Used by the eligibility
  // screen, where the only useful upload is this athlete's transcript.
  boundTo?: { athleteId: string; athleteName: string; category: DocCategoryId; returnTo: string };
}

export function DocumentUploader({ slug, orgId, boundTo }: DocumentUploaderProps) {
  const router = useRouter();
  const [category, setCategory] = useState<DocCategoryId | null>(boundTo?.category ?? null);
  const [fileAs, setFileAs] = useState<FileTypeId | null>(null);
  const [sourceRole, setSourceRole] = useState<SourceRole>("coordinator");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fail(message: string) {
    setError(message);
    setBusy(false);
    setStage(null);
  }

  async function onSubmit() {
    if (!files.length || busy) return;
    setBusy(true);
    setError(null);

    try {
      // 1. Every file is checked before anything is sent. One that is not
      // one of the seven formats, or whose contents do not match its
      // name, refuses the whole selection and names the file.
      setStage("Checking the files");
      const bytes: Uint8Array[] = [];
      const checks: ReturnType<typeof checkVaultFile>[] = [];
      for (const file of files) {
        const b = new Uint8Array(await file.arrayBuffer());
        const verdict = checkVaultFile(file.name, b);
        if (!verdict.ok) return fail(verdict.reason);
        bytes.push(b);
        checks.push(verdict);
      }

      // 2. A file tagged with a type that the reader can read is also
      // prepared for it, the way every upload was: a photo is scaled down
      // and a large PNG becomes a JPEG. That copy is the reader's; the
      // original goes up as it is.
      const requestId = newRequestId();
      const readers: (StoredRecord | null)[] = [];
      const readerBytes: (string | null)[] = [];
      for (let i = 0; i < files.length; i++) {
        const check = checks[i]!;
        if (!category || !check.ok || !readerCanRead(check.format)) {
          readers.push(null);
          readerBytes.push(null);
          continue;
        }
        const record = await ingestFile(files[i]!, { sourceRole, requestId });
        if (record.fallbackReason && !record.base64) return fail(record.fallbackReason);
        const { base64, ...rest } = record;
        readers.push({ ...rest, storagePath: "" });
        readerBytes.push(base64);
      }

      // 3. The originals go to the bucket untouched, under this org's
      // folder, with the canonical content type for what they are.
      setStage(files.length === 1 ? "Uploading" : `Uploading ${files.length} files`);
      const supabase = createClient();
      const originals: OriginalUpload[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const check = checks[i]!;
        if (!check.ok) return fail(check.reason);
        const storagePath = `${orgId}/${requestId}/${i + 1}-${safeStorageName(file.name)}`;
        const { error: uploadError } = await supabase.storage.from("documents").upload(storagePath, new Blob([bytes[i]! as unknown as BlobPart], { type: check.mediaType }), { contentType: check.mediaType, upsert: false });
        if (uploadError) return fail(`Could not upload ${file.name}: ${uploadError.message}`);

        // A PDF is its own reader file. A photo's reader copy is a second
        // object next to the original.
        let reader = readers[i] ?? null;
        if (reader) {
          if (check.format === "pdf") reader = { ...reader, storagePath };
          else {
            const readerPath = `${orgId}/${requestId}/reader-${i + 1}-${safeStorageName(file.name)}`;
            const { error: copyError } = await supabase.storage.from("documents").upload(readerPath, base64ToBlob(readerBytes[i]!, reader.mediaType), { contentType: reader.mediaType, upsert: false });
            if (copyError) return fail(`Could not upload ${file.name}: ${copyError.message}`);
            reader = { ...reader, storagePath: readerPath };
          }
        }
        originals.push({ storagePath, name: file.name, reader });
      }

      setStage(category ? "Reading it" : "Storing it");
      const result = await processDocument(slug, {
        originals,
        sourceRole,
        requestedCategory: category,
        fileAs: category ? null : fileAs,
        athleteId: boundTo?.athleteId,
      });

      if (!result.ok || !result.documentId) return fail(result.error ?? "Something went wrong storing that.");
      // A bound upload goes back to the page it started from, because
      // the point there is the verdict that changed, not the document
      // row. One file opens its document; several open the list.
      router.push(boundTo ? boundTo.returnTo : (result.documentIds?.length ?? 1) > 1 ? `/org/${slug}/documents` : `/org/${slug}/documents/${result.documentId}`);
      router.refresh();
    } catch (e) {
      fail((e as Error).message || "Something went wrong storing that.");
    }
  }

  return (
    <Stack gap={4}>
      {!boundTo && (
        <Stack gap={2}>
          <Label>What Is It</Label>
          <ChoiceRow>
            {CATEGORIES.map((c) => (
              <Choice
                key={c.label}
                on={c.id === category && (c.id !== null || fileAs === null)}
                onClick={() => {
                  setCategory(c.id);
                  setFileAs(null);
                }}
              >
                {c.label}
              </Choice>
            ))}
            {FILE_ONLY.map((t) => (
              <Choice
                key={t.id}
                on={category === null && fileAs === t.id}
                onClick={() => {
                  setCategory(null);
                  setFileAs(t.id);
                }}
              >
                {t.label}
              </Choice>
            ))}
          </ChoiceRow>
          <Label>
            {category !== null
              ? "It is read as this type. If it does not look like it, it is kept in Needs Review and says so."
              : fileAs !== null
                ? "It is stored and labelled as this type, not read, and goes to Needs Review."
                : "It is stored as it is and goes to Needs Review. Pick a type to have it read."}
          </Label>
        </Stack>
      )}

      <SelectField name="sourceRole" label="Where It Came From" value={sourceRole} onChange={(e) => setSourceRole(e.target.value as SourceRole)}>
        {SOURCE_ROLES.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </SelectField>

      <FileField
        name="files"
        label={files.length ? `${files.length} File${files.length === 1 ? "" : "s"} Chosen` : "Take a Photo or Choose a File"}
        hint={files.length ? files.map((f) => f.name).join(", ") : `${VAULT_FORMATS_SENTENCE}. Up to 10 MB each.`}
        // HEIC is deliberately NOT listed. An iPhone converts a HEIC
        // photo to JPEG on the way into a file input only when HEIC is
        // not among the accepted types; listing it handed the app a
        // format nothing downstream can read and a refusal for every
        // camera photo Dave took.
        accept={VAULT_ACCEPT}
        multiple
        onChange={(e) => {
          setFiles(Array.from(e.target.files ?? []));
          setError(null);
        }}
      />

      {error && (
        <Notice tone="danger" title="Could Not Store That">
          {error}
        </Notice>
      )}

      <Button type="button" onClick={onSubmit} disabled={!files.length || busy}>
        {busy ? (stage ?? "Working") : category ? "Upload and Read" : "Upload"}
      </Button>
    </Stack>
  );
}
