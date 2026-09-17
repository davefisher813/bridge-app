"use client";

// Entering a school's NCAA approved-course list.
//
// The design problem, stated plainly: a high school's list runs to
// eighty or a hundred rows. A form with an Add Course button and a
// subject dropdown per row is an afternoon of typing on a phone, and an
// afternoon is the same as never. So the primary path is paste: select
// the table on the Eligibility Center's page, paste it here, and the
// parser works out the columns. Typing a row by hand is the fallback,
// not the default.
//
// The parse never guesses a subject. A category it does not recognise
// comes back null and this screen makes a person choose, because the
// subject decides which per-subject minimum a course counts toward and
// a wrong one reports a requirement as met when it is not. Rows that
// need attention sort to the top and the save button stays disabled
// until none are left.

import { useActionState, useMemo, useState } from "react";
import { parseApprovedListPaste, describeParse, type ParsedRow } from "@/lib/fit/ncaa/approvedListPaste";
import type { SubjectArea } from "@/lib/fit/ncaa/coreGpa";
import type { ApprovedListActionState } from "@/lib/actions/approvedCourses";
import { fieldClass, submitClass } from "@/components/formStyles";
import { RailCard, SectionHeader } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";

const SUBJECTS: Array<[SubjectArea, string]> = [
  ["english", "English"],
  ["math", "Math"],
  ["science", "Science"],
  ["social_science", "Social science"],
  ["other_academic", "Other academic"],
];

type Row = ParsedRow & { id: number };

