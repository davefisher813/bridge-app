// The eligibility verdict banner and its supporting pieces.
//
// Colour follows the locked catalog (docs/STYLING_CATALOG.md): the
// verdict sits on the Score axis as a TINT, green then yellow then gray,
// and never red. Red is the primary action colour there, and "red is not
// a status" is explicit in the contract. Severity is carried by the
// words, which is also the honest way round: "cannot compete in year
// one" says more than a colour does.

import type { ReactNode } from "react";
import { TINT } from "@/components/statusHue";
import type { EligibilityStatus } from "@/lib/fit/ncaa/initialEligibility";

// Score-axis roles only. A status never borrows a Stage colour, because
// green would then mean both Committed and "academically fine".
const STATUS_ROLE: Record<EligibilityStatus, "high" | "mid" | "low"> = {
  early_academic_qualifier: "high",
  qualifier: "high",
  academic_redshirt: "mid",
  partial_qualifier: "mid",
  nonqualifier: "low",
  not_applicable: "low",
  insufficient_data: "low",
};

const STATUS_LABEL: Record<EligibilityStatus, string> = {
  early_academic_qualifier: "Early academic qualifier",
  qualifier: "Qualifier",
  academic_redshirt: "Academic redshirt",
  partial_qualifier: "Partial qualifier",
  nonqualifier: "Nonqualifier",
  not_applicable: "Does not apply",
  insufficient_data: "Cannot be calculated yet",
};

export function VerdictCard({ status, headline, children }: { status: EligibilityStatus; headline: string; children?: ReactNode }) {
  return (
    <div className="mb-4 rounded-[16px] bg-paper p-4">
      <div className="mb-2">
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${TINT[STATUS_ROLE[status]]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="text-[14px] font-bold leading-tight text-ink">{headline}</div>
      {children}
    </div>
  );
}

// Two numbers, side by side, always. Showing a transcript GPA on its own
// next to an NCAA heading is how a family gets told their kid is fine
// when he is not, so the core figure never appears without its
// counterpart and the sentence explaining why they differ.
export function GpaPair({ coreGpa, transcriptGpa, needed }: { coreGpa: number | null; transcriptGpa: number | null; needed: number | null }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      <div className="rounded-[12px] bg-paper p-3.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.03em] text-muted">NCAA core</div>
        <div className="mt-1 text-[26px] font-black tabular-nums leading-tight text-ink">{coreGpa === null ? "?" : coreGpa.toFixed(2)}</div>
        <div className="mt-0.5 text-[10.5px] text-muted">{needed === null ? "no NCAA standard" : `needs ${needed} to compete`}</div>
      </div>
      <div className="rounded-[12px] bg-paper p-3.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.03em] text-muted">Transcript</div>
        <div className="mt-1 text-[26px] font-black tabular-nums leading-tight text-ink">
          {transcriptGpa === null ? "None" : transcriptGpa.toFixed(2)}
        </div>
        <div className="mt-0.5 text-[10.5px] text-muted">what the school reports</div>
      </div>
    </div>
  );
}

export function SubjectRow({ label, credits, gpa, role }: { label: string; credits: string; gpa: string; role: "committed" | "offer" | "target" }) {
  const rail = role === "committed" ? "border-l-ios-green" : role === "offer" ? "border-l-ios-orange" : "border-l-ios-gray";
  return (
    <div className={`rounded-[10px] border-l-[5px] bg-paper px-3.5 py-3 ${rail}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-ink">{label}</div>
          <div className="text-[11.5px] text-muted">{credits}</div>
        </div>
        <span className="text-[13px] font-extrabold tabular-nums text-ink">{gpa}</span>
      </div>
    </div>
  );
}

export function NoteRail({ role, children }: { role: "contact" | "offer" | "target" | "time"; children: ReactNode }) {
  const rail =
    role === "contact"
      ? "border-l-ios-blue"
      : role === "offer"
        ? "border-l-ios-orange"
        : role === "time"
          ? "border-l-ios-yellow"
          : "border-l-ios-gray";
  return <div className={`rounded-[10px] border-l-[5px] bg-paper px-3.5 py-3 ${rail}`}>{children}</div>;
}
