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
import { Body, Button, Card, CheckField, Choice, ChoiceRow, Field, Form, Grid2, Hidden, Inline, Label, Prose, Section, Stack, TextAreaField } from "@/components/kit";

const SUBJECTS: Array<[SubjectArea, string]> = [
  ["english", "English"],
  ["math", "Math"],
  ["science", "Science"],
  ["social_science", "Social science"],
  ["other_academic", "Other academic"],
];

type Row = ParsedRow & { id: number };

export interface ApprovedListDefaults {
  ceebCode?: string | null;
  retrievedOn?: string | null;
  sourceNote?: string | null;
  isComplete?: boolean;
}

export function ApprovedListForm({
  action,
  schoolName,
  existing,
  defaults = {},
}: {
  action: (state: ApprovedListActionState, formData: FormData) => Promise<ApprovedListActionState>;
  schoolName: string;
  // The list on file, when this is an edit: every course comes back as a
  // row to keep, correct or remove, rather than an empty form to retype
  // eighty rows into (crud F13).
  existing?: Array<{ title: string; subject: SubjectArea; maxCredit: number | null; weighted: boolean }>;
  // The list's own fields on an edit; on a new list, the CEEB code on
  // file for the school (the public directory, or the portal's list).
  defaults?: ApprovedListDefaults;
}) {
  const [state, formAction, pending] = useActionState(action, { errors: {} });
  const [paste, setPaste] = useState("");
  const [nextId, setNextId] = useState(1000);
  const [rows, setRows] = useState<Row[]>((existing ?? []).map((c, i) => ({ ...c, problem: null, raw: c.title, id: i })));
  const [isComplete, setIsComplete] = useState(defaults.isComplete ?? false);
  const [editing, setEditing] = useState<number | null>(null);

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
    setEditing(nextId);
    setNextId((n) => n + 1);
  }
  // Correcting one course in place: its title, its credit cap, weighted.
  function patch(id: number, change: Partial<Pick<Row, "title" | "maxCredit" | "weighted">>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change, problem: change.title !== undefined && r.problem?.startsWith("No title") ? null : r.problem } : r)));
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
    <Form action={formAction} error={state.errors.form}>
      <Hidden name="schoolName" value={schoolName} />

      <TextAreaField
        name="paste"
        label="Paste the List"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        rows={5}
        hint="One course per line."
      />
      {parsed && (
        <Inline>
          <div className="min-w-0 flex-1">
            <Label>{describeParse(parsed)}</Label>
          </div>
          <Button type="button" inline onClick={applyPaste}>
            Use These
          </Button>
        </Inline>
      )}

      {rows.length > 0 && (
        <Section label="Courses" count={rows.length} role={needAttention.length ? "offer" : "committed"} kind="checklist">
          {ordered.map((r) => {
            const i = rows.indexOf(r);
            const bad = r.subject === null || r.problem !== null;
            return (
              <Card key={r.id}>
                <Hidden name={`title_${i}`} value={r.title} />
                <Hidden name={`subject_${i}`} value={r.subject ?? ""} />
                <Hidden name={`credit_${i}`} value={r.maxCredit === null ? "" : String(r.maxCredit)} />
                {r.weighted && <Hidden name={`weighted_${i}`} value="on" />}
                <Stack gap={2}>
                  <Inline align="start">
                    <div className="min-w-0 flex-1">
                      <Body weight="bold">{r.title || "Untitled"}</Body>
                      <Label>
                        {[r.maxCredit !== null ? `${r.maxCredit} credit` : null, r.weighted ? "weighted" : null].filter(Boolean).join(" · ") ||
                          (bad ? "Needs a subject" : "Ready")}
                      </Label>
                    </div>
                    <Button type="button" variant="quiet" inline onClick={() => setEditing(editing === r.id ? null : r.id)}>
                      {editing === r.id ? "Done" : "Edit"}
                    </Button>
                    <Button type="button" variant="quiet" inline onClick={() => remove(r.id)}>
                      Remove
                    </Button>
                  </Inline>
                  {editing === r.id && (
                    <Stack gap={3}>
                      <Field id={`course-title-${r.id}`} name={`edit_title_${r.id}`} label="Course Title" value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} />
                      <Field
                        id={`course-credit-${r.id}`}
                        name={`edit_credit_${r.id}`}
                        label="Credit Cap"
                        inputMode="decimal"
                        value={r.maxCredit === null ? "" : String(r.maxCredit)}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          const n = Number(v);
                          patch(r.id, { maxCredit: v === "" || !Number.isFinite(n) ? null : n });
                        }}
                      />
                      <CheckField id={`course-weighted-${r.id}`} name={`edit_weighted_${r.id}`} label="Weighted" checked={r.weighted} onChange={(e) => patch(r.id, { weighted: e.target.checked })} />
                    </Stack>
                  )}
                  {r.problem && <Label tone="danger">{r.problem}</Label>}
                  <ChoiceRow>
                    {SUBJECTS.map(([value, label]) => (
                      <Choice key={value} on={r.subject === value} onClick={() => setSubject(r.id, value)}>
                        {label}
                      </Choice>
                    ))}
                  </ChoiceRow>
                </Stack>
              </Card>
            );
          })}
          <Button type="button" variant="secondary" onClick={addBlank}>
            Add a Course by Hand
          </Button>
        </Section>
      )}

      <Grid2>
        <Field name="ceebCode" label="CEEB Code" inputMode="numeric" defaultValue={defaults.ceebCode ?? ""} />
        <Field name="retrievedOn" label="Read Off the Portal On" type="date" defaultValue={defaults.retrievedOn ?? ""} />
      </Grid2>

      <Field
        name="sourceNote"
        label="Where This Came From"
        defaultValue={defaults.sourceNote ?? ""}
        error={state.errors.sourceNote}
      />

      {/* The one field that changes what the engine is allowed to conclude. */}
      <CheckField
        name="isComplete"
        checked={isComplete}
        onChange={(e) => setIsComplete(e.target.checked)}
        label="This Is the School's Whole List"
        hint="Only tick this if you copied all of it."
      />

      {blockedBy && <Label>{blockedBy}</Label>}

      <Button disabled={pending || blockedBy !== null}>{pending ? "Saving..." : "Save the List"}</Button>

      <Prose>Saving recalculates every athlete at {schoolName} straight away.</Prose>
    </Form>
  );
}
