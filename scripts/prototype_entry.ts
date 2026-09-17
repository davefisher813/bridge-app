// What the click-through prototype runs on.
//
// The point, and the difference between this and the static previews:
// the numbers in the prototype are computed by the SHIPPED modules, not
// written into the mock data. Change a grading scale and the core GPA
// recalculates through src/lib/fit/ncaa/. Record a gift and the year's
// total recalculates through src/lib/fundraising/. Credit it to a board
// member and their give/get moves through src/lib/governance/.
//
// This only works because those modules are walled off from Next,
// Supabase and the DOM, which is the practical payoff of that rule.
// src/lib/data/ncaaAdapters.ts is included too: it imports only from
// src/lib/fit/, so it bundles cleanly and saves the prototype from
// reimplementing the school-by-school conversion.

import { scoreFit } from "../src/lib/fit/score";
import type { Athlete, School } from "../src/lib/fit/types";
import { buildEligibilityView } from "../src/lib/data/ncaaAdapters";
import { DIVISION_STANDARDS, normalizeDivision } from "../src/lib/fit/ncaa/initialEligibility";
import { TEN_POINT_STARTING_POINT, gradingScaleProblem } from "../src/lib/fit/ncaa/gradingScale";
import {
  summarize as summarizeFundraising,
  campaignProgress,
  donorTotals,
  outstandingOn,
  formatMoney,
  formatMoneyShort,
  toCents,
  CATEGORY_LABEL,
  GIFT_CATEGORIES,
} from "../src/lib/fundraising/rollup";
import {
  creditedGifts,
  giveGetProgress,
  summarizeBoard,
  BOARD_KIND_LABEL,
  BOARD_KIND_PURPOSE,
  DEFAULT_GIVE_GET_CENTS,
} from "../src/lib/governance/giveGet";

declare global {
  interface Window {
    Engines: {
      scoreFit: typeof scoreFit;
      buildEligibilityView: typeof buildEligibilityView;
      DIVISION_STANDARDS: typeof DIVISION_STANDARDS;
      normalizeDivision: typeof normalizeDivision;
      TEN_POINT_STARTING_POINT: typeof TEN_POINT_STARTING_POINT;
      gradingScaleProblem: typeof gradingScaleProblem;
      summarizeFundraising: typeof summarizeFundraising;
      campaignProgress: typeof campaignProgress;
      donorTotals: typeof donorTotals;
      outstandingOn: typeof outstandingOn;
      formatMoney: typeof formatMoney;
      formatMoneyShort: typeof formatMoneyShort;
      toCents: typeof toCents;
      CATEGORY_LABEL: typeof CATEGORY_LABEL;
      GIFT_CATEGORIES: typeof GIFT_CATEGORIES;
      creditedGifts: typeof creditedGifts;
      giveGetProgress: typeof giveGetProgress;
      summarizeBoard: typeof summarizeBoard;
      BOARD_KIND_LABEL: typeof BOARD_KIND_LABEL;
      BOARD_KIND_PURPOSE: typeof BOARD_KIND_PURPOSE;
      DEFAULT_GIVE_GET_CENTS: typeof DEFAULT_GIVE_GET_CENTS;
    };
  }
}

export type { Athlete, School };

window.Engines = {
  scoreFit,
  buildEligibilityView,
  DIVISION_STANDARDS,
  normalizeDivision,
  TEN_POINT_STARTING_POINT,
  gradingScaleProblem,
  summarizeFundraising,
  campaignProgress,
  donorTotals,
  outstandingOn,
  formatMoney,
  formatMoneyShort,
  toCents,
  CATEGORY_LABEL,
  GIFT_CATEGORIES,
  creditedGifts,
  giveGetProgress,
  summarizeBoard,
  BOARD_KIND_LABEL,
  BOARD_KIND_PURPOSE,
  DEFAULT_GIVE_GET_CENTS,
};
