// Where a state sits, for the matches screen's region filter. Plain
// data, like the rest of the contract: the Census Bureau's four regions
// split into the divisions a family actually talks in ("the Northeast",
// "the Carolinas"). A school's state comes from the shared table; a
// region is derived here and never stored.

export const REGIONS = ["Northeast", "Mid-Atlantic", "Southeast", "Midwest", "South Central", "Mountain", "Pacific"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_OF_STATE: Record<string, Region> = {
  CT: "Northeast", ME: "Northeast", MA: "Northeast", NH: "Northeast", RI: "Northeast", VT: "Northeast", NY: "Northeast", NJ: "Northeast",
  PA: "Mid-Atlantic", DE: "Mid-Atlantic", MD: "Mid-Atlantic", DC: "Mid-Atlantic", VA: "Mid-Atlantic", WV: "Mid-Atlantic",
  NC: "Southeast", SC: "Southeast", GA: "Southeast", FL: "Southeast", AL: "Southeast", MS: "Southeast", TN: "Southeast", KY: "Southeast",
  OH: "Midwest", MI: "Midwest", IN: "Midwest", IL: "Midwest", WI: "Midwest", MN: "Midwest", IA: "Midwest", MO: "Midwest", ND: "Midwest", SD: "Midwest", NE: "Midwest", KS: "Midwest",
  TX: "South Central", OK: "South Central", AR: "South Central", LA: "South Central",
  MT: "Mountain", ID: "Mountain", WY: "Mountain", CO: "Mountain", NM: "Mountain", AZ: "Mountain", UT: "Mountain", NV: "Mountain",
  WA: "Pacific", OR: "Pacific", CA: "Pacific", AK: "Pacific", HI: "Pacific",
};

export function regionOf(state: string | null | undefined): Region | null {
  if (!state) return null;
  return REGION_OF_STATE[state.trim().toUpperCase()] ?? null;
}
