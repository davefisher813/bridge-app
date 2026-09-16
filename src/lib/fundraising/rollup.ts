// Turning a list of gifts, pledges and budget lines into the numbers a
// board actually looks at.
//
// Pure, and walled off from Supabase and Next the same way src/lib/fit/
// and src/lib/docai/ are, so it runs in the test bench and can be
// exercised without a database.
//
// Four rules live here, and every one of them is a way a board report
// goes quietly wrong rather than visibly wrong:
//
//   1. A pledge is not revenue. Money promised is not money received,
//      and counting it in "raised" overstates the year. It is reported
//      beside the total, never inside it.
//   2. An in-kind gift is not cash. A donated case of food valued at
//      $500 belongs in total support and not in anything anyone can
//      spend. Treasurers ask this question and the answer has to be
//      right.
//   3. Money is integer cents, never a float. 0.1 + 0.2 is not 0.3, and
//      a donation list long enough will drift by a cent, which is the
//      kind of error that costs an hour to find in a reconciliation.
//   4. A partly paid pledge shows what is still outstanding, never its
//      original amount. Otherwise every payment against it inflates the
//      committed figure instead of reducing it.

export type GiftCategory = "individual" | "board" | "corporate" | "special_event" | "grant";

export const GIFT_CATEGORIES: GiftCategory[] = ["individual", "board", "corporate", "special_event", "grant"];

// The labels Dave's existing BFFSA app uses on its P&L, kept identical
// so a report out of this system reconciles against the one he already
// shows the board.
export const CATEGORY_LABEL: Record<GiftCategory, string> = {
  individual: "Individual Donations",
  board: "Board Member Contributions",
  corporate: "Corporate Donations",
  special_event: "Special Events",
  grant: "Foundation Grants",
};

export type GiftMethod = "stripe" | "check" | "cash" | "in_kind" | "other";

export interface Gift {
  id: string;
  // Cents. Negative is a refund or correction, which keeps a reversal in
  // the same ledger as the thing it reverses instead of in a second code
  // path that someone forgets to subtract.
  amountCents: number;
  receivedOn: string;
  category: GiftCategory;
  method: GiftMethod;
  donorId: string | null;
  campaignId: string | null;
  pledgeId: string | null;
}

export type PledgeStatus = "open" | "fulfilled" | "written_off";

export interface Pledge {
  id: string;
  amountCents: number;
  promisedOn: string;
  dueOn: string | null;
  status: PledgeStatus;
  donorId: string | null;
  campaignId: string | null;
}

export interface BudgetLine {
  fiscalYear: number;
  category: GiftCategory;
  amountCents: number;
}

export interface CategoryRow {
  category: GiftCategory;
  label: string;
  // Cash actually received, this fiscal year.
  receivedCents: number;
  // In-kind received, reported separately because it is not spendable.
  inKindCents: number;
  budgetCents: number;
  // Null when there is no budget line, which is different from a budget
  // of zero: one means nobody set a target, the other means the target
  // is nothing.
  percentOfBudget: number | null;
}

export interface FundraisingSummary {
  fiscalYear: number;
  byCategory: CategoryRow[];
  // Cash in the door. The headline number, and the only one anyone may
  // call "raised".
  totalCashCents: number;
  totalInKindCents: number;
  // Cash plus in-kind. What a grant application usually means by total
  // support.
  totalSupportCents: number;
  totalBudgetCents: number;
  // Promised and not yet received. Reported next to the total, never
  // added to it.
  outstandingPledgeCents: number;
  // Pledges whose due date has passed and which are still not fully
  // paid. The follow-up list.
  overduePledgeCents: number;
  donorCount: number;
  giftCount: number;
}

// The fiscal year a date falls in. Calendar year, because that is what
// Dave's current P&L uses ("2026 Budget") and a 501(c)(3) filing on a
// calendar year is the common case. If Bridge ever moves to a July start
// this is the one function that changes.
export function fiscalYearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

// Money arrives from Postgres numeric as a string, from a form as a
// string, and from JSON as a number. All three become integer cents
// here, once, rather than each caller doing its own rounding slightly
// differently.
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  // Rounded rather than truncated: 19.99 * 100 is 1998.9999999999998 in
  // binary floating point, and truncating it loses a cent on a number
  // somebody typed exactly.
  return Math.round(n * 100);
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-US")}.${rest}`;
}

// Whole dollars, for a headline tile where the cents are noise. Never
// used where a figure has to reconcile.
export function formatMoneyShort(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
}

// What is still owed on a pledge: its amount, less everything received
// against it, floored at zero. An overpayment does not become a negative
// obligation.
export function outstandingOn(pledge: Pledge, gifts: Gift[]): number {
  if (pledge.status === "written_off" || pledge.status === "fulfilled") return 0;
  const paid = gifts.filter((g) => g.pledgeId === pledge.id).reduce((s, g) => s + g.amountCents, 0);
  return Math.max(0, pledge.amountCents - paid);
}

export interface SummaryInput {
  gifts: Gift[];
  pledges: Pledge[];
  budget: BudgetLine[];
  fiscalYear: number;
  // Used to decide which pledges are overdue. Passed in rather than read
  // off the clock, so the same inputs always produce the same summary.
  today: string;
}

