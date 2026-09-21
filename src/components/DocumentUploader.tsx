"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ingestFile } from "@/lib/docai/ingest";
import type { DocCategoryId, IngestedRecord, SourceRole, StoredRecord } from "@/lib/docai/types";
import { processDocument } from "@/lib/actions/documents";
import { createClient } from "@/lib/supabase/client";
import { Button, Choice, ChoiceRow, FileField, Label, Notice, SelectField, Stack } from "@/components/kit";

// A client component because ingestion is: src/lib/docai/ingest.ts needs
// File, FileReader, createImageBitmap and canvas, none of which exist on
// the server. It decodes and normalizes here, then hands the server plain
// records. See docs/ARCHITECTURE.md.

// Per Dave: both ways in. Detect is the default, and a type can be forced
// when he already knows what it is and does not want it guessed at.
const CATEGORIES: { id: DocCategoryId | null; label: string }[] = [
  { id: null, label: "Detect it" },
  { id: "transcript", label: "Transcript" },
  { id: "test_scores", label: "Test Scores" },
  { id: "offer_letter", label: "Offer Letter" },
  { id: "recommendation", label: "Recommendation" },
  { id: "financial_aid", label: "Financial Aid" },
  { id: "metrics", label: "Metrics Report" },
];

const SOURCE_ROLES: { id: SourceRole; label: string }[] = [
  { id: "coordinator", label: "I uploaded it" },
  { id: "admin", label: "An owner uploaded it" },
  { id: "parent", label: "A parent sent it" },
  { id: "athlete", label: "The athlete sent it" },
  { id: "email", label: "It came in by email" },
];

function newRequestId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// The bytes go to the documents bucket from here, under this org's
// folder, and the server reads them back. They never ride the server
// action call: Next caps that body at 1MB and a scanned transcript is
// three or four times that. See migrations/0017.
function base64ToBlob(base64: string, mediaType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  return cleaned.slice(0, 80) || "file";
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
  const [sourceRole, setSourceRole] = useState<SourceRole>("coordinator");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!files.length || busy) return;
    setBusy(true);
    setError(null);

    try {
      setStage("Checking the file");
      const requestId = newRequestId();
      const records: IngestedRecord[] = [];
      for (const file of files) {
        records.push(await ingestFile(file, { sourceRole, requestId }));
      }

      const unusable = records.find((r) => r.fallbackReason && !r.base64);
      if (unusable) {
        setError(unusable.fallbackReason ?? "That file could not be read.");
        setBusy(false);
        setStage(null);
        return;
      }

      setStage(files.length === 1 ? "Uploading" : `Uploading ${files.length} files`);
      const supabase = createClient();
      const stored: StoredRecord[] = [];
      for (let i = 0; i < records.length; i++) {
        const record = records[i]!;
        const storagePath = `${orgId}/${requestId}/${i + 1}-${safeFileName(record.originalName)}`;
        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(storagePath, base64ToBlob(record.base64, record.mediaType), { contentType: record.mediaType, upsert: false });
        if (uploadError) {
          setError(`Could not upload ${record.originalName}: ${uploadError.message}`);
          setBusy(false);
          setStage(null);
          return;
        }
        const { base64: _bytes, ...rest } = record;
        stored.push({ ...rest, storagePath });
      }

      setStage(category ? "Reading it" : "Working out what it is");
      const result = await processDocument(slug, {
        records: stored,
        sourceRole,
        requestedCategory: category,
        athleteId: boundTo?.athleteId,
      });

      if (!result.ok || !result.documentId) {
        setError(result.error ?? "Something went wrong reading that document.");
        setBusy(false);
        setStage(null);
        return;
      }
      // A bound upload goes back to the page it started from, because
      // the point there is the verdict that changed, not the document
      // row. The document is still reachable from the documents list.
      router.push(boundTo ? boundTo.returnTo : `/org/${slug}/documents/${result.documentId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "Something went wrong reading that document.");
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <Stack gap={4}>
      {!boundTo && (
        <Stack gap={2}>
          <Label>What Is It</Label>
          <ChoiceRow>
            {CATEGORIES.map((c) => (
              <Choice key={c.label} on={c.id === category} onClick={() => setCategory(c.id)}>
                {c.label}
              </Choice>
            ))}
          </ChoiceRow>
          <Label>{category === null ? "It will work out the type itself. Pick one above to force it." : "Forced. It will be read as this even if it looks like something else."}</Label>
        </Stack>
      )}

      <SelectField
        name="sourceRole"
        label="Where It Came From"
        value={sourceRole}
        onChange={(e) => setSourceRole(e.target.value as SourceRole)}
        hint="Changes how far the result is trusted. Something a parent sent is weighted lower than something you uploaded."
      >
        {SOURCE_ROLES.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </SelectField>

      <FileField
        name="files"
        label={files.length ? `${files.length} File${files.length === 1 ? "" : "s"} Chosen` : "Take a Photo or Choose a File"}
        hint={files.length ? files.map((f) => f.name).join(", ") : "PDF, JPEG, PNG or HEIC"}
        accept="application/pdf,image/jpeg,image/png,image/heic,image/heif"
        multiple
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />

      {error && (
        <Notice tone="danger" title="Could Not Read That">
          {error}
        </Notice>
      )}

      <Button type="button" onClick={onSubmit} disabled={!files.length || busy}>
        {busy ? (stage ?? "Working") : "Read Document"}
      </Button>
    </Stack>
  );
}
