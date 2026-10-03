import { orgToday } from "@/lib/datetime/today";
import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { isDirectoryEditor, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { deleteTransferWindow } from "@/lib/actions/transferWindows";
import { sportSpec } from "@/lib/fit/contract";
import { AddButton, ConfirmButton, EmptyState, Form, Inline, Label, Notice, Row, Screen, Section, TextLink } from "@/components/kit";

export const dynamic = "force-dynamic";

// Every transfer portal window on file, by sport. The fit engine's
// transfer timing reads these (src/lib/fit/transfer.ts) and reports
// timing as unverified when none matches, so this list is where a
// directory editor keeps them current. Dates are data, never constants: the NCAA
// moves them by vote most years.

interface WindowRow {
  id: string;
  sport: string;
  division: string;
  season_year: string;
  window_label: string;
  opens_on: string;
  closes_on: string;
  source_url: string | null;
  notes: string | null;
}

export default async function TransferWindowsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { slug } = await params;
  const { notice, error } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  // Windows are shared reference data: Add, Edit and Remove show only
  // to a directory editor (migration 0040). Everyone else reads them.
  const canEditDirectory = await isDirectoryEditor(user);

  const supabase = await createClient();
  const { data } = await supabase.from("transfer_windows").select("id, sport, division, season_year, window_label, opens_on, closes_on, source_url, notes").order("opens_on", { ascending: false });
  const rows = (data ?? []) as WindowRow[];
  const today = orgToday();

  const bySport = new Map<string, WindowRow[]>();
  for (const w of rows) bySport.set(w.sport, [...(bySport.get(w.sport) ?? []), w]);

  return (
    <Screen title="Transfer Windows" action={canEditDirectory ? <AddButton href={`/org/${slug}/transfer-windows/new`} label="Add" /> : undefined}>
      {notice && (
        <Notice tone="success" title="Done">
          {notice}
        </Notice>
      )}
      {error && (
        <Notice tone="danger" title="Could Not Change the Windows">
          {error}
        </Notice>
      )}
      {rows.length === 0 ? (
        <EmptyState kind="clock" title="No Windows on File">
          {canEditDirectory
            ? "Add this season's portal windows from the NCAA's page. Until then every transfer's timing reads as unverified."
            : "The organization that keeps the shared directory adds them from the NCAA's page. Until then every transfer's timing reads as unverified."}
        </EmptyState>
      ) : (
        [...bySport.entries()].map(([sport, windows]) => (
          <Section key={sport} label={sportSpec(sport)?.label ?? sport} count={windows.length} role="time" kind="clock">
            {windows.map((w) => {
              const open = w.opens_on <= today && today <= w.closes_on;
              const past = w.closes_on < today;
              return (
                <div key={w.id}>
                  <Row
                    kind="clock"
                    role={open ? "committed" : past ? "target" : "time"}
                    href={w.source_url ?? undefined}
                    title={`${w.division} · ${w.window_label}`}
                    meta={`${w.season_year} · ${longDate(w.opens_on)} to ${longDate(w.closes_on)}${open ? " · open now" : past ? " · closed" : ""}${w.source_url ? " · source" : ""}`}
                    wrap
                  />
                  {w.notes && <Label>{w.notes}</Label>}
                  {canEditDirectory && (
                    <Inline>
                      <TextLink href={`/org/${slug}/transfer-windows/${w.id}/edit`}>Edit</TextLink>
                      <Form action={deleteTransferWindow.bind(null, slug, w.id)}>
                        <ConfirmButton inline title="Remove This Window?" body="Every transfer's timing stops reading it. Nothing else changes." confirmLabel="Remove">
                          Remove
                        </ConfirmButton>
                      </Form>
                    </Inline>
                  )}
                </div>
              );
            })}
          </Section>
        ))
      )}
    </Screen>
  );
}