export function summarize(input: SummaryInput): FundraisingSummary {
  const inYear = input.gifts.filter((g) => fiscalYearOf(g.receivedOn) === input.fiscalYear);

  const budgetFor = new Map<GiftCategory, number>();
  for (const b of input.budget) {
    if (b.fiscalYear === input.fiscalYear) budgetFor.set(b.category, b.amountCents);
  }

  const byCategory: CategoryRow[] = GIFT_CATEGORIES.map((category) => {
    const rows = inYear.filter((g) => g.category === category);
    // The in-kind split is the whole reason these are two numbers. A
    // donated item is support, not cash, and adding it to cash raised
    // tells a treasurer there is money that is not there.
    const receivedCents = rows.filter((g) => g.method !== "in_kind").reduce((s, g) => s + g.amountCents, 0);
    const inKindCents = rows.filter((g) => g.method === "in_kind").reduce((s, g) => s + g.amountCents, 0);
    const budgetCents = budgetFor.get(category);

    return {
      category,
      label: CATEGORY_LABEL[category],
      receivedCents,
      inKindCents,
      budgetCents: budgetCents ?? 0,
      // Against cash only, and undefined rather than infinite when there
      // is no budget to measure against.
      percentOfBudget: budgetCents && budgetCents > 0 ? Math.round((receivedCents / budgetCents) * 100) : null,
    };
  });

  const totalCashCents = byCategory.reduce((s, r) => s + r.receivedCents, 0);
  const totalInKindCents = byCategory.reduce((s, r) => s + r.inKindCents, 0);

  let outstandingPledgeCents = 0;
  let overduePledgeCents = 0;
  for (const p of input.pledges) {
    const owed = outstandingOn(p, input.gifts);
    if (owed <= 0) continue;
    outstandingPledgeCents += owed;
    if (p.dueOn && p.dueOn < input.today) overduePledgeCents += owed;
  }

  // Counted on gifts that actually name a donor. An anonymous bucket at
  // an event is real money and not a supporter anyone can thank, so
  // folding it in would inflate the number that gets quoted in a grant
  // application.
  const donorIds = new Set(inYear.map((g) => g.donorId).filter((id): id is string => !!id));

  return {
    fiscalYear: input.fiscalYear,
    byCategory,
    totalCashCents,
    totalInKindCents,
    totalSupportCents: totalCashCents + totalInKindCents,
    totalBudgetCents: byCategory.reduce((s, r) => s + r.budgetCents, 0),
    outstandingPledgeCents,
    overduePledgeCents,
    donorCount: donorIds.size,
    giftCount: inYear.length,
  };
}

export interface DonorTotals {
  donorId: string;
  // Lifetime, across every year, cash only.
  lifetimeCashCents: number;
  lifetimeInKindCents: number;
  thisYearCashCents: number;
  firstGiftOn: string | null;
  lastGiftOn: string | null;
  giftCount: number;
  outstandingPledgeCents: number;
}

// Derived on read, never stored on the donor row.
//
// Dave's current app keeps `total`, `last` and `init` as columns on the
// donor, which is guaranteed to drift the first time a gift is corrected
// or deleted and nobody remembers to update them by hand. A sum is
// cheap; a wrong stored total that nobody can explain is not.
export function donorTotals(donorId: string, gifts: Gift[], pledges: Pledge[], fiscalYear: number): DonorTotals {
  const theirs = gifts.filter((g) => g.donorId === donorId);
  const cash = theirs.filter((g) => g.method !== "in_kind");
  const dates = theirs.map((g) => g.receivedOn).sort();

  return {
    donorId,
    lifetimeCashCents: cash.reduce((s, g) => s + g.amountCents, 0),
    lifetimeInKindCents: theirs.filter((g) => g.method === "in_kind").reduce((s, g) => s + g.amountCents, 0),
    thisYearCashCents: cash.filter((g) => fiscalYearOf(g.receivedOn) === fiscalYear).reduce((s, g) => s + g.amountCents, 0),
    firstGiftOn: dates[0] ?? null,
    lastGiftOn: dates[dates.length - 1] ?? null,
    giftCount: theirs.length,
    outstandingPledgeCents: pledges
      .filter((p) => p.donorId === donorId)
      .reduce((s, p) => s + outstandingOn(p, gifts), 0),
  };
}

export interface CampaignProgress {
  campaignId: string;
  raisedCents: number;
  pledgedCents: number;
  goalCents: number;
  // Against cash raised, not cash plus pledges. A campaign that has
  // promises covering its goal has not met its goal.
  percentOfGoal: number | null;
}

export function campaignProgress(campaignId: string, goalCents: number, gifts: Gift[], pledges: Pledge[]): CampaignProgress {
  const raisedCents = gifts
    .filter((g) => g.campaignId === campaignId && g.method !== "in_kind")
    .reduce((s, g) => s + g.amountCents, 0);
  const pledgedCents = pledges.filter((p) => p.campaignId === campaignId).reduce((s, p) => s + outstandingOn(p, gifts), 0);

  return {
    campaignId,
    raisedCents,
    pledgedCents,
    goalCents,
    percentOfGoal: goalCents > 0 ? Math.round((raisedCents / goalCents) * 100) : null,
  };
}
