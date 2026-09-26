import { kmToMinutes } from "@/lib/dataset/assemble";
import type { AdvancedSearchCriterionFilter, AdvancedSearchScope, CityExploreData, CriterionValue, SectionKey } from "@/lib/types";

/**
 * Advanced search's criteria registry - the single source of truth for
 * every filter /explore/discover offers. Each entry knows its label/unit
 * and how to read its value off a city's CityExploreData (the same object
 * the city page renders). The offline pipeline evaluates every criterion
 * for every city with these same getters (pipeline/output.ts), so the
 * filters, the published columns and the city pages can't drift apart.
 */

export type CriterionKind = "range" | "boolean" | "select";

export type CategoryKey = "overall" | "economy" | "safetyStability" | "climate" | "liveability" | "demographics" | "nearby";

export const CATEGORY_ORDER: CategoryKey[] = ["overall", "economy", "safetyStability", "climate", "liveability", "demographics", "nearby"];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  overall: "Overall",
  economy: "Economy",
  safetyStability: "Safety",
  climate: "Environment",
  liveability: "Quality of Life",
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
  /** Filter input type at country scope, if different ("distance from city
   *  centre" criteria become "found in at least one city"). */
  countryKind?: CriterionKind;
  selectOptions?: string[];
  /** Placeholder bounds only - not enforced. */
  suggestedRange?: [number, number];
  countrySuggestedRange?: [number, number];
  countryLabel?: string;
  /** Derived from section scores ("piltri" honours the search's weights) -
   *  computed on the fly rather than stored as a column. */
  fromScores?: "piltri" | SectionKey;
  getCityValue: (data: CityExploreData) => CriterionValue;
}

function minutesFrom(key: string, label: string, pick: (d: CityExploreData) => number | null): CriterionDef {
  return {
    key,
    category: "nearby",
    label,
    unit: "min",
    kind: "range",
    countryKind: "boolean",
    suggestedRange: [0, 500],
    getCityValue: (d) => kmToMinutes(pick(d)),
  };
}

