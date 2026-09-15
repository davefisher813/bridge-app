import { SOLID, statusRole } from "@/components/statusHue";

// Catalog item P1: solid saturated fills, not tints, each used with its
// own paired foreground token, which is what keeps an 11px bold pill above
// 4.5:1. The status-to-hue mapping and the fill pairs both live in
// statusHue.ts so the pill, the row rails and the board's group tabs can
// never disagree about what color a status is.
// See docs/STYLING_CATALOG.md.
export function StatusPill({ status }: { status: string }) {
  const style = SOLID[statusRole(status)];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-bold ${style}`}>
      {status}
    </span>
  );
}
