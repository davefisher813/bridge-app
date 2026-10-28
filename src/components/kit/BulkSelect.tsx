"use client";

// Multi-select with a bulk action bar (Dave, 2026-10-13: "dozens of
// student athletes; one-at-a-time actions are too slow").
//
// One pattern for every operational list. A page wraps its rows in
// <BulkSelect ids=[every id on the screen] actions={...}>, gives each Row
// `select={<BulkCheck id=... />}`, and lists its bulk actions as
// <BulkAction>s. Nothing is selected until the person taps Select, so a
// list reads exactly as it did before.
//
// While selecting, a bar covers the tab bar with the count ("3 selected"
// is always on screen), Select All / Clear, Done and the actions. An
// action opens one sheet that names the count and, for a destructive one,
// says so in red. The sheet is the single confirmation. It submits the
// ids as repeated `ids` fields to a server action, which owns the checks,
// the log and the redirect; this file never writes data.
//
// Selection clears itself when the server action lands (the redirect
// brings a new ?notice= or ?error=), so a finished action never leaves a
// stale selection behind.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Sheet } from "./index";

interface BulkState {
  selecting: boolean;
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  // Select or clear several at once: a row that stands for a stack of files.
  toggleMany: (ids: readonly string[]) => void;
}

const BulkContext = createContext<BulkState | null>(null);

export function BulkSelect({
  ids,
  noun,
  actions,
  children,
}: {
  // Every id on the screen, so Select All has something to select.
  ids: readonly string[];
  // "assignment", "document": singular, lower case. Pluralised by count.
  noun: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const params = useSearchParams();
  const landed = `${params.get("notice") ?? ""}|${params.get("error") ?? ""}`;

  useEffect(() => {
    setSelected(new Set());
    setSelecting(false);
  }, [landed]);

  // An id that left the screen (a filter, a finished action) leaves the
  // selection, so the count never counts a row that is not there.
  useEffect(() => {
    const present = new Set(ids);
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ids]);

  const state = useMemo<BulkState>(
    () => ({
      selecting,
      selected,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      toggleMany: (many) =>
        setSelected((prev) => {
          const next = new Set(prev);
          const all = many.every((id) => next.has(id));
          for (const id of many) {
            if (all) next.delete(id);
            else next.add(id);
          }
          return next;
        }),
    }),
    [selecting, selected],
  );

  const count = selected.size;
  const word = count === 1 ? noun : `${noun}s`;

  return (
    <BulkContext.Provider value={state}>
      {ids.length > 0 && !selecting && (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" inline onClick={() => setSelecting(true)}>
            Select
          </Button>
        </div>
      )}
      {children}
      {selecting && (
        <div className="pb-tabbar fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper" role="region" aria-label="Bulk Actions">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-body font-extrabold text-ink" aria-live="polite">
                {`${count} selected`}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="quiet" inline onClick={() => setSelected(new Set(ids))}>
                  {`Select All ${ids.length}`}
                </Button>
                <Button type="button" variant="quiet" inline disabled={count === 0} onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  inline
                  onClick={() => {
                    setSelected(new Set());
                    setSelecting(false);
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2" data-bulk-noun={word}>
              {actions}
            </div>
          </div>
        </div>
      )}
    </BulkContext.Provider>
  );
}

// The checkbox at the left of a row, shown only while selecting. It is a
// 44px tap target of its own, outside the row's link.
export function BulkCheck({ id, ids, label }: { id?: string; ids?: readonly string[]; label: string }) {
  const ctx = useContext(BulkContext);
  if (!ctx || !ctx.selecting) return null;
  const many = ids ?? (id ? [id] : []);
  return (
    <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center pl-3">
      <input type="checkbox" checked={many.length > 0 && many.every((x) => ctx.selected.has(x))} onChange={() => ctx.toggleMany(many)} aria-label={`Select ${label}`} className="h-6 w-6 accent-[var(--accent)]" />
    </label>
  );
}

// One action on the selection. `action` is a server action taking the
// form data: `ids` (repeated) plus whatever `fields` add. The sheet
// always names the count; `destructive` makes the confirm red. With no
// selection the button is disabled.
export function BulkAction({
  action,
  label,
  noun,
  question,
  confirmLabel,
  destructive = false,
  fields,
  hint,
}: {
  action: (formData: FormData) => void | Promise<void>;
  label: string;
  noun: string;
  // The sheet's title without the count, "Mark Complete" -> "Mark 4 Assignments Complete"
  // is built from `question`: "Mark {n} Complete". {n} becomes "4 Assignments".
  question: string;
  confirmLabel: string;
  destructive?: boolean;
  fields?: ReactNode;
  hint?: ReactNode;
}) {
  const ctx = useContext(BulkContext);
  const [open, setOpen] = useState(false);
  if (!ctx) return null;
  const count = ctx.selected.size;
  const title = question.replace("{n}", `${count} ${titleCase(count === 1 ? noun : `${noun}s`)}`);
  return (
    <>
      <Button type="button" variant={destructive ? "destructive" : "secondary"} inline disabled={count === 0} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Sheet open={open && count > 0} onClose={() => setOpen(false)} title={title}>
        <form action={action} className="flex flex-col gap-4">
          {[...ctx.selected].map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}
          {hint && <div className="text-body text-muted">{hint}</div>}
          {fields}
          <div className="flex flex-col gap-3">
            <Button variant={destructive ? "destructive" : "primary"}>{confirmLabel}</Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Keep
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
