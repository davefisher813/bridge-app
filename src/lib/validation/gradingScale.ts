import { z } from "zod";
import {
  SCALE_LETTERS,
  gradingScaleProblem,
  type GradingBand,
  type ScaleLetter,
} from "@/lib/fit/ncaa/gradingScale";

// The form is five fixed rows, one per letter, because the NCAA does not
// recognise plus or minus: a school publishing twelve bands collapses to
// these five without losing anything that changes a core GPA. Letting
// someone add arbitrary rows would invite a scale with A+ and A as
// separate bands, which cannot mean anything different downstream.

export interface GradingScaleFormValues {
  schoolName: string;
  bands: GradingBand[];
  reportsWeightedGrades: boolean;
  weightingIsClassRankOnly: boolean;
  weightBonus: number;
  sourceNote: string;
}

export interface GradingScaleFormResult {
  ok: boolean;
  values: GradingScaleFormValues | null;
  errors: Record<string, string>;
}

const headerSchema = z.object({
  schoolName: z.string().trim().min(1, "School name is required"),
  // Required, not optional. A conversion table with no stated source is
  // a number nobody can check later, and this one silently governs every
  // eligibility verdict for every athlete at that school in this org.
  sourceNote: z.string().trim().min(3, "Say where these numbers came from"),
  // The NCAA caps the weighted bonus at 1.00 quality point. Storing the
  // cap when a school adds 0.5 overstates every AP athlete's core GPA,
  // so the school's real number is what gets typed here.
  weightBonus: z.number().min(0, "Cannot be negative").max(1, "The NCAA caps this at 1.00"),
});

function toNumber(raw: FormDataEntryValue | null): number | null {
  const t = String(raw ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseGradingScaleForm(formData: FormData): GradingScaleFormResult {
  const errors: Record<string, string> = {};

  const header = headerSchema.safeParse({
    schoolName: String(formData.get("schoolName") ?? ""),
    sourceNote: String(formData.get("sourceNote") ?? ""),
    weightBonus: toNumber(formData.get("weightBonus")) ?? 1,
  });
  if (!header.success) {
    for (const issue of header.error.issues) errors[String(issue.path[0])] = issue.message;
  }

  const bands: GradingBand[] = [];
  for (const letter of SCALE_LETTERS) {
    const min = toNumber(formData.get(`min_${letter}`));
    const max = toNumber(formData.get(`max_${letter}`));
    if (min === null && max === null) {
      // A letter left entirely blank is a letter this school does not
      // award. Some schools do not give a D. Dropping the band is the
      // honest result: a grade in that range then converts to nothing
      // and is reported, rather than being folded into a neighbour.
      continue;
    }
    if (min === null || max === null) {
      errors[`band_${letter}`] = `The ${letter} band needs both a low and a high number`;
      continue;
    }
    bands.push({ letter, min, max });
  }

  if (bands.length === 0 && !errors.band_A) {
    errors.bands = "Enter at least the A, B and C bands";
  } else {
    const problem = gradingScaleProblem(bands);
    if (problem) errors.bands = `That table cannot be right: ${problem}`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, values: null, errors };

  return {
    ok: true,
    errors: {},
    values: {
      schoolName: header.data!.schoolName,
      bands,
      reportsWeightedGrades: formData.get("reportsWeightedGrades") === "on",
      weightingIsClassRankOnly: formData.get("weightingIsClassRankOnly") === "on",
      weightBonus: header.data!.weightBonus,
      sourceNote: header.data!.sourceNote,
    },
  };
}

// The five rows a form renders, filled from whatever is already stored.
// A letter with no band comes back blank rather than being invented.
export function bandsToRows(bands: GradingBand[]): Array<{ letter: ScaleLetter; min: string; max: string }> {
  return SCALE_LETTERS.map((letter) => {
    const found = bands.find((b) => b.letter.trim().toUpperCase().charAt(0) === letter);
    return {
      letter,
      min: found ? String(found.min) : "",
      max: found ? String(found.max) : "",
    };
  });
}
