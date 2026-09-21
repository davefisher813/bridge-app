// What each document type does to the record when it is applied, and
// how each one is put back.
//
// A transcript is handled in src/lib/actions/documents.ts, where it was
// built first. The other four arrive here: test scores go onto the
// athlete's detail, an offer letter onto the recruiting target for that
// school, an award letter's numbers onto the same target as the aid the
// financial score reads, a recommendation letter becomes a contact.
// Every apply records what it changed and what was there before, so a
// discard can restore a value only while it still holds what the
// document put there.
//
// No "use server" here: these are plain functions over a client the
// action hands in, so they can be exercised from a test.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAthleteDetail } from "@/lib/fit/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface FieldChange {
  before: unknown;
  after: unknown;
}

export interface TargetChange {
  id: string;
  // True when the document created the target; an undo removes it.
  created: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface ApplyPart {
  warnings: string[];
  // athletes.detail keys this apply wrote (satTotal, actComposite).
  detail?: Record<string, FieldChange>;
  // The recruiting target an offer letter or an award letter touched.
  target?: TargetChange;
  // The contact a recommendation letter added.
  contactId?: string | null;
  // True when the stored matches for the athlete should be rescored.
  recompute?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// The school a letter names, on the shared schools table. Exact after
// normalising, then one name containing the other, then nothing: a
// guess at "State" would put an offer on the wrong school.
export async function matchSchool(client: Client, name: string): Promise<{ id: string; name: string } | null> {
  const wanted = norm(name);
  if (!wanted) return null;
  const { data } = await client.from("schools").select("id, name");
  const rows = (data ?? []) as { id: string; name: string }[];
  const exact = rows.find((s) => norm(s.name) === wanted);
  if (exact) return exact;
  const loose = rows.filter((s) => {
    const have = norm(s.name);
    return have.includes(wanted) || wanted.includes(have);
  });
  return loose.length === 1 ? loose[0]! : null;
}

// ── Test scores ──────────────────────────────────────────────────────
export async function applyTestScores(client: Client, orgId: string, athleteId: string, extracted: Record<string, unknown>): Promise<ApplyPart> {
  const warnings: string[] = [];
  const tests = Array.isArray(extracted.tests) ? (extracted.tests as { type?: string; totalScore?: number | null }[]) : [];
  const best = (type: string, min: number, max: number): number | undefined => {
    const scores = tests.filter((t) => t.type === type && typeof t.totalScore === "number" && t.totalScore! >= min && t.totalScore! <= max).map((t) => t.totalScore as number);
    return scores.length ? Math.max(...scores) : undefined;
  };
  const satTotal = best("SAT", 400, 1600);
  const actComposite = best("ACT", 1, 36);
  if (satTotal === undefined && actComposite === undefined) {
    warnings.push("No SAT or ACT total was read off this, so the athlete's record was left alone. The scores it did read stay on the document.");
    return { warnings };
  }

  const { data: row } = await client.from("athletes").select("detail").eq("id", athleteId).eq("org_id", orgId).single();
  const detail = ((row as { detail?: unknown } | null)?.detail ?? {}) as Record<string, unknown>;
  if (detail.kind !== "hs") {
    warnings.push("SAT and ACT scores are kept on a high school athlete's record. This athlete is a transfer, so the scores stay on the document only.");
    return { warnings };
  }

  const next: Record<string, unknown> = { ...detail };
  const changes: Record<string, FieldChange> = {};
  if (satTotal !== undefined && detail.satTotal !== satTotal) {
    changes.satTotal = { before: detail.satTotal ?? null, after: satTotal };
    next.satTotal = satTotal;
  }
  if (actComposite !== undefined && detail.actComposite !== actComposite) {
    changes.actComposite = { before: detail.actComposite ?? null, after: actComposite };
    next.actComposite = actComposite;
  }
  if (Object.keys(changes).length === 0) {
    warnings.push("The scores read are already on the athlete's record.");
    return { warnings };
  }
  try {
    parseAthleteDetail(next);
  } catch (e) {
    warnings.push(`The scores could not be placed on the record: ${(e as Error).message}`);
    return { warnings };
  }
  const { error } = await client.from("athletes").update({ detail: next }).eq("id", athleteId).eq("org_id", orgId);
  if (error) {
    warnings.push(`Could not write the scores to the athlete's record: ${error.message}`);
    return { warnings };
  }
  return { warnings, detail: changes, recompute: true };
}

export async function undoTestScores(client: Client, orgId: string, athleteId: string, changes: Record<string, FieldChange>): Promise<string[]> {
  const done: string[] = [];
  const { data: row } = await client.from("athletes").select("detail").eq("id", athleteId).eq("org_id", orgId).single();
  const detail = ((row as { detail?: unknown } | null)?.detail ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...detail };
  const restored: string[] = [];
  const kept: string[] = [];
  for (const [key, change] of Object.entries(changes)) {
    if (detail[key] === change.after) {
      if (change.before === null || change.before === undefined) delete next[key];
      else next[key] = change.before;
      restored.push(key === "satTotal" ? "SAT" : "ACT");
    } else {
      kept.push(key === "satTotal" ? "SAT" : "ACT");
    }
  }
  if (restored.length) {
    const { error } = await client.from("athletes").update({ detail: next }).eq("id", athleteId).eq("org_id", orgId);
    if (error) done.push(`Could not put back the previous ${restored.join(" and ")}: ${error.message}`);
    else done.push(`Put back the athlete's previous ${restored.join(" and ")}.`);
  }
  if (kept.length) done.push(`Left the ${kept.join(" and ")} alone, because it has been changed since this was applied.`);
  return done;
}

// ── Offer letter ─────────────────────────────────────────────────────
const OFFER_TYPE: Record<string, string | null> = {
  verbal: "verbal",
  written: "written",
  scholarship: "scholarship",
  walk_on: "walk_on",
  preferred_walk_on: "preferred_walk_on",
  admission_only: "admission_only",
  other: null,
};

// Stages an offer moves past. Committed and Not Interested are decisions
// and a letter does not undo one.
const BEFORE_OFFER = new Set(["Target", "In Contact", "Visit"]);

interface TargetRow {
  id: string;
  status: string;
  offer_type: string | null;
  offer_scholarship_percent: number | null;
  coach_name: string | null;
  aid: unknown;
}

async function findTarget(client: Client, orgId: string, athleteId: string, schoolId: string): Promise<TargetRow | null> {
  const { data } = await client
    .from("recruiting_targets")
    .select("id, status, offer_type, offer_scholarship_percent, coach_name, aid")
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .eq("school_id", schoolId)
    .maybeSingle();
  return (data as TargetRow | null) ?? null;
}

export async function applyOfferLetter(client: Client, orgId: string, athleteId: string, extracted: Record<string, unknown>): Promise<ApplyPart> {
  const warnings: string[] = [];
  const college = typeof extracted.college === "string" ? extracted.college : "";
  const school = college ? await matchSchool(client, college) : null;
  if (!school) {
    warnings.push(`No school on file named "${college || "(none read)"}". Add it under Schools, then apply this again.`);
    return { warnings };
  }
  const offerType = OFFER_TYPE[String(extracted.offerType ?? "")] ?? null;
  if (!offerType) warnings.push("The letter's offer type could not be mapped, so the target keeps its offer type.");
  const percent = offerType === "scholarship" && typeof extracted.scholarshipPercent === "number" ? Math.round(extracted.scholarshipPercent) : null;
  const coach = typeof extracted.coachName === "string" && extracted.coachName.trim() ? extracted.coachName.trim() : null;

  const existing = await findTarget(client, orgId, athleteId, school.id);
  if (!existing) {
    const row: Record<string, unknown> = { org_id: orgId, athlete_id: athleteId, school_id: school.id, status: "Offer", offer_type: offerType, offer_scholarship_percent: percent, coach_name: coach };
    const { data, error } = await client.from("recruiting_targets").insert(row).select("id").single();
    if (error || !data) {
      warnings.push(`Could not add ${school.name} to the board: ${error?.message ?? "no row came back"}.`);
      return { warnings };
    }
    return { warnings, target: { id: (data as { id: string }).id, created: true, before: {}, after: row }, recompute: true };
  }

  const after: Record<string, unknown> = {};
  if (offerType) after.offer_type = offerType;
  if (offerType) after.offer_scholarship_percent = percent;
  if (coach && !existing.coach_name) after.coach_name = coach;
  if (BEFORE_OFFER.has(existing.status)) after.status = "Offer";
  if (Object.keys(after).length === 0) {
    warnings.push(`${school.name} already carries this offer.`);
    return { warnings };
  }
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(after)) before[k] = (existing as unknown as Record<string, unknown>)[k] ?? null;
  const { error } = await client.from("recruiting_targets").update(after).eq("id", existing.id).eq("org_id", orgId);
  if (error) {
    warnings.push(`Could not update ${school.name} on the board: ${error.message}`);
    return { warnings };
  }
  return { warnings, target: { id: existing.id, created: false, before, after }, recompute: true };
}

// ── Financial aid ────────────────────────────────────────────────────
const AID_DOC_LABEL: Record<string, string> = {
  fafsa_sar: "FAFSA report",
  css_profile: "CSS Profile",
  efc_report: "EFC report",
  other: "financial document",
};

export async function applyFinancialAid(client: Client, orgId: string, athleteId: string, extracted: Record<string, unknown>, documentId: string | null): Promise<ApplyPart> {
  const warnings: string[] = [];
  const kind = String(extracted.documentType ?? "other");
  if (kind !== "award_letter") {
    warnings.push(`A ${AID_DOC_LABEL[kind] ?? "financial document"} is kept on file. Only an award letter from a school changes that school's numbers.`);
    return { warnings };
  }
  const college = typeof extracted.college === "string" ? extracted.college : "";
  const school = college ? await matchSchool(client, college) : null;
  if (!school) {
    warnings.push(`No school on file named "${college || "(none read)"}". Add it under Schools, then apply this again.`);
    return { warnings };
  }
  const awards = Array.isArray(extracted.awards) ? (extracted.awards as { type?: string; name?: string; amount?: number; renewable?: boolean | null }[]) : [];
  const total = typeof extracted.totalCostOfAttendance === "number" ? extracted.totalCostOfAttendance : null;
  let netCost = typeof extracted.netCost === "number" ? extracted.netCost : null;
  if (netCost === null && total !== null) {
    // Gift aid only: a loan is money the family still pays.
    const gift = awards.filter((a) => a.type === "grant" || a.type === "scholarship").reduce((s, a) => s + (typeof a.amount === "number" ? a.amount : 0), 0);
    netCost = Math.max(0, total - gift);
  }
  if (netCost === null) warnings.push("No net cost or cost of attendance was read, so the award is on file but does not change the match score.");
  const aid = {
    academicYear: typeof extracted.academicYear === "string" ? extracted.academicYear : null,
    totalCostOfAttendance: total,
    netCost,
    efc: typeof extracted.efc === "number" ? extracted.efc : null,
    sai: typeof extracted.sai === "number" ? extracted.sai : null,
    awards: awards.map((a) => ({ type: a.type ?? "other", name: a.name ?? "", amount: typeof a.amount === "number" ? a.amount : 0, renewable: a.renewable ?? null })),
    documentId,
  };

  const existing = await findTarget(client, orgId, athleteId, school.id);
  if (!existing) {
    const row: Record<string, unknown> = { org_id: orgId, athlete_id: athleteId, school_id: school.id, status: "Target", aid };
    const { data, error } = await client.from("recruiting_targets").insert(row).select("id").single();
    if (error || !data) {
      warnings.push(`Could not add ${school.name} to the board: ${error?.message ?? "no row came back"}.`);
      return { warnings };
    }
    return { warnings, target: { id: (data as { id: string }).id, created: true, before: {}, after: row }, recompute: true };
  }
  const { error } = await client.from("recruiting_targets").update({ aid }).eq("id", existing.id).eq("org_id", orgId);
  if (error) {
    warnings.push(`Could not record the award on ${school.name}: ${error.message}`);
    return { warnings };
  }
  return { warnings, target: { id: existing.id, created: false, before: { aid: existing.aid ?? null }, after: { aid } }, recompute: true };
}

export async function undoTarget(client: Client, orgId: string, change: TargetChange): Promise<string[]> {
  const done: string[] = [];
  const { data } = await client
    .from("recruiting_targets")
    .select("id, status, offer_type, offer_scholarship_percent, coach_name, aid")
    .eq("id", change.id)
    .eq("org_id", orgId)
    .maybeSingle();
  const current = data as TargetRow | null;
  if (!current) {
    done.push("The college this document touched is no longer on the board.");
    return done;
  }
  if (change.created) {
    const { error } = await client.from("recruiting_targets").delete().eq("id", change.id).eq("org_id", orgId);
    done.push(error ? `Could not remove the college this document added to the board: ${error.message}` : "Removed the college this document had added to the board.");
    return done;
  }
  const restore: Record<string, unknown> = {};
  const kept: string[] = [];
  for (const [k, after] of Object.entries(change.after)) {
    const now = (current as unknown as Record<string, unknown>)[k] ?? null;
    if (JSON.stringify(now) === JSON.stringify(after)) restore[k] = change.before[k] ?? null;
    else kept.push(k.replace(/_/g, " "));
  }
  if (Object.keys(restore).length) {
    const { error } = await client.from("recruiting_targets").update(restore).eq("id", change.id).eq("org_id", orgId);
    done.push(error ? `Could not put the college back the way it was: ${error.message}` : `Put back the college's previous ${Object.keys(restore).map((k) => k.replace(/_/g, " ")).join(", ")}.`);
  }
  if (kept.length) done.push(`Left the college's ${kept.join(", ")} alone, because it has been changed since this was applied.`);
  return done;
}

// ── Recommendation ───────────────────────────────────────────────────
const RECOMMENDER_ROLE: Record<string, string> = {
  Coach: "hs_coach",
  Teacher: "other",
  Counselor: "advisor",
  Mentor: "advisor",
  Other: "other",
};

export async function applyRecommendation(client: Client, orgId: string, athleteId: string, extracted: Record<string, unknown>): Promise<ApplyPart> {
  const warnings: string[] = [];
  const name = typeof extracted.recommenderName === "string" ? extracted.recommenderName.trim() : "";
  if (!name) {
    warnings.push("No recommender's name was read, so no contact was added. The letter stays on file.");
    return { warnings };
  }
  const { data: rows } = await client.from("contacts").select("id, name").eq("athlete_id", athleteId).eq("org_id", orgId);
  const exists = ((rows ?? []) as { id: string; name: string }[]).some((c) => norm(c.name) === norm(name));
  if (exists) {
    warnings.push(`${name} is already one of the athlete's contacts. The letter stays on file.`);
    return { warnings, contactId: null };
  }
  const parts = [
    `Recommendation letter`,
    [extracted.recType, extracted.tone].filter((x) => typeof x === "string" && x).join(", "),
    typeof extracted.letterDate === "string" ? extracted.letterDate : "",
  ].filter(Boolean);
  const org = typeof extracted.recommenderOrg === "string" && extracted.recommenderOrg.trim() ? ` at ${extracted.recommenderOrg.trim()}` : "";
  const notes = `${parts.join(" · ")}${org}. ${typeof extracted.summary === "string" ? extracted.summary : ""}`.trim();
  const { data, error } = await client
    .from("contacts")
    .insert({ org_id: orgId, athlete_id: athleteId, name, role: RECOMMENDER_ROLE[String(extracted.recommenderTitle ?? "Other")] ?? "other", school_id: null, email: null, phone: null, notes })
    .select("id")
    .single();
  if (error || !data) {
    warnings.push(`Could not add ${name} as a contact: ${error?.message ?? "no row came back"}.`);
    return { warnings };
  }
  return { warnings, contactId: (data as { id: string }).id };
}

export async function undoContact(client: Client, orgId: string, contactId: string): Promise<string[]> {
  const { data } = await client.from("contacts").select("id, name").eq("id", contactId).eq("org_id", orgId).maybeSingle();
  const row = data as { id: string; name: string } | null;
  if (!row) return ["The contact this document added had already been removed."];
  const { error } = await client.from("contacts").delete().eq("id", contactId).eq("org_id", orgId);
  return [error ? `Could not remove the contact ${row.name}: ${error.message}` : `Removed ${row.name} from the athlete's contacts.`];
}