function sectionScore(section: SectionKey, category: CategoryKey, label: string): CriterionDef {
  return {
    key: `${section}.sectionScore`,
    category,
    label,
    kind: "range",
    suggestedRange: [0, 100],
    fromScores: section,
    getCityValue: (d) => d.sectionScores[section],
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
    fromScores: "piltri",
    getCityValue: (d) => d.piltriScore,
  },

  // ---- Economy ------------------------------------------------------------
  sectionScore("economy", "economy", "Economy score"),
  {
    key: "economy.economicGrowth5yrGdpPct",
    category: "economy",
    label: "5yr GDP growth",
    unit: "%",
    kind: "range",
    suggestedRange: [-10, 40],
    getCityValue: (d) => d.economy.economicGrowth5yrGdpPct,
  },
  {
    // Monthly, in thousands of GBP (annual averageSalaryGbp / 12 / 1000).
    key: "economy.averageSalaryGbp",
    category: "economy",
    label: "Average salary per month (K)",
    unit: "K",
    kind: "range",
    suggestedRange: [0, 10],
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
  {
    key: "economy.gdpUsd",
    category: "economy",
    label: "GDP (billions)",
    unit: "B",
    kind: "range",
    suggestedRange: [0, 30000],
    getCityValue: (d) => (d.economy.gdpUsd != null ? Math.round(d.economy.gdpUsd / 1e9) : null),
  },
  {
    key: "economy.gdpWorldRank",
    category: "economy",
    label: "GDP world rank",
    kind: "range",
    suggestedRange: [1, 214],
    getCityValue: (d) => d.economy.gdpWorldRank,
  },
  {
    key: "economy.taxRevenuePctGdp",
    category: "economy",
    label: "Tax revenue (% of GDP)",
    unit: "%",
    kind: "range",
    suggestedRange: [0, 50],
    getCityValue: (d) => d.economy.taxRevenuePctGdp,
  },

  // ---- Safety ---------------------------------------------------------------
  sectionScore("safetyStability", "safetyStability", "Safety score"),
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
    key: "safetyStability.homicideRatePer100k",
    category: "safetyStability",
    label: "Homicide rate (per 100k)",
    kind: "range",
    suggestedRange: [0, 30],
    getCityValue: (d) => d.safetyStability.homicideRatePer100k,
  },
  {
    key: "safetyStability.safetyTrend",
    category: "safetyStability",
    label: "Safety trend",
    kind: "select",
    selectOptions: ["Improving", "Stable", "Worsening"],
    getCityValue: (d) => d.safetyStability.safetyTrend,
  },

  // ---- Environment ----------------------------------------------------------
  sectionScore("climate", "climate", "Environment score"),
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
    key: "climate.hottestMonthHighC",
    category: "climate",
    label: "Summer high (hottest month)",
    unit: "°C",
    kind: "range",
    suggestedRange: [10, 45],
    getCityValue: (d) => d.climate.hottestMonthHighC,
  },
  {
    key: "climate.coldestMonthLowC",
    category: "climate",
    label: "Winter low (coldest month)",
    unit: "°C",
    kind: "range",
    suggestedRange: [-30, 25],
    getCityValue: (d) => d.climate.coldestMonthLowC,
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
    suggestedRange: [1000, 4000],
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
  // Climate type (Köppen) isn't a filter: ~30 codes is too many for a clean
  // dropdown, and it's descriptive rather than a natural filter dimension.
  {
    key: "climate.avgAnnualHumidityPct",
    category: "climate",
    label: "Avg. annual humidity",
    unit: "%",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.climate.avgAnnualHumidityPct,
  },
  {
    key: "climate.avgAnnualPm25",
    category: "climate",
    label: "Air pollution (PM2.5)",
    unit: "µg/m³",
    kind: "range",
    suggestedRange: [0, 50],
    getCityValue: (d) => d.climate.avgAnnualPm25,
  },
  {
    key: "climate.avgAnnualUvIndexMax",
    category: "climate",
    label: "Avg. UV index",
    kind: "range",
    suggestedRange: [0, 12],
    getCityValue: (d) => d.climate.avgAnnualUvIndexMax,
  },
  {
    key: "climate.elevationM",
    category: "climate",
    label: "Elevation",
    unit: "m",
    kind: "range",
    suggestedRange: [0, 4000],
    getCityValue: (d) => d.climate.elevationM,
  },
  {
    key: "climate.earthquakeCount50yr",
    category: "climate",
    label: "Seismic activity (M5+ quakes since 1970)",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.climate.earthquakeCount50yr,
  },
  {
    key: "climate.distanceToVolcanoKm",
    category: "climate",
    label: "Distance to volcano",
    unit: "km",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.climate.distanceToVolcanoKm,
  },
  {
    key: "climate.coastalFloodExposure",
    category: "climate",
    label: "Coastal flood exposure",
    kind: "select",
    selectOptions: ["Low", "Moderate", "High"],
    getCityValue: (d) => d.climate.coastalFloodExposure,
  },
  {
    key: "climate.seaLevelRiseExposure",
    category: "climate",
    label: "Sea level rise exposure",
    kind: "select",
    selectOptions: ["Low", "Moderate", "High"],
    getCityValue: (d) => d.climate.seaLevelRiseExposure,
  },
  {
    key: "climate.climateReadinessScore",
    category: "climate",
    label: "Climate change readiness (ND-GAIN)",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.climate.climateReadinessScore,
  },
  {
    key: "climate.longestDayHours",
    category: "climate",
    label: "Longest day",
    unit: "hrs",
    kind: "range",
    suggestedRange: [12, 24],
    getCityValue: (d) => d.climate.longestDayHours,
  },
  {
    key: "climate.shortestDayHours",
    category: "climate",
    label: "Shortest day",
    unit: "hrs",
    kind: "range",
    suggestedRange: [0, 12],
    getCityValue: (d) => d.climate.shortestDayHours,
  },

  // ---- Quality of Life --------------------------------------------------------
  sectionScore("liveability", "liveability", "Quality of Life score"),
  {
    key: "liveability.restaurantsBarsWithin5km",
    category: "liveability",
    label: "Restaurants, bars & cafés (within 5 km)",
    kind: "range",
    suggestedRange: [0, 3000],
    getCityValue: (d) => d.liveability.restaurantsBarsWithin5km,
  },
  {
    key: "liveability.parksWithin5km",
    category: "liveability",
    label: "Parks (within 5 km)",
    kind: "range",
    suggestedRange: [0, 150],
    getCityValue: (d) => d.liveability.parksWithin5km,
  },
  {
    key: "liveability.culturalVenuesWithin5km",
    category: "liveability",
    label: "Cultural venues (within 5 km)",
    kind: "range",
    suggestedRange: [0, 200],
    getCityValue: (d) => d.liveability.culturalVenuesWithin5km,
  },
  {
    key: "liveability.familyActivitiesWithin5km",
    category: "liveability",
    label: "Family activities (within 5 km)",
    kind: "range",
    suggestedRange: [0, 30],
    getCityValue: (d) => d.liveability.familyActivitiesWithin5km,
  },
  {
    key: "liveability.broadbandDownloadMbps",
    category: "liveability",
    label: "Broadband speed (download)",
    unit: "Mbps",
    kind: "range",
    suggestedRange: [0, 500],
    getCityValue: (d) => d.liveability.broadbandDownloadMbps,
  },
  {
    key: "liveability.mobileDownloadMbps",
    category: "liveability",
    label: "Mobile speed (download)",
    unit: "Mbps",
    kind: "range",
    suggestedRange: [0, 300],
    getCityValue: (d) => d.liveability.mobileDownloadMbps,
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
    key: "liveability.lifeExpectancyYears",
    category: "liveability",
    label: "Life expectancy",
    unit: "yrs",
    kind: "range",
    suggestedRange: [50, 85],
    getCityValue: (d) => d.liveability.lifeExpectancyYears,
  },
  {
    key: "liveability.internetUsersPct",
    category: "liveability",
    label: "Internet access",
    unit: "%",
    kind: "range",
    suggestedRange: [0, 100],
    getCityValue: (d) => d.liveability.internetUsersPct,
  },
  {
    key: "liveability.pisaMathScore",
    category: "liveability",
    label: "PISA maths score",
    kind: "range",
    suggestedRange: [350, 590],
    getCityValue: (d) => d.liveability.pisaMathScore,
  },
  {
    key: "liveability.pisaReadingScore",
    category: "liveability",
    label: "PISA reading score",
    kind: "range",
    suggestedRange: [350, 590],
    getCityValue: (d) => d.liveability.pisaReadingScore,
  },
  {
    key: "liveability.pisaScienceScore",
    category: "liveability",
    label: "PISA science score",
    kind: "range",
    suggestedRange: [350, 590],
    getCityValue: (d) => d.liveability.pisaScienceScore,
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
    label: "Has metro",
    kind: "boolean",
    getCityValue: (d) => d.liveability.hasSubway,
  },
  {
    key: "liveability.hasTramway",
    category: "liveability",
    label: "Has tram / light rail",
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
  {
    key: "liveability.hasBusStation",
    category: "liveability",
    label: "Has bus station",
    kind: "boolean",
    getCityValue: (d) => d.liveability.hasBusStation,
  },
  {
    key: "liveability.hasSchool",
    category: "liveability",
    label: "Has school",
    kind: "boolean",
    getCityValue: (d) => d.liveability.hasSchool,
  },
  {
    key: "liveability.hasUniversity",
    category: "liveability",
    label: "Has university",
    kind: "boolean",
    getCityValue: (d) => d.liveability.hasUniversity,
  },
  {
    key: "liveability.distanceToBeachKm",
    category: "liveability",
    label: "Distance to beach",
    unit: "km",
    kind: "range",
    suggestedRange: [0, 400],
    getCityValue: (d) => d.liveability.distanceToBeachKm,
  },
  {
    key: "liveability.distanceToMountainKm",
    category: "liveability",
    label: "Distance to mountain",
    unit: "km",
    kind: "range",
    suggestedRange: [0, 300],
    getCityValue: (d) => d.liveability.distanceToMountainKm,
  },
  {
    key: "liveability.distanceToForestKm",
    category: "liveability",
    label: "Distance to forest",
    unit: "km",
    kind: "range",
    suggestedRange: [0, 200],
    getCityValue: (d) => d.liveability.distanceToForestKm,
  },
  {
    key: "liveability.distanceToCapitalKm",
    category: "liveability",
    label: "Distance to capital city",
    unit: "km",
    kind: "range",
    suggestedRange: [0, 1000],
    getCityValue: (d) => d.liveability.distanceToCapitalKm,
  },
  {
    key: "liveability.nearestLargeCityKm",
    category: "liveability",
    label: "Distance to a large city (500k+)",
    unit: "km",
    kind: "range",
    suggestedRange: [0, 200],
    // A large city itself counts as 0 km from one.
    getCityValue: (d) => (d.liveability.nearestLargeCity ? d.liveability.nearestLargeCity.km : (d.demographics.cityPopulation ?? 0) >= 500000 ? 0 : null),
  },

  // ---- Demographics (not scored) -------------------------------------------
  {
    // In thousands (K).
    key: "demographics.population",
    category: "demographics",
    label: "Population",
    unit: "K",
    kind: "range",
    suggestedRange: [1, 5000],
    countrySuggestedRange: [1, 150000],
    getCityValue: (d) => (d.demographics.cityPopulation != null ? Math.round(d.demographics.cityPopulation / 1000) : null),
  },
  {
    key: "demographics.populationDensityPerKm2",
    category: "demographics",
    label: "Population density (within 5 km)",
    unit: "per km²",
    kind: "range",
    suggestedRange: [0, 20000],
    getCityValue: (d) => d.demographics.cityDensityPerKm2,
  },
  {
    key: "demographics.populationTrend5yrPct",
    category: "demographics",
    label: "5yr population trend",
    unit: "%",
    kind: "range",
    suggestedRange: [-25, 25],
    getCityValue: (d) => d.demographics.countryPopulationTrend5yrPct,
  },
  {
    key: "demographics.averageAge",
    category: "demographics",
    label: "Average age",
    unit: "yrs",
    kind: "range",
    suggestedRange: [20, 60],
    getCityValue: (d) => d.demographics.countryAverageAge,
  },

  // ---- Distance from city centre (the same estimate as pin mode) ----------
  minutesFrom("nearby.beach", "Beach", (d) => d.liveability.distanceToBeachKm),
  minutesFrom("nearby.mountain", "Mountain", (d) => d.liveability.distanceToMountainKm),
  minutesFrom("nearby.trainStation", "Train station", (d) => d.liveability.distanceToTrainStationKm),
  minutesFrom("nearby.airport", "Airport", (d) => d.liveability.distanceToAirportKm),
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

export function kindForScope(def: CriterionDef, scope: AdvancedSearchScope): CriterionKind {
  return scope === "country" && def.countryKind ? def.countryKind : def.kind;
}

export function rangeForScope(def: CriterionDef, scope: AdvancedSearchScope): [number, number] | undefined {
  return scope === "country" && def.countrySuggestedRange ? def.countrySuggestedRange : def.suggestedRange;
}

export function labelForScope(def: CriterionDef, scope: AdvancedSearchScope): string {
  return scope === "country" && def.countryLabel ? def.countryLabel : def.label;
}

/** Does this value satisfy the filter? An unknown (null) value never
 *  satisfies an active numeric filter. */
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
  if (!filter.select) return true;
  return value === filter.select;
}

/** Rolls per-city values up to one country value: numbers average,
 *  booleans OR, selects take the most common value. "Distance from city
 *  centre" criteria are numeric per city but Yes/No per country ("found
 *  one near at least one tracked city"). */
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

/** Human-readable value for result cards and matched-filter chips. */
export function formatCriterionValue(def: CriterionDef, value: CriterionValue): string {
  if (value == null) return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  const rounded = Math.round(value * 10) / 10;
  const num = rounded.toLocaleString();
  const unit = def.unit;
  if (!unit) return num;
  if (unit.startsWith("%")) return `${num}${unit}`;
  return `${num} ${unit}`;
}
