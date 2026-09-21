import type { AdvancedSearchCriterionFilter, AdvancedSearchScope, CityExploreData, CriterionValue, PinnedLocationData } from "@/lib/types";

/**
 * Advanced search's criteria registry — the single source of truth for
 * "every existing criterion in the app" that the /explore/discover page
 * proposes as a filter. Each entry knows its own label/unit, how to read
 * its value off a city's aggregated data (CityExploreData, the exact same
 * object the single-city results page renders), and — for the 4 "nearest
 * X" fields — off that city's centre-point Pin-mode data too.
 *
 * Keeping this in one place (rather than scattering field lookups across
 * the API route and the UI) means the UI's list of filters and the API's
 * filtering logic can never drift out of sync with each other.
 *
 * There is no "Real Estate" category — see lib/types.ts's file header
 * comment for why (no reliable free global source exists today).
 */

export type CriterionKind = "range" | "boolean" | "select";

export type CategoryKey = "overall" | "economy" | "safetyStability" | "climate" | "liveability" | "demographics" | "nearby";

export const CATEGORY_ORDER: CategoryKey[] = ["overall", "economy", "safetyStability", "climate", "liveability", "demographics", "nearby"];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  overall: "Overall",
  economy: "Economy",
  safetyStability: "Safety & Stability",
  climate: "Climate",
  liveability: "Liveability",
  demographics: "Demographics",
  nearby: "Distance from city centre",
};

export const CATEGORY_DESCRIPTIONS: Partial<Record<CategoryKey, string>> = {};

export interface CriterionDef {
  key: string;
  category: CategoryKey;
  label: string;
  unit?: string;
  /** Filter input type at city scope. */
  kind: CriterionKind;
  /** Filter input type at country scope, if different — the 4 "nearest X"
   *  fields switch from a minutes range to a plain Yes/No, since "distance
   *  from a country's centre" isn't a meaningful question. */
  countryKind?: CriterionKind;
  selectOptions?: string[];
  /** Cosmetic bounds only, to seed sensible input placeholders — not
   *  enforced server-side. */
  suggestedRange?: [number, number];
  /** Overrides suggestedRange at country scope, for fields whose sensible
   *  bound genuinely differs by scope (e.g. Population — a country-scope
   *  value is an average across every tracked city in that country, which
   *  can run higher than any single city). Falls back to suggestedRange
   *  when not set. */
  countrySuggestedRange?: [number, number];
  /** Overrides label at country scope, for fields whose wording is
   *  city-specific (e.g. "City land area"). Falls back to label when not
   *  set. */
  countryLabel?: string;
  /** True when resolving this criterion needs the pin-at-centre lookup —
   *  lets the API route skip that call for every candidate when no Nearby
   *  filter is actually active. */
  needsPinData?: boolean;
  /** Reads this criterion's raw value for one city. `pin` is null unless
   *  needsPinData is true and the caller actually fetched it. */
  getCityValue: (data: CityExploreData, pin: PinnedLocationData | null) => CriterionValue;
}

function nearby(key: string, label: string, pick: (pin: PinnedLocationData) => number | null): CriterionDef {
  return {
    key,
    category: "nearby",
    label,
    unit: "min",
    kind: "range",
    countryKind: "boolean",
    suggestedRange: [0, 500],
    needsPinData: true,
    getCityValue: (_data, pin) => (pin ? pick(pin) : null),
  };
}

