import { z } from "zod";

// An org's private knowledge of a school. docs/MATCHING_CONTRACT.md
// section 4: coach contact, positions of need, notes.

export interface PositionOfNeed {
  position: string;
  gradYear?: number;
}

// "SS 2027; C; RHP 2028" -> [{ position: "SS", gradYear: 2027 }, ...]
export function parsePositionsOfNeed(raw: string | undefined): PositionOfNeed[] {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const m = token.match(/^(.*?)\s*(20\d\d)$/);
      if (m) return { position: m[1].trim().toUpperCase(), gradYear: Number(m[2]) };
      return { position: token.toUpperCase() };
    })
    .filter((p) => p.position.length > 0);
}

export function formatPositionsOfNeed(list: PositionOfNeed[]): string {
  return list.map((p) => (p.gradYear ? `${p.position} ${p.gradYear}` : p.position)).join("; ");
}

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v).trim());

export const orgSchoolNoteSchema = z.object({
  coachName: z.string().trim().optional(),
  coachEmail: z.string().trim().email("That does not look like an email").optional(),
  positionsOfNeed: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type OrgSchoolNoteValues = z.infer<typeof orgSchoolNoteSchema>;

export function parseOrgSchoolNoteForm(formData: FormData): { ok: boolean; values: OrgSchoolNoteValues | null; errors: Record<string, string> } {
  const input = {
    coachName: strOrUndef(formData.get("coachName")),
    coachEmail: strOrUndef(formData.get("coachEmail")),
    positionsOfNeed: strOrUndef(formData.get("positionsOfNeed")),
    notes: strOrUndef(formData.get("notes")),
  };
  const result = orgSchoolNoteSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
