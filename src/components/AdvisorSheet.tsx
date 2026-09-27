"use client";

// Pick one person or one athlete from a sheet (Stage 5, Phase 2).
//
// On the athlete page: Assign or Change opens the org's Admins, most
// recently used first (src/lib/org/advisors.ts), with a search box that
// narrows the list as you type, one tappable row per Admin that assigns
// them, Clear Advisor when somebody is assigned, and Add Admin, which
// goes to the invite screen with the role preset and comes back here
// with the new person assigned. On the member page the same sheet lists
// the athletes this Admin does not advise yet, as Assign Athlete.
//
// The list is filtered in memory; it is the org's Admins or roster, not
// a directory. Each row is a kit Option (a submit button carrying the
// id), so the form posts exactly one field and the action decides.

import { useState, type ReactNode } from "react";
import { Button, Field, Form, Label, LinkButton, Option, Sheet, Stack } from "@/components/kit";

export interface SheetChoice {
  id: string;
  title: string;
  meta?: string;
  // Extra words the search box may match on (an email, a Title).
  keywords?: string;
}

export function AdvisorSheet({
  action,
  choices,
  field,
  title,
  trigger,
  searchLabel,
  currentId = null,
  clearLabel,
  add,
  empty,
  defaultOpen = false,
}: {
  action: (formData: FormData) => void | Promise<void>;
  choices: SheetChoice[];
  // The form field each row submits: advisorId on the athlete page,
  // athleteId on the member page.
  field: string;
  title: string;
  trigger: ReactNode;
  searchLabel: string;
  // The choice already assigned, marked and not tappable.
  currentId?: string | null;
  // Shown when somebody is assigned; posts the field empty to clear.
  clearLabel?: string;
  add?: { href: string; label: string };
  empty: string;
  // Open on first render. The render laws and the preview use it; a
  // screen never does.
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? choices.filter((c) => `${c.title} ${c.meta ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(needle)) : choices;

  return (
    <>
      <Button type="button" variant="quiet" inline onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {choices.length > 3 && <Field name="q" type="search" label={searchLabel} labelHidden placeholder={searchLabel} autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} onPaper />}
        <Form action={action}>
          <Stack gap={3}>
            {shown.map((c) => (
              <Option key={c.id} name={field} value={c.id} selected={c.id === currentId} title={c.title} meta={c.id === currentId ? "Assigned Now" : c.meta} />
            ))}
            {shown.length === 0 && <Label>{choices.length === 0 ? empty : "Nobody matches that search."}</Label>}
            {currentId && clearLabel && (
              <Button variant="secondary" name={field} value="">
                {clearLabel}
              </Button>
            )}
          </Stack>
        </Form>
        {add && (
          <LinkButton href={add.href} variant="secondary">
            {add.label}
          </LinkButton>
        )}
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
          Close
        </Button>
      </Sheet>
    </>
  );
}
