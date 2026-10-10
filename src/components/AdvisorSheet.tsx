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
// a directory. A tap on a row never writes (Dave's standing rule,
// 2026-10-06: no one-click authority change). It opens the confirm
// step, which says in one sentence what will change and posts exactly
// one field; Back returns to the list. Clear asks the same way.

import { useState, type ReactNode } from "react";
import { Button, Field, Form, Hidden, Label, LinkButton, Option, Prose, Sheet, Stack } from "@/components/kit";

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
  confirm,
  clearConfirm,
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
  // The confirm step's question, with {choice} standing for the picked
  // row's title: "Make {choice} the advisor for Ana Ruiz?". A string,
  // not a function, so a server page can hand it over.
  confirm: string;
  // The question before Clear.
  clearConfirm?: string;
  // Open on first render. The render laws and the preview use it; a
  // screen never does.
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [q, setQ] = useState("");
  // The row picked and waiting for its confirm: a choice, or "" for
  // Clear, or null while the list shows.
  const [pending, setPending] = useState<string | null>(null);
  const picked = pending ? choices.find((c) => c.id === pending) : null;
  const close = () => {
    setOpen(false);
    setPending(null);
  };
  const needle = q.trim().toLowerCase();
  const shown = needle ? choices.filter((c) => `${c.title} ${c.meta ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(needle)) : choices;

  return (
    <>
      <Button type="button" variant="quiet" inline onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <Sheet open={open} onClose={close} title={title}>
        {pending !== null ? (
          <Form action={action}>
            <Stack gap={3}>
              <Prose>{pending === "" ? clearConfirm ?? "Clear this?" : confirm.replace("{choice}", picked?.title ?? "them")}</Prose>
              <Hidden name={field} value={pending} />
              <Button>{pending === "" ? "Clear" : "Confirm"}</Button>
              <Button type="button" variant="secondary" onClick={() => setPending(null)}>
                Back
              </Button>
            </Stack>
          </Form>
        ) : (
          <>
            {choices.length > 3 && <Field name="q" type="search" label={searchLabel} labelHidden placeholder={searchLabel} autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} onPaper />}
            <Stack gap={3}>
              {shown.map((c) => (
                <Option key={c.id} selected={c.id === currentId} title={c.title} meta={c.id === currentId ? `Assigned Now${c.meta ? ` · ${c.meta}` : ""}` : c.meta} onPick={() => setPending(c.id)} />
              ))}
              {shown.length === 0 && <Label>{choices.length === 0 ? empty : "Nobody matches that search."}</Label>}
              {currentId && clearLabel && (
                <Button type="button" variant="secondary" onClick={() => setPending("")}>
                  {clearLabel}
                </Button>
              )}
            </Stack>
            {add && (
              <LinkButton href={add.href} variant="secondary">
                {add.label}
              </LinkButton>
            )}
          </>
        )}
        <Button type="button" variant="quiet" onClick={close}>
          Close
        </Button>
      </Sheet>
    </>
  );
}
