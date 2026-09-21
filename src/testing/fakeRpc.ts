// The three SECURITY DEFINER functions of migration 0031, mirrored over
// the fixture so a member screen renders in the harness the way it
// does against the database.
//
// This is a second implementation, and that is a risk the family
// screens never carried (they read rows, and rows fake the same way).
// It is bounded two ways: the SQL is asserted on its own seed by
// scripts/rls_test.sql, and this file is asserted on the fixture by
// the render laws, with the same rules written twice in plain words:
//
//   member_program: every live athlete of the org, its stage being
//     Committed if any target is Committed, else Offers if any target is
//     an Offer, else Targeting if any target is not Not Interested,
//     else No Targets.
//   member_program_schools: one athlete's targets as school, division
//     and status, committed first.
//   member_giving: the org's gifts, pledges, campaigns, budget lines,
//     boards and seats, with every name stripped except the caller's
//     own seat and the donors of gifts credited to it.
//
// Both refuse anyone who is not owner, staff or member of the org.

import type { Dataset } from "./fakeSupabase";

type Row = Record<string, unknown>;

function admitted(data: Dataset, orgId: string, userId: string | null): boolean {
  if (!userId) return false;
  return (data.org_members ?? []).some((m) => m.org_id === orgId && m.user_id === userId && ["owner", "staff", "member"].includes(String(m.role)));
}

const STAGE_ORDER: Record<string, number> = { Committed: 0, Offer: 1, Visit: 2, "In Contact": 3, Target: 4 };

export function fakeRpc(data: Dataset, userId: string | null, name: string, args: Record<string, unknown>): { data: unknown; error: { message: string } | null } {
  if (name === "member_program") {
    const orgId = String(args.p_org);
    if (!admitted(data, orgId, userId)) return { data: [], error: null };
    const targets = (data.recruiting_targets ?? []).filter((t) => t.org_id === orgId);
    const schools = new Map((data.schools ?? []).map((s) => [s.id, s]));
    const rows = (data.athletes ?? [])
      .filter((a) => a.org_id === orgId && !a.deleted_at)
      .map((a) => {
        const mine = targets.filter((t) => t.athlete_id === a.id);
        const committed = mine.find((t) => t.status === "Committed");
        const offers = mine.filter((t) => t.status === "Offer").length;
        const stage = committed ? "Committed" : offers ? "Offers" : mine.some((t) => t.status !== "Not Interested") ? "Targeting" : "No Targets";
        const detail = (a.detail ?? {}) as Row;
        return {
          athlete_id: a.id,
          name: a.name,
          sport: a.sport,
          position: a.position ?? null,
          grad_year: typeof detail.gradYear === "number" ? detail.gradYear : null,
          recruit_type: a.recruit_type,
          stage,
          offers,
          committed_school: committed ? ((schools.get(committed.school_id) as Row | undefined)?.name ?? null) : null,
        };
      })
      .sort((x, y) => String(x.name).localeCompare(String(y.name)));
    return { data: rows, error: null };
  }

  if (name === "member_program_schools") {
    const orgId = String(args.p_org);
    const athleteId = String(args.p_athlete);
    if (!admitted(data, orgId, userId)) return { data: [], error: null };
    const athlete = (data.athletes ?? []).find((a) => a.id === athleteId && a.org_id === orgId && !a.deleted_at);
    if (!athlete) return { data: [], error: null };
    const schools = new Map((data.schools ?? []).map((s) => [s.id, s]));
    const rows = (data.recruiting_targets ?? [])
      .filter((t) => t.org_id === orgId && t.athlete_id === athleteId)
      .map((t) => {
        const s = (schools.get(t.school_id) ?? {}) as Row;
        return { target_id: t.id, school_name: s.name ?? "", division: s.division ?? "", status: t.status };
      })
      .sort((x, y) => (STAGE_ORDER[String(x.status)] ?? 5) - (STAGE_ORDER[String(y.status)] ?? 5) || String(x.school_name).localeCompare(String(y.school_name)));
    return { data: rows, error: null };
  }

  if (name === "member_giving") {
    const orgId = String(args.p_org);
    if (!admitted(data, orgId, userId)) return { data: null, error: null };
    const seats = (data.board_members ?? []).filter((m) => m.org_id === orgId);
    const mySeat = seats.filter((m) => m.user_id === userId).sort((a, b) => (a.status === "active" ? -1 : 0) - (b.status === "active" ? -1 : 0))[0] ?? null;
    const myDonor = (mySeat?.donor_id as string | null | undefined) ?? null;
    const donors = new Map((data.donors ?? []).map((d) => [d.id, d]));
    const credited = (g: Row) => !!mySeat && (g.solicited_by === mySeat.id || (myDonor !== null && g.donor_id === myDonor));
    const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
    return {
      data: {
        my_seat_id: mySeat?.id ?? null,
        gifts: (data.gifts ?? [])
          .filter((g) => g.org_id === orgId)
          .map((g) => ({ ...pick(g, ["id", "amount", "received_on", "category", "method", "donor_id", "campaign_id", "pledge_id", "solicited_by"]), donor_name: credited(g) ? ((donors.get(g.donor_id) as Row | undefined)?.name ?? null) : null })),
        pledges: (data.pledges ?? []).filter((p) => p.org_id === orgId).map((p) => pick(p, ["id", "amount", "promised_on", "due_on", "status", "donor_id", "campaign_id", "solicited_by"])),
        campaigns: (data.campaigns ?? []).filter((c) => c.org_id === orgId).map((c) => pick(c, ["id", "name", "kind", "goal_amount", "ends_on"])),
        budget: (data.fundraising_budget ?? []).filter((b) => b.org_id === orgId).map((b) => pick(b, ["fiscal_year", "category", "amount"])),
        boards: (data.boards ?? []).filter((b) => b.org_id === orgId).map((b) => pick(b, ["id", "name", "kind", "sport", "give_get_amount", "min_seats", "max_seats"])),
        seats: seats.map((m) => ({
          ...pick(m, ["id", "board_id", "donor_id", "status", "term_start", "term_end", "commitment_amount"]),
          name: mySeat && m.id === mySeat.id ? m.name : null,
          role_title: mySeat && m.id === mySeat.id ? (m.role_title ?? null) : null,
        })),
      },
      error: null,
    };
  }

  return { data: null, error: { message: `fakeSupabase does not implement rpc: ${name}` } };
}