export function ApprovedListForm({
  action,
  schoolName,
  existing,
}: {
  action: (state: ApprovedListActionState, formData: FormData) => Promise<ApprovedListActionState>;
  schoolName: string;
  existing?: Array<{ title: string; subject: SubjectArea; maxCredit: number | null; weighted: boolean }>;
}) {
  const [state, formAction, pending] = useActionState(action, { errors: {} });
  const [paste, setPaste] = useState("");
  const [nextId, setNextId] = useState(1000);
  const [rows, setRows] = useState<Row[]>(
    (existing ?? []).map((c, i) => ({ ...c, problem: null, raw: c.title, id: i })),
  );
  const [isComplete, setIsComplete] = useState(false);

  const parsed = useMemo(() => (paste.trim() ? parseApprovedListPaste(paste) : null), [paste]);

  function applyPaste() {
    if (!parsed) return;
    let id = nextId;
    setRows(parsed.rows.map((r) => ({ ...r, id: id++ })));
    setNextId(id);
    setPaste("");
  }

  function setSubject(id: number, subject: SubjectArea) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, subject, problem: r.problem?.startsWith("No NCAA") ? null : r.problem } : r)));
  }
  function remove(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }
  function addBlank() {
    setRows((rs) => [...rs, { id: nextId, title: "", subject: null, maxCredit: null, weighted: false, problem: null, raw: "" }]);
    setNextId((n) => n + 1);
  }

  const needAttention = rows.filter((r) => r.subject === null || r.problem !== null);
  // Ordered so what needs a decision is at the top, rather than buried
  // at row sixty of a hundred.
  const ordered = [...needAttention, ...rows.filter((r) => !needAttention.includes(r))];
  const blockedBy =
    rows.length === 0
      ? "Paste a list or add a course."
      : needAttention.length > 0
        ? `${needAttention.length} ${needAttention.length === 1 ? "row needs" : "rows need"} attention.`
        : isComplete && rows.length < 8
          ? "A complete list cannot be eight courses short of a catalog. Leave it partial."
          : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="schoolName" value={schoolName} />

      {state.errors.form && (
        <div className="rounded-[10px] bg-tint-danger px-3.5 py-3 text-[13.5px] font-semibold text-tint-danger-on">{state.errors.form}</div>
      )}

      <div>
        <label className="mb-1.5 block text-[12px] font-bold text-muted">PASTE THE LIST</label>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          placeholder={"Select the table at web3.ncaa.org/hsportal and paste it here.\nEnglish 9\tEnglish\nAlgebra I\tMathematics"}
          className={`${fieldClass(false)} resize-none font-mono text-[13px]`}
        />
        {parsed && (
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-bold text-muted">{describeParse(parsed)}</span>
            <button
              type="button"
              onClick={applyPaste}
              className="inline-flex min-h-[44px] items-center rounded-[8px] bg-solid-accent px-4 text-[14.5px] font-bold text-solid-accent-on"
            >
              Use these
            </button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <>
          <SectionHeader label="Courses" count={rows.length} role={needAttention.length ? "offer" : "committed"} kind="checklist" />
          <div className="flex flex-col gap-2">
            {ordered.map((r) => {
              const i = rows.indexOf(r);
              const bad = r.subject === null || r.problem !== null;
              return (
                <RailCard key={r.id} role={bad ? "offer" : "committed"} kind={bad ? "warning" : "course"}>
                  <input type="hidden" name={`title_${i}`} value={r.title} />
                  <input type="hidden" name={`subject_${i}`} value={r.subject ?? ""} />
                  <input type="hidden" name={`credit_${i}`} value={r.maxCredit ?? ""} />
                  {r.weighted && <input type="hidden" name={`weighted_${i}`} value="on" />}

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-bold leading-tight text-ink">{r.title || "Untitled"}</div>
                      <div className="mt-0.5 text-[12.5px] leading-tight text-muted">
                        {r.maxCredit !== null && `${r.maxCredit} credit`}
                        {r.maxCredit !== null && r.weighted && " · "}
                        {r.weighted && "weighted"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      className="-my-2 inline-flex min-h-[44px] flex-shrink-0 items-center py-2 pl-3 text-[12.5px] font-bold text-muted"
                    >
                      Remove
                    </button>
                  </div>

                  {r.problem && <div className="mt-1.5 text-[12.5px] font-semibold leading-tight text-tint-accent-on">{r.problem}</div>}

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {SUBJECTS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSubject(r.id, value)}
                        // A control, not a status read-out. Since the
                        // 2026-09-17 pass no chip carries a fill, so
                        // "chosen" is a ring rather than a coloured
                        // block; the touch target and the weight change
                        // do the rest.
                        className={`inline-flex min-h-[44px] items-center rounded-full border px-3.5 text-[13px] font-bold ${
                          r.subject === value ? "border-accent text-ink ring-2 ring-accent" : "border-line text-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </RailCard>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addBlank}
            className="inline-flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[14.5px] font-bold text-ink"
          >
            Add a course by hand
          </button>
        </>
      )}

      <div>
        <label className="mb-1.5 block text-[12px] font-bold text-muted">CEEB CODE</label>
        <input name="ceebCode" inputMode="numeric" placeholder="070415" className={fieldClass(false)} />
      </div>

      <div>
        <label className="mb-1.5 block text-[12px] font-bold text-muted">READ OFF THE PORTAL ON</label>
        <input name="retrievedOn" type="date" className={`${fieldClass(false)} tabular-nums`} />
      </div>

      <div>
        <label className="mb-1.5 block text-[12px] font-bold text-muted">WHERE THIS CAME FROM</label>
        <input
          name="sourceNote"
          placeholder="Transcribed from the NCAA portal"
          className={fieldClass(state.errors.sourceNote)}
        />
        {state.errors.sourceNote && <p className="mt-1 text-[12.5px] font-semibold text-tint-danger-on">{state.errors.sourceNote}</p>}
      </div>

      {/* The one field that changes what the engine is allowed to conclude. */}
      <label className="flex items-start gap-3 rounded-[10px] bg-paper px-3.5 py-3">
        <input
          type="checkbox"
          name="isComplete"
          checked={isComplete}
          onChange={(e) => setIsComplete(e.target.checked)}
          className="mt-0.5 h-[20px] w-[20px] flex-shrink-0"
        />
        <span className="min-w-0">
          <span className="block text-[14.5px] font-bold text-ink">This is the school&apos;s whole list</span>
          <span className="mt-0.5 block text-[12.5px] leading-tight text-muted">
            Only tick this if you copied all of it. A complete list means a course missing from it does not count toward the core GPA. A partial
            one can confirm a course and never rules one out.
          </span>
        </span>
      </label>

      {blockedBy && <div className="text-[12.5px] font-semibold text-muted">{blockedBy}</div>}

      <button type="submit" disabled={pending || blockedBy !== null} className={submitClass}>
        {pending ? "Saving..." : "Save the list"}
      </button>

      <p className="text-[12px] leading-relaxed text-muted">
        <RowGlyph kind="info" role="neutral" className="mr-1 inline h-[13px] w-[13px] align-[-2px]" />
        Saving recalculates every athlete at {schoolName} straight away.
      </p>
    </form>
  );
}
