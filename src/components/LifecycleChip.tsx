import { Chip } from "@/components/kit";
import type { RowKind } from "@/components/RowGlyph";
import type { Role } from "@/components/statusHue";
import { LIFECYCLE_LABEL, type Lifecycle } from "@/lib/vault/lifecycle";

// The vault's five states as a chip: the same word and glyph on every
// list row and on the document screen, so a state reads the same
// wherever it appears. Kit only; the colour is the glyph's.
const LOOK: Record<Lifecycle, { kind: RowKind; role: Role }> = {
  uploaded: { kind: "document", role: "neutral" },
  processing: { kind: "clock", role: "contact" },
  needs_review: { kind: "warning", role: "offer" },
  ready: { kind: "check", role: "committed" },
  archived: { kind: "note", role: "neutral" },
};

export function LifecycleChip({ lifecycle }: { lifecycle: Lifecycle }) {
  const look = LOOK[lifecycle];
  return <Chip label={LIFECYCLE_LABEL[lifecycle]} kind={look.kind} role={look.role} />;
}