export const CRITERIA: CriterionDef[] = [
  // ---- Overall ----------------------------------------------------------
  {
    key: "overall.piltriScore",
    category: "overall",
    label: "Piltri Score",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.piltriScore,
  },

  // ---- Economy ------------------------------------------------------------
  {
    key: "economy.sectionScore",
    category: "economy",
    label: "Economy score",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.sectionScores.economy,
  },
  {
    key: "economy.economicGrowth5yrGdpPct",
    category: "economy",
    label: "5yr GDP growth",
    unit: "%",
    kind: "range",
    suggestedRange: [-25, 25],
    getCityValue: (d) => d.economy.economicGrowth5yrGdpPct,
  },
  {
    key: "economy.averageSalaryGbp",
    category: "economy",
    label: "Average salary per month (K)",
    unit: "K",
    kind: "range",
    suggestedRange: [0, 10],
    // Underlying field is an annual GBP figure (see aggregate.ts —
    // gniPerCapitaUsd * 0.79) - divided by 12 for monthly, then by 1000 for
    // K, same "value in K" convention as Population. One decimal kept since
    // monthly-in-K numbers are small (e.g. a £45,000/yr salary -> 3.75).
    getCityValue: (d) => Math.round((d.economy.averageSalaryGbp / 12 / 1000) * 10) / 10,
  },
  {
    key: "economy.unemploymentRatePct",
    category: "economy",
    label: "Unemployment rate",
    unit: "%",
    kind: "range",
    suggestedRange: [0, 50],
    getCityValue: (d) => d.economy.unemploymentRatePct,
  },
  {
    key: "economy.costOfLivingIndex",
    category: "economy",
    label: "Cost of living index",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.economy.costOfLivingIndex,
  },
  {
    key: "economy.purchasingPowerIndex",
    category: "economy",
    label: "Purchasing power index",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.economy.purchasingPowerIndex,
  },

  // ---- Safety & Stability ---------------------------------------------------
  {
    key: "safetyStability.sectionScore",
    category: "safetyStability",
    label: "Safety & Stability score",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.sectionScores.safetyStability,
  },
  {
    key: "safetyStability.politicalStabilityScore",
    category: "safetyStability",
    label: "Political stability score",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.safetyStability.politicalStabilityScore,
  },
  {
    key: "safetyStability.ruleOfLawScore",
    category: "safetyStability",
    label: "Rule of law score",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.safetyStability.ruleOfLawScore,
  },
  {
    key: "safetyStability.safetyTrend",
    category: "safetyStability",
    label: "Safety trend",
    kind: "select",
    selectOptions: ["Improving", "Stable", "Worsening"],
    getCityValue: (d) => d.safetyStability.safetyTrend,
  },

  // ---- Climate ------------------------------------------------------------
  {
    key: "climate.sectionScore",
    category: "climate",
    label: "Climate score",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.sectionScores.climate,
  },
  {
    key: "climate.avgAnnualTemperatureC",
    category: "climate",
    label: "Avg. annual temperature",
    unit: "°C",
    kind: "range",
    suggestedRange: [-10, 35],
    getCityValue: (d) => d.climate.avgAnnualTemperatureC,
  },
  {
    key: "climate.avgAnnualRainfallMm",
    category: "climate",
    label: "Avg. annual rainfall",
    unit: "mm",
    kind: "range",
    suggestedRange: [0, 3000],
    getCityValue: (d) => d.climate.avgAnnualRainfallMm,
  },
  {
    key: "climate.avgAnnualSunshineHrs",
    category: "climate",
    label: "Avg. annual sunshine",
    unit: "hrs",
    kind: "range",
    suggestedRange: [0, 8760],
    getCityValue: (d) => d.climate.avgAnnualSunshineHrs,
  },
  {
    key: "climate.avgAnnualSnowfallCm",
    category: "climate",
    label: "Avg. annual snowfall",
    unit: "cm",
    kind: "range",
    suggestedRange: [0, 200],
    getCityValue: (d) => d.climate.avgAnnualSnowfallCm,
  },

  // ---- Liveability --------------------------------------------------------
  {
    key: "liveability.sectionScore",
    category: "liveability",
    label: "Liveability score",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.sectionScores.liveability,
  },
  {
    key: "liveability.restaurantsBarsDensityPer10k",
    category: "liveability",
    label: "Restaurants & bars density",
    unit: "per 10k population",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.liveability.restaurantsBarsDensityPer10k,
  },
  {
    key: "liveability.greenSpacePctOfCityArea",
    category: "liveability",
    label: "Green space",
    unit: "% of city area",
    kind: "range",
    suggestedRange: [0, 60],
    getCityValue: (d) => d.liveability.greenSpacePctOfCityArea,
  },
  {
    key: "liveability.culturalVenuesDensityPer10k",
    category: "liveability",
    label: "Cultural venues density",
    unit: "per 10k population",
    kind: "range",
    suggestedRange: [0, 50],
    getCityValue: (d) => d.liveability.culturalVenuesDensityPer10k,
  },
  {
    key: "liveability.familyKidsActivitiesDensityPer10k",
    category: "liveability",
    label: "Family activities density",
    unit: "per 10k population",
    kind: "range",
    suggestedRange: [0, 50],
    getCityValue: (d) => d.liveability.familyKidsActivitiesDensityPer10k,
  },
  {
    key: "liveability.healthcareQualityScore",
    category: "liveability",
    label: "Healthcare quality score",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.liveability.healthcareQualityScore,
  },
  {
    key: "liveability.hasTrainStation",
    category: "liveability",
    label: "Has train station",
    kind: "boolean",
    getCityValue: (d) => d.liveability.hasTrainStation,
  },
  {
    key: "liveability.hasSubway",
    category: "liveability",
    label: "Has subway",
    kind: "boolean",
    getCityValue: (d) => d.liveability.hasSubway,
  },
  {
    key: "liveability.hasTramway",
    category: "liveability",
    label: "Has tramway",
    kind: "boolean",
    getCityValue: (d) => d.liveability.hasTramway,
  },
  {
    key: "liveability.hasAirport",
    category: "liveability",
    label: "Has airport",
    kind: "boolean",
    getCityValue: (d) => d.liveability.hasAirport,
  },

  // ---- Demographics (reference info, not scored) ---------------------------
  {
    key: "demographics.population",
    category: "demographics",
    label: "Population",
    unit: "K",
    kind: "range",
    suggestedRange: [1, 5000],
    countrySuggestedRange: [1, 150000],
    // Expressed in thousands (K) rather than the raw headcount - matches
    // the suggestedRange bounds above (1 to 5000, i.e. 1,000 to 5,000,000)
    // and how it's shown in formatCriterionValue's default "num unit"
    // rendering ("1,240 K" rather than a much harder-to-scan "1,240,000").
    getCityValue: (d) => Math.round(d.demographics.population / 1000),
  },
  {
    key: "demographics.populationDensityPerKm2",
    category: "demographics",
    label: "Population density",
    unit: "per km²",
    kind: "range",
    suggestedRange: [500, 50000],
    getCityValue: (d) => d.demographics.populationDensityPerKm2,
  },
  {
    key: "demographics.populationTrend5yrPct",
    category: "demographics",
    label: "5yr population trend",
    unit: "%",
    kind: "range",
    suggestedRange: [-25, 25],
    getCityValue: (d) => d.demographics.populationTrend5yrPct,
  },
  {
    key: "demographics.averageAge",
    category: "demographics",
    label: "Average age",
    unit: "yrs",
    kind: "range",
    suggestedRange: [20, 60],
    getCityValue: (d) => d.demographics.averageAge,
  },
  {
    key: "demographics.areaKm2",
    category: "demographics",
    label: "City land area",
    countryLabel: "Country land area",
    unit: "km²",
    kind: "range",
    suggestedRange: [10, 10000],
    getCityValue: (d) => d.demographics.areaKm2,
  },

  // ---- Nearby & distance from city centre (mirrors Pin mode) --------------
  nearby("nearby.beach", "Beach", (p) => p.nearestBeach.minutes),
  nearby("nearby.mountain", "Mountain", (p) => p.nearestMountain.minutes),
  nearby("nearby.trainStation", "Train station", (p) => p.nearestTrainStation.minutes),
  nearby("nearby.airport", "Airport", (p) => p.nearestAirport.minutes),
];

