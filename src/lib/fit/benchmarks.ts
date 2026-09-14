// Position/tier athletic benchmarks. Ported from Bridge's getDefaultBenchmarks()
// (bffsa-site/index.html ~line 708) which is real, admin-tuned data, not a
// stack of patches, so it carries over as-is. Org-editable later via
// benchmark_sets; this is the seeded default.

export interface PositionMetric {
  tier: string;
  sixtyMax?: number;
  sixtyIdeal?: number;
  armInf?: number;
  armOf?: number;
  exitVelo?: number;
  popTime?: number;
  fbMin?: number;
  fbIdeal?: number;
  note?: string;
}

export interface PositionBenchmark {
  id: string;
  label: string;
  metrics: PositionMetric[];
}

export const TIERS = [
  { id: "elite_d1", label: "Elite D1 / Top JUCO" },
  { id: "mid_d1", label: "Mid-Major D1" },
  { id: "low_d1", label: "Low D1 / High D2" },
  { id: "d2_naia", label: "D2 / D3 / NAIA" },
  { id: "juco", label: "JUCO" },
] as const;

export const BASEBALL_SOFTBALL_POSITIONS: PositionBenchmark[] = [
  {
    id: "middle_inf",
    label: "Middle Infield / CF (SS, 2B, CF)",
    metrics: [
      { tier: "elite_d1", sixtyMax: 6.9, sixtyIdeal: 6.7, armInf: 90, armOf: 95, exitVelo: 100 },
      { tier: "mid_d1", sixtyMax: 7.0, sixtyIdeal: 6.8, armInf: 87, armOf: 92, exitVelo: 95 },
      { tier: "low_d1", sixtyMax: 7.1, sixtyIdeal: 6.9, armInf: 84, armOf: 89, exitVelo: 90 },
      { tier: "d2_naia", sixtyMax: 7.3, sixtyIdeal: 7.1, armInf: 80, armOf: 85, exitVelo: 85 },
      { tier: "juco", sixtyMax: 7.2, sixtyIdeal: 6.9, armInf: 85, armOf: 90, exitVelo: 92 },
    ],
  },
  {
    id: "corner",
    label: "Corner Players (1B, 3B, LF, RF)",
    metrics: [
      { tier: "elite_d1", sixtyMax: 7.2, sixtyIdeal: 7.0, armInf: 90, armOf: 92, exitVelo: 100 },
      { tier: "mid_d1", sixtyMax: 7.4, sixtyIdeal: 7.2, armInf: 87, armOf: 89, exitVelo: 95 },
      { tier: "low_d1", sixtyMax: 7.5, sixtyIdeal: 7.3, armInf: 84, armOf: 86, exitVelo: 90 },
      { tier: "d2_naia", sixtyMax: 7.7, sixtyIdeal: 7.4, armInf: 80, armOf: 82, exitVelo: 85 },
      { tier: "juco", sixtyMax: 7.5, sixtyIdeal: 7.2, armInf: 85, armOf: 88, exitVelo: 92 },
    ],
  },
  {
    id: "catcher",
    label: "Catcher (C)",
    metrics: [
      { tier: "elite_d1", sixtyMax: 7.3, sixtyIdeal: 7.0, armInf: 90, armOf: 90, exitVelo: 98, popTime: 1.9 },
      { tier: "mid_d1", sixtyMax: 7.5, sixtyIdeal: 7.2, armInf: 85, armOf: 85, exitVelo: 93, popTime: 2.0 },
      { tier: "low_d1", sixtyMax: 7.6, sixtyIdeal: 7.3, armInf: 82, armOf: 82, exitVelo: 88, popTime: 2.05 },
      { tier: "d2_naia", sixtyMax: 7.8, sixtyIdeal: 7.5, armInf: 78, armOf: 78, exitVelo: 83, popTime: 2.1 },
      { tier: "juco", sixtyMax: 7.6, sixtyIdeal: 7.3, armInf: 82, armOf: 82, exitVelo: 88, popTime: 2.0 },
    ],
  },
  {
    id: "rhp",
    label: "RHP - Starting / Relieving",
    metrics: [
      { tier: "elite_d1", fbMin: 90, fbIdeal: 93, note: "93-95 ideal; 90 absolute floor" },
      { tier: "mid_d1", fbMin: 88, fbIdeal: 91, note: "90-93 mph range" },
      { tier: "low_d1", fbMin: 85, fbIdeal: 88, note: "Command and secondary matter more" },
      { tier: "d2_naia", fbMin: 82, fbIdeal: 86, note: "Location and off-speed key" },
      { tier: "juco", fbMin: 85, fbIdeal: 89, note: "Top JUCO equals Elite D1" },
    ],
  },
  {
    id: "lhp",
    label: "LHP - Starting / Relieving",
    metrics: [
      { tier: "elite_d1", fbMin: 88, fbIdeal: 91, note: "In the 90s plays anywhere" },
      { tier: "mid_d1", fbMin: 86, fbIdeal: 89, note: "About 2 mph grace vs RHP" },
      { tier: "low_d1", fbMin: 83, fbIdeal: 86, note: "Command counts heavily" },
      { tier: "d2_naia", fbMin: 80, fbIdeal: 84, note: "Off-speed and deception key" },
      { tier: "juco", fbMin: 83, fbIdeal: 88, note: "LHP premium at all levels" },
    ],
  },
];

// FIT-7 in the original: complete division to tier mapping.
export function divisionToTier(divStr: string | undefined): string {
  const d = (divStr || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (d === "D1" || d === "NCAA D1" || d === "DIVISION 1" || d === "DIVISION I") return "mid_d1";
  if (d.includes("FBS") || d.includes("POWER 5") || d.includes("POWER FIVE")) return "elite_d1";
  if (d.includes("FCS")) return "mid_d1";
  if (d.includes("JUCO") || d.includes("NJCAA") || d.includes("CCCAA")) return "juco";
  if (d === "D2" || d === "NCAA D2" || d === "DIVISION 2" || d === "DIVISION II") return "d2_naia";
  if (d === "D3" || d === "NCAA D3" || d === "DIVISION 3" || d === "DIVISION III") return "d2_naia";
  if (d.includes("NAIA")) return "d2_naia";
  if (d.includes("PREP")) return "juco";
  return "mid_d1";
}

export function isD3(divStr: string | undefined): boolean {
  const d = (divStr || "").toUpperCase();
  return d === "D3" || d === "NCAA D3" || d === "DIVISION 3" || d === "DIVISION III" || d.includes("D3");
}

export function isD1D2(divStr: string | undefined): boolean {
  const d = (divStr || "").toUpperCase();
  return (
    d.includes("D1") ||
    d.includes("D2") ||
    d.includes("DIVISION 1") ||
    d.includes("DIVISION I") ||
    d.includes("DIVISION 2") ||
    d.includes("DIVISION II") ||
    d.includes("FBS") ||
    d.includes("FCS")
  );
}

// Division I only, distinct from isD1D2. Needed because the House v. NCAA
// settlement (scholarship caps replaced by roster limits) applies only to
// D1 schools that opt in; D2 keeps its own separate, still-capped
// scholarship rules untouched by the settlement. See docs/BUSINESS_RULES.md.
export function isD1(divStr: string | undefined): boolean {
  const d = (divStr || "").toUpperCase();
  return (
    d === "D1" ||
    d === "NCAA D1" ||
    d === "DIVISION 1" ||
    d === "DIVISION I" ||
    d.includes("FBS") ||
    d.includes("FCS") ||
    (d.includes("D1") && !d.includes("D2") && !d.includes("D3"))
  );
}
