// The eligibility verdict banner and its supporting pieces.
//
// Colour follows the catalog: the verdict sits on the Score axis, green
// then yellow then gray, and never red. Red is the primary action colour
// there, and "red is not a status" is explicit in the contract. Severity
// is carried by the words, which is also the honest way round: "cannot
// compete in year one" says more than a colour does.

import type { ReactNode } from "react";
import { Body, Card, Chip, Figure, Grid2, Label, Row } from "@/components/kit";
import type { RowKind } from "@/components/RowGlyph";
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

// Which glyph each verdict wears. A verdict says its severity with a
// shape, since no tint carries it.
const VERDICT_KIND: Record<EligibilityStatus, RowKind> = {
  early_academic_qualifier: "check",
  qualifier: "check",
  academic_redshirt: "warning",
  partial_qualifier: "warning",
  nonqualifier: "blocked",
  not_applicable: "note",
  insufficient_data: "note",
};

export function VerdictCard({ status, headline, children }: { status: EligibilityStatus; headline: string; children?: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-col gap-2">
        <Chip label={STATUS_LABEL[status]} kind={VERDICT_KIND[status]} role={STATUS_ROLE[status]} />
        <Body weight="bold">{headline}</Body>
        {children}
      </div>
    </Card>
  );
}

// Two numbers, side by side, always. Showing a transcript GPA on its own
// next to an NCAA heading is how a family gets told their kid is fine
// when he is not, so the core figure never appears without its
// counterpart and the sentence explaining why they differ.
// Both numbers are read off the courses, so both cards open the
// transcript they are read from (Dave, 2026-09-25: everything that
// should be tappable is).
export function GpaPair({ coreGpa, transcriptGpa, needed, transcriptHref }: { coreGpa: number | null; transcriptGpa: number | null; needed: number | null; transcriptHref?: string }) {
  return (
    <Grid2>
      <Card href={transcriptHref}>
        <Label caps>NCAA core</Label>
        <Figure>{coreGpa === null ? "?" : coreGpa.toFixed(2)}</Figure>
        <Label>{needed === null ? "no NCAA standard" : `needs ${needed} to compete`}</Label>
      </Card>
      <Card href={transcriptHref}>
        <Label caps>Transcript</Label>
        <Figure>{transcriptGpa === null ? "None" : transcriptGpa.toFixed(2)}</Figure>
        <Label>what the school reports</Label>
      </Card>
    </Grid2>
  );
}

export function SubjectRow({ label, credits, gpa, role, href }: { label: string; credits: string; gpa: string; role: "committed" | "offer" | "target"; href?: string }) {
  const kind: RowKind = role === "committed" ? "check" : role === "offer" ? "warning" : "stage_none";
  return <Row href={href} kind={kind} role={role} title={label} meta={credits} trailing={<Body weight="bold" numeric>{gpa}</Body>} />;
}

// A sentence or two on paper: a caveat, a reason, an explanation.
export function Note({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <Card isStatic>
      {title && <Body weight="bold">{title}</Body>}
      {children && <Label>{children}</Label>}
    </Card>
  );
}
