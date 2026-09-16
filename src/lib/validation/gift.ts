import { z } from "zod";
import { GIFT_CATEGORIES, toCents, type GiftCategory } from "@/lib/fundraising/rollup";

export const GIFT_METHODS = ["stripe", "check", "cash", "in_kind", "other"] as const;
export type GiftMethodValue = (typeof GIFT_METHODS)[number];

export const METHOD_LABEL: Record<GiftMethodValue, string> = {
  stripe: "Stripe",
  check: "Check",
  cash: "Cash",
  in_kind: "In kind",
  other: "Other",
};

export interface GiftFormValues {
  amountCents: number;
  receivedOn: string;
  category: GiftCategory;
  method: GiftMethodValue;
  donorId: string | null;
  campaignId: string | null;
  pledgeId: string | null;
  // The board member credited with bringing this in, when it was not
  // their own money. The "get" half of give/get, and the thing most
  // board software cannot record at all. Null when the board module is
  // off or nobody solicited it.
  solicitedBy: string | null;
  inKindDescription: string | null;
  externalRef: string | null;
  notes: string | null;
}

export interface GiftFormResult {
  ok: boolean;
  values: GiftFormValues | null;
  errors: Record<string, string>;
}

const strOrNull = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

// A regex says 2026-02-30 looks like a date. Postgres disagrees, and the
// rejection would take the whole row with it. Same check the document
// apply path uses.
function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export function parseGiftForm(formData: FormData): GiftFormResult {
  const errors: Record<string, string> = {};

  const rawAmount = String(formData.get("amount") ?? "").trim();
  const amountCents = toCents(rawAmount);
  if (rawAmount === "") {
    errors.amount = "How much was it?";
  } else if (amountCents === 0) {
    // Zero is not a gift, and a string that parsed to nothing is not
    // either. The database refuses it too; this is the message somebody
    // can act on.
    errors.amount = /^[-$,.\d\s]+$/.test(rawAmount) ? "A gift cannot be zero." : "That does not look like an amount.";
  } else if (Math.abs(amountCents) > 1_000_000_00) {
    // A million dollars is not impossible, it is just far more likely to
    // be a typo, and a wrong one here moves the headline figure.
    errors.amount = "That is over $1,000,000. Check it, or split it into separate gifts.";
  }

  const receivedOn = String(formData.get("receivedOn") ?? "").trim();
  if (!receivedOn) errors.receivedOn = "When did it arrive?";
  else if (!isRealDate(receivedOn)) errors.receivedOn = "That is not a real date.";

  const category = String(formData.get("category") ?? "");
  if (!(GIFT_CATEGORIES as string[]).includes(category)) errors.category = "Pick a category.";

  const method = String(formData.get("method") ?? "");
  if (!(GIFT_METHODS as readonly string[]).includes(method)) errors.method = "Pick how it arrived.";

  const inKindDescription = strOrNull(formData.get("inKindDescription"));
  if (method === "in_kind" && !inKindDescription) {
    // "$500 in kind" with no description is not something a treasurer or
    // an auditor can do anything with, and it is the first question
    // either of them will ask.
    errors.inKindDescription = "Say what was given. An in-kind amount with no description cannot be substantiated.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, values: null, errors };

  return {
    ok: true,
    errors: {},
    values: {
      amountCents,
      receivedOn,
      category: category as GiftCategory,
      method: method as GiftMethodValue,
      donorId: strOrNull(formData.get("donorId")),
      campaignId: strOrNull(formData.get("campaignId")),
      pledgeId: strOrNull(formData.get("pledgeId")),
      solicitedBy: strOrNull(formData.get("solicitedBy")),
      inKindDescription: method === "in_kind" ? inKindDescription : null,
      externalRef: strOrNull(formData.get("externalRef")),
      notes: strOrNull(formData.get("notes")),
    },
  };
}

export interface PledgeFormValues {
  donorId: string;
  amountCents: number;
  promisedOn: string;
  dueOn: string | null;
  campaignId: string | null;
  notes: string | null;
}

export interface PledgeFormResult {
  ok: boolean;
  values: PledgeFormValues | null;
  errors: Record<string, string>;
}

export function parsePledgeForm(formData: FormData): PledgeFormResult {
  const errors: Record<string, string> = {};

  // Unlike a gift, a pledge always has somebody behind it. An anonymous
  // promise is not a promise anyone can follow up on.
  const donorId = strOrNull(formData.get("donorId"));
  if (!donorId) errors.donorId = "Who promised it?";

  const rawAmount = String(formData.get("amount") ?? "").trim();
  const amountCents = toCents(rawAmount);
  if (amountCents <= 0) errors.amount = "A pledge has to be a positive amount.";

  const promisedOn = String(formData.get("promisedOn") ?? "").trim();
  if (!promisedOn) errors.promisedOn = "When was it promised?";
  else if (!isRealDate(promisedOn)) errors.promisedOn = "That is not a real date.";

  const dueOn = strOrNull(formData.get("dueOn"));
  if (dueOn && !isRealDate(dueOn)) errors.dueOn = "That is not a real date.";
  if (dueOn && promisedOn && dueOn < promisedOn) errors.dueOn = "The due date is before the promise was made.";

  if (Object.keys(errors).length > 0) return { ok: false, values: null, errors };

  return {
    ok: true,
    errors: {},
    values: {
      donorId: donorId!,
      amountCents,
      promisedOn,
      dueOn,
      campaignId: strOrNull(formData.get("campaignId")),
      notes: strOrNull(formData.get("notes")),
    },
  };
}

// Cents back to the decimal string a numeric(12,2) column wants. Built
// from integers so it cannot pick up a floating-point tail on the way
// out, which is the mirror of why toCents exists on the way in.
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
