import { isScoredStatus } from "@/lib/placement";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import {
  AddButton,
  Avatar,
  Body,
  BulkAction,
  BulkCheck,
  BulkSelect,
  ConfirmButton,
  EmptyState,
  Form,
  Hidden,
  LinkButton,
  Notice,
  Row,
  Screen,
  Section,
  SelectField,
  TextLink,
} from "@/components/kit";
import {
  bulkAssignAdvisor,
  bulkChangeStatus,
  bulkExportAthletes,
  undoBulkAdvisor,
} from "@/lib/actions/athletesBulk";
import { loadAdvisorChoices } from "@/lib/org/advisors";
import { countOf } from "@/lib/bulk/ids";
import { decodeAdvisorUndo } from "@/lib/data/undoPlan";
import { BULK_STATUSES } from "@/lib/bulk/rosterStatus";
import { SearchField } from "@/components/SearchField";
import {
  effectiveStatus,
  placementAthlete,
  placementLine,
  placementOf,
} from "@/lib/placement";
import { ATHLETE_STATUSES } from "@/lib/validation/athlete";

interface AthleteRow {
  id: string;
  name: string;
  sport: string;
  position: string | null;
  recruit_type: string;
  gpa: number | null;
  status: string;
  advisor_id: string | null;
  detail: unknown;
  draft_team: string | null;
  draft_round: number | null;
  draft_year: number | null;
}

interface CommittedRow {
  id: string;
  athlete_id: string;
  status: string;
  schools: { name: string } | { name: string }[] | null;
}

const RECRUIT_TYPE_LABEL: Record<string, string> = {
  hs: "High School",
  transfer_4to4: "Transfer (4-to-4)",
  transfer_juco: "Transfer (JUCO)",
  transfer_grad: "Transfer (Grad)",
};

