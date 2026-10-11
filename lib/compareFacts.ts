import { formatCurrency, formatDistanceKm, formatTemperature, type UnitPreferences } from "@/lib/unitPreferences";
import type { CityExploreData } from "@/lib/types";

/**
 * "Biggest differences" on the Compare page: a short list of the figures
 * where the places differ most, in words ("Bangkok is warmer"). Each fact
 * knows what counts as a real gap (`unit`), so a 3°C and a 400-hour gap
 * rank alike, and small gaps aren't listed at all.
 */
export interface DiffFact {
  key: string;
  label: string;
  get: (d: CityExploreData) => number | null;
  show: (v: number, prefs: UnitPreferences) => string;
  /** Said of the place with the higher value: [between two, among more]. */
  up: [string, string];
  /** Said of the place with the lower value. */
  down: [string, string];
  /** Which one to lead with: the place that's better off ("cleaner air")
   *  reads more naturally than "more polluted", where there's a better. */
  lead: "up" | "down";
  /** One "unit" of difference: plain gap, or (ratio) a ratio between the
   *  values - log(ratio) / log(unit). */
  unit: number;
  ratio?: boolean;
  /** Added to both values before a ratio (distances: 1 km vs 3 km isn't 3×). */
  offset?: number;
}

const n0 = (v: number) => Math.round(v).toLocaleString("en-GB");
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-GB");

