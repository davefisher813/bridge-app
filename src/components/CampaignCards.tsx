import { Body, Card, Label, Meter, Stack } from "@/components/kit";
import { campaignProgress, formatMoneyShort, type Gift, type Pledge } from "@/lib/fundraising/rollup";

// One card per campaign: what it has raised against its goal, what is
// pledged beside it, and the meter. Shared by the Fundraising overview and
// the Campaigns screen so the two can never read differently.

export interface CampaignRow {
  id: string;
  name: string;
  kind: string;
  goal_amount: number | string | null;
}

// Green once it is on track, amber while it is behind, gray when nobody
// has set a target. Never red: the locked catalog keeps red for the
// primary action, and a campaign being behind is not an error.
export function campaignRole(percent: number | null): "committed" | "offer" | "target" {
  if (percent === null) return "target";
  return percent >= 75 ? "committed" : "offer";
}

export function CampaignCards({ slug, campaigns, gifts, pledges }: { slug: string; campaigns: CampaignRow[]; gifts: Gift[]; pledges: Pledge[] }) {
  return (
    <>
      {campaigns.map((c) => {
        const goalCents = c.goal_amount === null ? 0 : Math.round(Number(c.goal_amount) * 100);
        const p = campaignProgress(c.id, goalCents, gifts, pledges);
        const role = campaignRole(p.percentOfGoal);
        return (
          <Card key={c.id} href={`/org/${slug}/fundraising/campaigns/${c.id}`}>
            <Stack gap={2}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Body weight="bold" truncate>
                    {c.name}
                  </Body>
                  <Label>
                    {formatMoneyShort(p.raisedCents)} raised
                    {goalCents > 0 ? ` of a ${formatMoneyShort(goalCents)} goal` : ""}
                    {p.pledgedCents > 0 ? ` · ${formatMoneyShort(p.pledgedCents)} pledged` : ""}
                  </Label>
                </div>
                <Body weight="bold" numeric tone={p.percentOfGoal === null ? "muted" : "ink"}>
                  {p.percentOfGoal === null ? "no goal" : `${p.percentOfGoal}%`}
                </Body>
              </div>
              <Meter parts={[{ role, fraction: (p.percentOfGoal ?? 0) / 100 }]} />
            </Stack>
          </Card>
        );
      })}
    </>
  );
}