// The roster. Staff and owners add and edit; members read.
export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{
    q?: string;
    status?: string;
    advisor?: string;
    notice?: string;
    error?: string;
    undo?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const q = sp.q?.trim().toLowerCase() ?? "";
  // Only a status the vocabulary knows narrows the list; anything else
  // shows everyone rather than an empty screen.
  const status = (ATHLETE_STATUSES as readonly string[]).includes(
    sp.status ?? "",
  )
    ? sp.status!
    : "";
  // advisor=me narrows to the athletes this person advises (Stage 3).
  // Any other value is ignored, like an unknown status.
  const mine = sp.advisor === "me";
  // advisor=none: still being recruited and nobody advising them, the
  // same count the Advisors screen shows (countByAdvisor).
  const unadvised = sp.advisor === "none";
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: athletes }, { data: committedRows }, advisors] =
    await Promise.all([
      supabase
        .from("athletes")
        .select(
          "id, name, sport, position, recruit_type, gpa, status, detail, draft_team, draft_round, draft_year, advisor_id",
        )
        .eq("org_id", org.id)
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("recruiting_targets")
        .select("id, athlete_id, status, schools(name)")
        .eq("org_id", org.id)
        .eq("status", "Committed"),
      canEdit ? loadAdvisorChoices(supabase, org.id) : Promise.resolve([]),
    ]);
  const committedByAthlete = new Map<
    string,
    { id: string; status: string; schoolName: string | null }[]
  >();
  for (const t of (committedRows ?? []) as CommittedRow[]) {
    const school = Array.isArray(t.schools) ? t.schools[0] : t.schools;
    committedByAthlete.set(t.athlete_id, [
      ...(committedByAthlete.get(t.athlete_id) ?? []),
      { id: t.id, status: t.status, schoolName: school?.name ?? null },
    ]);
  }

  // Placed: where they went, in place of the recruit type, which no
  // longer describes what is going on. Worked out once per athlete so
  // the status filter and the pill read the same value.
  const all = ((athletes ?? []) as AthleteRow[]).map((a) => {
    const placement = placementOf(
      placementAthlete(a),
      committedByAthlete.get(a.id) ?? [],
    );
    return {
      ...a,
      placement,
      effective: effectiveStatus(
        placementAthlete(a),
        committedByAthlete.get(a.id) ?? [],
      ),
    };
  });
  // Name, sport or position, on top of the status. Filtered here rather
  // than in the query so the list, the count and the empty state agree
  // with each other, and with the tile on Today that opened this.
  const searched = q
    ? all.filter((a) =>
        `${a.name} ${a.sport} ${a.position ?? ""}`.toLowerCase().includes(q),
      )
    : all;
  const byStatus = status
    ? searched.filter((a) => a.effective === status)
    : searched;
  const rows = mine
    ? byStatus.filter((a) => a.advisor_id === user.id)
    : unadvised
      ? byStatus.filter((a) => !a.advisor_id && isScoredStatus(a.effective))
      : byStatus;
  const advisesAnyone = all.some((a) => a.advisor_id === user.id);
  const lede = [
    status || mine || unadvised ? `${rows.length} of ${all.length}` : null,
    status || null,
    mine ? "yours" : null,
    unadvised ? "still being recruited, no advisor" : null,
  ]
    .filter(Boolean)
    .join(", ");

  // One Undo for the last bulk advisor change, read back from the query
  // string; a value that does not decode offers nothing.
  const undo = canEdit && sp.undo ? decodeAdvisorUndo(sp.undo) : null;

  const rowsList = rows.map((a) => (
    <Row
      key={a.id}
      href={`/org/${slug}/roster/${a.id}`}
      select={canEdit ? <BulkCheck id={a.id} label={a.name} /> : undefined}
      leading={<Avatar name={a.name} />}
      title={a.name}
      meta={`${a.sport}${a.position ? ` · ${a.position}` : ""} · ${a.placement ? placementLine(a.placement) : (RECRUIT_TYPE_LABEL[a.recruit_type] ?? a.recruit_type)}`}
      trailing={
        <>
          <Body weight="semibold" numeric>
            {a.gpa != null ? Number(a.gpa).toFixed(2) : "–"}
          </Body>
          <StatusPill status={a.effective} />
        </>
      }
    />
  ));

  const list = (
    <Section label="Roster" count={rows.length} role="people" kind="athlete">
      {rows.length === 0 ? (
        <EmptyState
          kind="athlete"
          title={
            q
              ? "Nobody Matches"
              : status || mine || unadvised
                ? "Nothing Matches"
                : "No Athletes Yet"
          }
        >
          {q
            ? "Try a shorter name, or clear the search."
            : mine
              ? "Nobody here is assigned to you. Open an athlete and use Assign under Advisor."
              : status
                ? "Nobody is at this status. Show every athlete to see the rest."
                : unadvised
                  ? "Every athlete still being recruited has an advisor."
                  : canEdit
                    ? "Add the first one below."
                    : "Ask an Admin to add one."}
        </EmptyState>
      ) : (
        rowsList
      )}
    </Section>
  );

  const bulkActions = canEdit ? (
    <>
      <BulkAction
        action={bulkAssignAdvisor.bind(null, slug)}
        label="Assign Advisor"
        noun="athlete"
        question="Assign an Advisor to {n}"
        confirmLabel="Assign"
        hint="Whoever advises them now is replaced. Each change is logged, and you can Undo it afterward."
        fields={
          <SelectField name="advisorId" label="Advisor" defaultValue="">
            <option value="">Unassigned</option>
            {advisors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
        }
      />
      <BulkAction
        action={bulkChangeStatus.bind(null, slug)}
        label="Change Status"
        noun="athlete"
        question="Change the Status of {n}"
        confirmLabel="Change Status"
        hint="Only Active and Inactive are offered. Committed, Enrolled, Graduated and Drafted ask for a school, a date or a team, so they are set from the athlete page. Anyone already placed, or already at that status, is skipped."
        fields={
          <SelectField name="status" label="Status" defaultValue="Active">
            {BULK_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </SelectField>
        }
      />
      <BulkAction
        action={bulkExportAthletes.bind(null, slug)}
        label="Export CSV"
        noun="athlete"
        question="Export {n}"
        confirmLabel="Export"
        hint="A spreadsheet with name, sport, position, status, grad year, advisor and GPA. No contact details."
      />
    </>
  ) : undefined;

  return (
    <Screen
      title="Athletes"
      lede={lede || undefined}
      action={
        canEdit ? (
          <AddButton href={`/org/${slug}/roster/new`} label="Add" />
        ) : undefined
      }
    >
      {sp.notice && (
        // Remove Athlete lands here (audit crud F1).
        <Notice tone="success" title="Done">
          {sp.notice}
        </Notice>
      )}
      {sp.error && <Notice tone="danger" title={sp.error} />}
      {undo && (
        <Form action={undoBulkAdvisor.bind(null, slug)}>
          <Hidden name="undo" value={sp.undo!} />
          <ConfirmButton
            tone="change"
            title="Undo the Advisor Change?"
            body={`${countOf(undo.entries.length, "athlete")} go back to their previous advisor. Anyone whose advisor has changed since is left as they are.`}
            confirmLabel="Undo"
          >
            Undo
          </ConfirmButton>
        </Form>
      )}
      {(status || mine || unadvised) && (
        <TextLink href={`/org/${slug}/roster`}>Show Every Athlete</TextLink>
      )}
      {mine ? (
        <TextLink href={`/org/${slug}/mine`}>My Athletes</TextLink>
      ) : (
        advisesAnyone && (
          <TextLink
            href={`/org/${slug}/roster?advisor=me${status ? `&status=${encodeURIComponent(status)}` : ""}`}
          >
            Just Mine
          </TextLink>
        )
      )}
      {(all.length > 5 || q) && (
        <SearchField initial={q} placeholder="A name, a sport or a position" />
      )}
      {canEdit && rows.length > 0 ? (
        <BulkSelect
          ids={rows.map((a) => a.id)}
          noun="athlete"
          actions={bulkActions}
        >
          {list}
        </BulkSelect>
      ) : (
        list
      )}
      {canEdit && all.length === 0 && (
        <LinkButton href={`/org/${slug}/roster/new`}>
          Add Your First Athlete
        </LinkButton>
      )}
    </Screen>
  );
}
