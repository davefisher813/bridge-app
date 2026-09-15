// Shared status/color language across Athletes, Board, and Today:
// green = active/on-track, blue-indigo = in contact, accent red =
// committed/primary, muted = everything else (Target, Not Interested,
// unrecognized values). Matches the palette Dave approved in the
// full-preview artifact. See docs/DECISIONS.md.
const PILL_STYLE: Record<string, string> = {
  Active: "bg-success/15 text-success",
  "In Contact": "bg-info/15 text-info",
  Visit: "bg-info/15 text-info",
  Offer: "bg-success/15 text-success",
  Committed: "bg-accent/15 text-accent",
};

// bg-ink/5 rather than a fixed gray: --ink itself flips white/black between
// themes (see globals.css), so this tints correctly in both without a
// separate dark: variant.
const DEFAULT_STYLE = "bg-ink/5 text-muted";

export function StatusPill({ status }: { status: string }) {
  const style = PILL_STYLE[status] ?? DEFAULT_STYLE;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-bold ${style}`}>
      {status}
    </span>
  );
}
