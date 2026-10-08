// Piece 2 at the server: turn a stored file into the two suggestions the
// documents row carries (migration 0049). Reads the roster with the
// caller's own client, so a candidate is only ever someone the uploader
// may already see. Never throws: a suggestion that cannot be made is
// "no suggestion", and the upload goes on exactly as before.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocCategoryId } from "@/lib/docai/types";
import { suggestIdentity, suggestType, type IdentityCandidate, type RosterEntry } from "@/lib/docai/suggest";
import { textSample } from "@/lib/vault/textSample";
import type { VaultFormat } from "@/lib/vault/format";

// The form value that means "about nobody": a guide, a blank form.
export const NOT_AN_ATHLETE = "none";

export interface SuggestionColumns {
  suggested_type: string | null;
  suggested_type_confidence: number | null;
  suggested_type_reasons: string[];
  identity_status: "unmatched" | "proposed" | "ambiguous" | "confirmed" | null;
  identity_candidates: IdentityCandidate[];
  suggested_at: string;
  subject_athlete_id?: string | null;
  identity_confirmed_by?: string | null;
  identity_confirmed_at?: string | null;
}

export async function loadSuggestionRoster(supabase: SupabaseClient, orgId: string): Promise<RosterEntry[]> {
  try {
    const [{ data: athletes }, { data: guardians }] = await Promise.all([
      supabase.from("athletes").select("id, name, detail").eq("org_id", orgId).is("deleted_at", null),
      supabase.from("athlete_guardians").select("athlete_id, users(email)").eq("org_id", orgId),
    ]);
    const emails = new Map<string, string[]>();
    for (const g of (guardians ?? []) as { athlete_id: string; users: { email: string | null } | { email: string | null }[] | null }[]) {
      const u = Array.isArray(g.users) ? g.users[0] : g.users;
      if (u?.email) emails.set(g.athlete_id, [...(emails.get(g.athlete_id) ?? []), u.email]);
    }
    return ((athletes ?? []) as { id: string; name: string; detail: { highSchool?: string; currentSchool?: string; gradYear?: number } | null }[]).map((a) => ({
      id: a.id,
      name: a.name,
      school: a.detail?.currentSchool || a.detail?.highSchool || null,
      gradYear: a.detail?.gradYear ?? null,
      emails: emails.get(a.id) ?? [],
    }));
  } catch {
    return [];
  }
}

// The suggestion for one document. `pinned` is the athlete whose page the
// upload started from: a person chose them, so they are confirmed, unless
// the file itself names somebody else, in which case both are shown and
// nobody is confirmed.
export function suggestionFor(input: {
  fileName: string;
  format: VaultFormat;
  bytes: Uint8Array | null;
  pickedType: DocCategoryId | null;
  roster: RosterEntry[];
  pinned?: { id: string; name: string } | null;
  actorId: string;
  now?: Date;
}): SuggestionColumns {
  const at = (input.now ?? new Date()).toISOString();
  try {
    const sample = input.bytes ? textSample(input.format, input.bytes) : null;
    const type = suggestType({ fileName: input.fileName, format: input.format, pickedType: input.pickedType, textSample: sample });
    const identity = suggestIdentity({ fileName: input.fileName, textSample: sample, roster: input.roster });
    const columns: SuggestionColumns = {
      suggested_type: type.type,
      suggested_type_confidence: type.confidence,
      suggested_type_reasons: type.reasons,
      identity_status: identity.status,
      identity_candidates: identity.candidates,
      suggested_at: at,
    };
    if (input.pinned) {
      const entry = input.roster.find((r) => r.id === input.pinned!.id);
      const someoneElse = identity.candidates.find((c) => c.athleteId !== input.pinned!.id);
      const pinnedCandidate: IdentityCandidate = {
        athleteId: input.pinned.id,
        name: input.pinned.name,
        school: entry?.school ?? null,
        gradYear: entry?.gradYear ?? null,
        score: 0.95,
        reasons: ["Uploaded from their page"],
      };
      if (someoneElse) {
        columns.identity_status = "ambiguous";
        columns.identity_candidates = [pinnedCandidate, ...identity.candidates.filter((c) => c.athleteId !== input.pinned!.id)].slice(0, 3);
      } else {
        columns.identity_status = "confirmed";
        columns.identity_candidates = [pinnedCandidate];
        columns.subject_athlete_id = input.pinned.id;
        columns.identity_confirmed_by = input.actorId;
        columns.identity_confirmed_at = at;
      }
    }
    return columns;
  } catch {
    return { suggested_type: null, suggested_type_confidence: null, suggested_type_reasons: [], identity_status: null, identity_candidates: [], suggested_at: at };
  }
}
