import { Chip } from "@/components/kit";
import { stageKind, statusRole } from "@/components/statusHue";

// Catalog item P1, rewritten 2026-09-17.
//
// It used to be a saturated fill with its paired foreground, which is
// what kept a bold 11px pill above 4.5:1. Dave, looking at the roster:
// "make sure there's no color highlights on the pills, we said we were
// going with icons, make sure it's consistent throughout."
//
// He is right that it was inconsistent. A row already carried its kind
// as a bare glyph after the September 16 change, and then a filled block
// of the same colour sat on the other end of the same row: two different
// treatments, both colour, both saying status, on one line.
//
// So a status is now a glyph plus a plain label, the same anatomy the
// type mark uses. The stage keeps its hue, on the glyph, and the colour
// is no longer a block. Which mattered more than it looked: the fill was
// the last thing in the app leaning on a solid pair for legibility at
// 11px, and small bold text on a saturated ground is where contrast
// problems start.
export function StatusPill({ status }: { status: string }) {
  return <Chip label={status} kind={stageKind(status)} role={statusRole(status)} />;
}