const CRITERIA_BY_KEY = new Map(CRITERIA.map((c) => [c.key, c]));

export function getCriterion(key: string): CriterionDef | undefined {
  return CRITERIA_BY_KEY.get(key);
}

export function criteriaByCategory(): Record<CategoryKey, CriterionDef[]> {
  const result = {} as Record<CategoryKey, CriterionDef[]>;
  for (const key of CATEGORY_ORDER) result[key] = [];
  for (const c of CRITERIA) result[c.category].push(c);
  return result;
}

/** This criterion's filter-input kind for the given scope — Nearby-category
 *  fields switch from a minutes range (city) to Yes/No (country). */
export function kindForScope(def: CriterionDef, scope: AdvancedSearchScope): CriterionKind {
  return scope === "country" && def.countryKind ? def.countryKind : def.kind;
}

/** This criterion's suggested min/max bounds for the given scope — falls
 *  back to suggestedRange unless a countrySuggestedRange override exists
 *  (see CriterionDef.countrySuggestedRange, e.g. Population). */
export function rangeForScope(def: CriterionDef, scope: AdvancedSearchScope): [number, number] | undefined {
  return scope === "country" && def.countrySuggestedRange ? def.countrySuggestedRange : def.suggestedRange;
}

/** This criterion's display label for the given scope — falls back to
 *  label unless a countryLabel override exists (see
 *  CriterionDef.countryLabel, e.g. "City land area" -> "Country land
 *  area"). */
