"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ingestFile } from "@/lib/docai/ingest";
import type { DocCategoryId, IngestedRecord, SourceRole } from "@/lib/docai/types";
import { processDocument } from "@/lib/actions/documents";
import { fieldClass, labelClass, submitClass } from "@/components/formStyles";
import { TINT } from "@/components/statusHue";

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

export function DocumentUploader({ slug }: { slug: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<DocCategoryId | null>(null);
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

      setStage(category ? "Reading it" : "Working out what it is");
      const result = await processDocument(slug, { records, sourceRole, requestedCategory: category });

      if (!result.ok || !result.documentId) {
        setError(result.error ?? "Something went wrong reading that document.");
        setBusy(false);
        setStage(null);
        return;
      }
      router.push(`/org/${slug}/documents/${result.documentId}`);
    } catch (e) {
      setError((e as Error).message || "Something went wrong reading that document.");
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className={labelClass}>What is it</label>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => {
            const on = c.id === category;
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${on ? TINT.committed : TINT.neutral}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {category === null
            ? "It will work out the type itself. Pick one above to force it."
            : "Forced. It will be read as this even if it looks like something else."}
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="sourceRole">
          Where it came from
        </label>
        <select
          id="sourceRole"
          className={fieldClass(false)}
          value={sourceRole}
          onChange={(e) => setSourceRole(e.target.value as SourceRole)}
        >
          {SOURCE_ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-muted">
          Changes how far the result is trusted. Something a parent sent is weighted lower than something you uploaded.
        </p>
      </div>

      <div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/heic,image/heif"
          multiple
          className="hidden"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-[12px] border-2 border-dashed border-line bg-paper px-4 py-9 text-center"
        >
          <div className="mb-2 flex justify-center text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-8 w-8">
              <path d="M12 16V4M7.5 8.5L12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15" strokeLinecap="round" />
            </svg>
          </div>
          <div className="text-[13px] font-extrabold text-ink">
            {files.length ? `${files.length} file${files.length === 1 ? "" : "s"} chosen` : "Take a photo or choose a file"}
          </div>
          <div className="mt-1 text-[11.5px] text-muted">
            {files.length ? files.map((f) => f.name).join(", ") : "PDF, JPEG, PNG or HEIC"}
          </div>
        </button>
      </div>

      {error && (
        <div className="rounded-[10px] border-l-[5px] border-l-ios-pink bg-paper px-3.5 py-3">
          <div className="text-[13px] font-bold text-ink">Could not read that</div>
          <div className="mt-0.5 text-[11.5px] text-muted">{error}</div>
        </div>
      )}

      <button type="button" onClick={onSubmit} disabled={!files.length || busy} className={`${submitClass} w-full disabled:opacity-50`}>
        {busy ? (stage ?? "Working") : "Read document"}
      </button>
    </div>
  );
}
