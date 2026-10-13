// Doc AI piece 7: who signs a document off before it is treated as final
// (docs/ROADMAP.md, "Approver roles for Pieces 7 and 8").
//
// Three areas, each held by at most one Admin per org (migration 0067,
// doc_approvers): academic (transcripts, recommendations), eligibility
// (test scores) and financial (aid letters, offers). Every other type has
// no area and stays a single Admin tap. Nobody is named yet, and with
// nobody named nothing changes: any Admin marks Ready, as before.
//
// Pure: the map and the one decision the document screen and the server
// action both make. Loading the approvers is src/lib/data/docApprovers.ts.

import type { DocCategoryId } from "@/lib/docai/types";

export const APPROVER_AREAS = ["academic", "eligibility", "financial"] as const;
export type ApproverArea = (typeof APPROVER_AREAS)[number];

export const AREA_CATEGORIES: Record<ApproverArea, readonly DocCategoryId[]> = {
  academic: ["transcript", "recommendation"],
  eligibility: ["test_scores"],
  financial: ["financial_aid", "offer_letter"],
};

// Each is a title (Title Case, copyLaws).
export const AREA_LABEL: Record<ApproverArea, string> = {
  academic: "Academic Approver",
  eligibility: "Eligibility Approver",
  financial: "Financial Approver",
};

// What each area signs off, said the way a person reads it.
export const AREA_COVERS: Record<ApproverArea, string> = {
  academic: "Transcripts and Recommendations",
  eligibility: "Test Scores",
  financial: "Financial Aid and Offer Letters",
};

export function isApproverArea(v: unknown): v is ApproverArea {
  return typeof v === "string" && (APPROVER_AREAS as readonly string[]).includes(v);
}

// The area a document type belongs to, or null for a type nobody signs
// off (metrics, a profile, a board document, other, film, no type).
export function approverAreaOf(category: string | null | undefined): ApproverArea | null {
  if (!category) return null;
  for (const area of APPROVER_AREAS) if ((AREA_CATEGORIES[area] as readonly string[]).includes(category)) return area;
  return null;
}

export interface NamedApprover {
  id: string;
  name: string;
}

export type ApproverMap = Record<ApproverArea, NamedApprover | null>;

export const NOBODY_NAMED: ApproverMap = { academic: null, eligibility: null, financial: null };

// Who may mark a document of this type Ready.
//   open:    no area, or nobody named for it: any Admin, one tap.
//   mine:    the person asking is the named approver.
//   waiting: somebody else is named; the person asking may not.
export type ReadyGate =
  | { kind: "open"; area: ApproverArea | null }
  | { kind: "mine"; area: ApproverArea; approver: NamedApprover }
  | { kind: "waiting"; area: ApproverArea; approver: NamedApprover };

export function readyGate(category: string | null | undefined, approvers: ApproverMap, userId: string): ReadyGate {
  const area = approverAreaOf(category);
  if (!area) return { kind: "open", area: null };
  const approver = approvers[area];
  if (!approver) return { kind: "open", area };
  return approver.id === userId ? { kind: "mine", area, approver } : { kind: "waiting", area, approver };
}

export function canMarkReady(gate: ReadyGate): boolean {
  return gate.kind !== "waiting";
}

// What a person who may not mark Ready sees instead of the button.
export function waitingTitle(approver: NamedApprover): string {
  return `Waiting on ${approver.name} to Approve`;
}