export function labelForScope(def: CriterionDef, scope: AdvancedSearchScope): string {
  return scope === "country" && def.countryLabel ? def.countryLabel : def.label;
}

/** Does this resolved value satisfy the given filter, interpreted under
 *  `kind`? A null/unknown value never satisfies an active numeric filter —
 *  "we couldn't find one nearby" shouldn't count as meeting a "must be
 *  within X minutes" constraint. */
export function matchesFilter(value: CriterionValue, filter: AdvancedSearchCriterionFilter, kind: CriterionKind): boolean {
  if (kind === "range") {
    if (typeof value !== "number" || Number.isNaN(value)) return false;
    if (filter.min != null && value < filter.min) return false;
    if (filter.max != null && value > filter.max) return false;
    return true;
  }
  if (kind === "boolean") {
    if (filter.bool == null) return true;
    return Boolean(value) === filter.bool;
  }
  // select
  if (!filter.select) return true;
  return value === filter.select;
}

/** Rolls up a set of per-city values for one criterion into a single
 *  country-level value. Numeric fields average; booleans OR; the one
 *  select field (safety trend) takes the most common value. Nearby
 *  fields are numeric at city scope but boolean at country scope — for
 *  those, "Yes" means at least one tracked city actually found one
 *  (regardless of how far), not an average distance that wouldn't mean
 *  much at country level anyway. */
export function aggregateForCountry(values: CriterionValue[], cityKind: CriterionKind, countryKind: CriterionKind): CriterionValue {
  if (countryKind === "boolean") {
    if (cityKind === "boolean") return values.some((v) => v === true);
    return values.some((v) => typeof v === "number" && !Number.isNaN(v));
  }
  if (countryKind === "select") {
    const counts = new Map<string, number>();
    for (const v of values) if (typeof v === "string") counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: string | null = null;
    let bestCount = 0;
    for (const [k, c] of counts) {
      if (c > bestCount) {
        best = k;
        bestCount = c;
      }
    }
    return best;
  }
  const nums = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
}

/** Human-readable rendering of a resolved criterion value, for result cards
 *  and matched-filter chips — e.g. "£48,200", "18 min", "23% of city area",
 *  "Yes". Centralised here so the UI never has to guess a field's unit
 *  formatting itself. */
export function formatCriterionValue(def: CriterionDef, value: CriterionValue): string {
  if (value == null) return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  const rounded = Math.round(value * 10) / 10;
  const num = rounded.toLocaleString();
  const unit = def.unit;
  if (!unit) return num;
  if (unit === "£") return `£${num}`;
  if (unit.startsWith("%")) return `${num}${unit}`;
  return `${num} ${unit}`;
}
