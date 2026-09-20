"use client";

// A destructive action that asks first.
//
// Dave's pick, 2026-09-20: a confirm sheet, not an immediate delete and
// not an in-row Yes/No. The button opens a sheet pinned to the bottom of
// the screen with the question, a Keep and the real action. The real
// action is a submit, so the sheet lives inside the form it confirms
// and nothing about the action itself changes.

import { useState, type ReactNode } from "react";
import { Button } from "./index";

export function ConfirmButton({
  children,
  title,
  body,
  confirmLabel,
  inline = false,
}: {
  children: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: ReactNode;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={inline ? "quiet" : "destructive"} inline={inline} onClick={() => setOpen(true)}>
        {children}
      </Button>
      {open && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/40" role="presentation" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : undefined}
            className="pb-safe w-full max-w-md rounded border border-line bg-paper p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <div className="text-heading font-extrabold tracking-tight text-ink">{title}</div>
                {body && <div className="text-body text-muted">{body}</div>}
              </div>
              <div className="flex flex-col gap-3">
                <Button variant="destructive">{confirmLabel}</Button>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  Keep
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