export const DIFF_FACTS: DiffFact[] = [
  {
    key: "temp",
    label: "Average temperature",
    get: (d) => d.climate.avgAnnualTemperatureC,
    show: (v, p) => formatTemperature(v, p),
    up: ["is warmer", "is the warmest"],
    down: ["is cooler", "is the coolest"],
    lead: "up",
    unit: 3,
  },
  {
    key: "summer",
    label: "Summer highs",
    get: (d) => d.climate.hottestMonthHighC,
    show: (v, p) => formatTemperature(v, p),
    up: ["has hotter summers", "has the hottest summers"],
    down: ["has milder summers", "has the mildest summers"],
    lead: "down",
    unit: 3,
  },
  {
    key: "winter",
    label: "Winter nights",
    get: (d) => d.climate.coldestMonthLowC,
    show: (v, p) => formatTemperature(v, p),
    up: ["has milder winters", "has the mildest winters"],
    down: ["has colder winters", "has the coldest winters"],
    lead: "up",
    unit: 3,
  },
  {
    key: "sun",
    label: "Sunshine",
    get: (d) => d.climate.avgAnnualSunshineHrs,
    show: (v) => `${n0(v)} h a year`,
    up: ["is sunnier", "is the sunniest"],
    down: ["is less sunny", "is the least sunny"],
    lead: "up",
    unit: 400,
  },
  {
    key: "rain",
    label: "Rainfall",
    get: (d) => d.climate.avgAnnualRainfallMm,
    show: (v, p) => (p.distance === "imperial" ? `${n0(v / 25.4)} in a year` : `${n0(v)} mm a year`),
    up: ["is wetter", "is the wettest"],
    down: ["is drier", "is the driest"],
    lead: "down",
    unit: 1.5,
    ratio: true,
    offset: 100,
  },
  {
    key: "snow",
    label: "Snowfall",
    get: (d) => d.climate.avgAnnualSnowfallCm,
    show: (v, p) => (p.distance === "imperial" ? `${n0(v / 2.54)} in a year` : `${n0(v)} cm a year`),
    up: ["gets more snow", "gets the most snow"],
    down: ["gets less snow", "gets the least snow"],
    lead: "up",
    unit: 25,
  },
  {
    key: "air",
    label: "Air pollution (PM2.5)",
    get: (d) => d.climate.avgAnnualPm25,
    show: (v) => `${n1(v)} µg/m³`,
    up: ["has more polluted air", "has the most polluted air"],
    down: ["has cleaner air", "has the cleanest air"],
    lead: "down",
    unit: 1.6,
    ratio: true,
    offset: 2,
  },
  {
    key: "population",
    label: "Population",
    get: (d) => d.demographics.cityPopulation,
    show: (v) => `${n0(v)} people`,
    up: ["is bigger", "is the biggest"],
    down: ["is smaller", "is the smallest"],
    lead: "up",
    unit: 2.5,
    ratio: true,
  },
  {
    key: "cost",
    label: "Cost of living",
    get: (d) => d.economy.costOfLivingIndex,
    show: (v) => `index ${n0(v)}`,
    up: ["is more expensive", "is the most expensive"],
    down: ["is cheaper", "is the cheapest"],
    lead: "down",
    unit: 10,
  },
  {
    key: "salary",
    label: "Average salary",
    get: (d) => d.economy.averageSalaryGbp,
    show: (v, p) => `${formatCurrency(v, p)} a year`,
    up: ["pays more", "pays the most"],
    down: ["pays less", "pays the least"],
    lead: "up",
    unit: 1.5,
    ratio: true,
  },
  {
    key: "jobs",
    label: "Unemployment",
    get: (d) => d.economy.unemploymentRatePct,
    show: (v) => `${n1(v)}%`,
    up: ["has more unemployment", "has the most unemployment"],
    down: ["has less unemployment", "has the least unemployment"],
    lead: "down",
    unit: 3,
  },
  {
    key: "crime",
    label: "Homicide rate",
    get: (d) => d.safetyStability.homicideRatePer100k,
    show: (v) => `${n1(v)} per 100k`,
    up: ["has more violent crime", "has the most violent crime"],
    down: ["has less violent crime", "has the least violent crime"],
    lead: "down",
    unit: 2,
    ratio: true,
    offset: 0.5,
  },
  {
    key: "health",
    label: "Healthcare quality",
    get: (d) => d.liveability.healthcareQualityScore,
    show: (v) => `${n0(v)} / 100`,
    up: ["has better healthcare", "has the best healthcare"],
    down: ["has weaker healthcare", "has the weakest healthcare"],
    lead: "up",
    unit: 8,
  },
  {
    key: "internet",
    label: "Broadband speed",
    get: (d) => d.liveability.broadbandDownloadMbps,
    show: (v) => `${n0(v)} Mbps`,
    up: ["has faster internet", "has the fastest internet"],
    down: ["has slower internet", "has the slowest internet"],
    lead: "up",
    unit: 1.8,
    ratio: true,
    offset: 5,
  },
  {
    key: "beach",
    label: "Nearest beach",
    get: (d) => d.liveability.distanceToBeachKm,
    show: (v, p) => formatDistanceKm(v, p),
    up: ["is further from a beach", "is the furthest from a beach"],
    down: ["is closer to a beach", "is the closest to a beach"],
    lead: "down",
    unit: 3,
    ratio: true,
    offset: 3,
  },
  {
    key: "mountain",
    label: "Nearest mountains",
    get: (d) => d.liveability.distanceToMountainKm,
    show: (v, p) => formatDistanceKm(v, p),
    up: ["is further from mountains", "is the furthest from mountains"],
    down: ["is closer to mountains", "is the closest to mountains"],
    lead: "down",
    unit: 3,
    ratio: true,
    offset: 5,
  },
  {
    key: "going-out",
    label: "Restaurants & bars",
    get: (d) => d.liveability.restaurantsBarsPer1k,
    show: (v) => `${n1(v)} per 1,000 residents`,
    up: ["has more restaurants & bars", "has the most restaurants & bars"],
    down: ["has fewer restaurants & bars", "has the fewest restaurants & bars"],
    lead: "up",
    unit: 1.8,
    ratio: true,
    offset: 0.3,
  },
];

export interface Difference {
  fact: DiffFact;
  /** How big the gap is, in units (1 = just worth mentioning). */
  size: number;
  /** Place index with the highest / lowest value, and the values. */
  high: { index: number; value: number };
  low: { index: number; value: number };
}

/** The facts where the places differ by at least one unit, biggest first. */
export function biggestDifferences(places: CityExploreData[], limit = 6): Difference[] {
  if (places.length < 2) return [];
  const out: Difference[] = [];
  for (const fact of DIFF_FACTS) {
    const values = places.map((d, index) => ({ index, value: fact.get(d) })).filter((v): v is { index: number; value: number } => v.value != null && Number.isFinite(v.value));
    if (values.length < 2) continue;
    const high = values.reduce((a, b) => (b.value > a.value ? b : a));
    const low = values.reduce((a, b) => (b.value < a.value ? b : a));
    const offset = fact.offset ?? 0;
    const size = fact.ratio
      ? high.value + offset > 0 && low.value + offset > 0
        ? Math.log((high.value + offset) / (low.value + offset)) / Math.log(fact.unit)
        : 0
      : (high.value - low.value) / fact.unit;
    if (size >= 1) out.push({ fact, size, high, low });
  }
  return out.sort((a, b) => b.size - a.size).slice(0, limit);
}
