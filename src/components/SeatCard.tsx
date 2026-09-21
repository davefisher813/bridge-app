import { formatMoney } from "@/lib/fundraising/rollup";
import type { GivingView } from "@/lib/data/member";
import { Body, Card, Label, Meter, Stack } from "@/components/kit";
import type { Role } from "@/components/statusHue";

// A member's own give/get, the way the staff seat screen shows it:
// the commitment, the percent, the bar, and the four lines under it.
// Used on the member's home and on Giving, so the two never disagree.

export function roleForPercent(percent: number | null): Role {
  if (percent === null) return "target";
  if (percent >= 100) return "committed";
  if (percent >= 50) return "offer";
  return "target";
}

export function SeatCard({ seat, fiscalYear, href }: { seat: NonNullable<GivingView["seat"]>; fiscalYear: number; href?: string }) {
  const p = seat.progress;
  const role = seat.member.status === "active" ? roleForPercent(p.percent) : "target";
  const lines: [string, string][] = [
    ["Commitment", formatMoney(p.commitmentCents)],
    ["Given", formatMoney(p.givenCents)],
    ["Brought in", formatMoney(p.raisedCents)],
    ["Still to go", formatMoney(p.remainingCents)],
  ];
  if (p.pledgedCents > 0) lines.push(["Promised, not yet received", formatMoney(p.pledgedCents)]);

  return (
    <Card href={href}>
      <Stack gap={2}>
        <div className="flex items-start justify-between gap-3">
          <Body weight="bold">{seat.member.roleTitle ? `${seat.member.roleTitle}${seat.board ? ` · ${seat.board.name}` : ""}` : (seat.board?.name ?? "Your seat")}</Body>
          <Body weight="bold" numeric tone={role}>
            {p.percent === null ? "no target" : `${p.percent}%`}
          </Body>
        </div>
        {p.commitmentCents > 0 ? (
          <Label>{`${formatMoney(p.totalCents)} of ${formatMoney(p.commitmentCents)} for ${fiscalYear}. Giving and bringing in both count.`}</Label>
        ) : (
          <Label>No commitment is set on this seat.</Label>
        )}
        {p.commitmentCents > 0 && <Meter parts={[{ role, fraction: (p.percent ?? 0) / 100 }]} />}
        <Stack gap={2}>
          {lines.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <Label>{k}</Label>
              <Body weight="bold" numeric>
                {v}
              </Body>
            </div>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}
