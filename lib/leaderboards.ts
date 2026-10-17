import type { PlaceTable } from "@/lib/advancedSearch/engine";
import { hasEnoughFigures } from "@/lib/dataset/assemble";
import { manifest } from "@/lib/dataset/files";
import { regionOf, type RegionKey } from "@/lib/regions";
import { formatTemperature, type UnitPreferences } from "@/lib/unitPreferences";
import type { CriterionValue, SectionScores } from "@/lib/types";

/**
 * Leaderboards (/leaderboards): ten rankings of every place, worked out in
 * the browser from the Advanced search files (section scores plus a few
 * criterion columns) - so they always match the data the site shows.
 */

export type BoardKey =
  | "overall"
  | "safest"
  | "qualityOfLife"
  | "economy"
  | "eternalSpring"
  | "sunniest"
  | "cleanAir"
  | "fastInternet"
  | "beachLife"
  | "familyFriendly";

export type SizeKey = "under10k" | "10to50k" | "50to100k" | "100to500k" | "over500k" | "all";

/** Smallest to biggest, then everyone - ranges that don't overlap
 *  (2026-10-16, on request: "10k+" wasn't clear). */
export const SIZE_ORDER: SizeKey[] = ["under10k", "10to50k", "50to100k", "100to500k", "over500k", "all"];

export const SIZE_LABELS: Record<SizeKey, string> = {
  under10k: "Population under 10k",
  "10to50k": "Population 10k to 50k",
  "50to100k": "Population 50k to 100k",
  "100to500k": "Population 100k to 500k",
  over500k: "Population over 500k",
  all: "All populations",
};

/** Each range's bounds in thousands (population is in thousands, as in the
 *  Advanced search column): at least the first, under the second. */
const SIZE_RANGE: Record<SizeKey, [number, number]> = {
  under10k: [0, 10],
  "10to50k": [10, 50],
  "50to100k": [50, 100],
  "100to500k": [100, 500],
  over500k: [500, Infinity],
  all: [0, Infinity],
};

const inSize = (size: SizeKey, populationK: number) => populationK >= SIZE_RANGE[size][0] && populationK < SIZE_RANGE[size][1];

interface BoardContext {
  table: PlaceTable;
  weights: SectionScores;
  col: (key: string) => (i: number) => CriterionValue;
}

export interface BoardDef {
  key: BoardKey;
  title: string;
  /** How it's ranked, in a line. */
  blurb: string;
  /** Criterion columns it reads (beyond section scores). */
  needs: string[];
  /** Higher is better; null = not on this board. */
  score: (ctx: BoardContext, i: number) => number | null;
  /** The figure shown beside each place. */
  show: (ctx: BoardContext, i: number, prefs: UnitPreferences) => string;
}

const num = (v: CriterionValue) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (n: number) => String(Math.round(n));

/** The figures behind the Economy and Safety scores (country-wide). Those
 *  boards skip places without enough of them (hasEnoughFigures, the rule
 *  the section scores follow) - so they hold before a dataset built with
 *  that rule, too: North Korea's economy, from unemployment alone, scored
 *  86 until then. */
const ECONOMY_INPUTS = [
  "economy.economicGrowth5yrGdpPct",
  "economy.unemploymentRatePct",
  "economy.averageSalaryGbp",
  "economy.costOfLivingIndex",
  "economy.purchasingPowerIndex",
];
const SAFETY_INPUTS = ["safetyStability.politicalStabilityScore", "safetyStability.ruleOfLawScore", "safetyStability.homicideRatePer100k"];
const enough = (col: BoardContext["col"], i: number, keys: string[]) => hasEnoughFigures(keys.map((key) => num(col(key)(i))));

export const BOARDS: BoardDef[] = [
  {
    key: "overall",
    title: "Best overall",
    blurb: "The Piltri score, with your score settings",
    needs: [],
    score: ({ table, weights }, i) => table.piltri(i, weights),
    show: ({ table, weights }, i) => round(table.piltri(i, weights)),
  },
  {
    key: "safest",
    title: "Safest",
    blurb: "Safety score: stability, rule of law, crime",
    needs: SAFETY_INPUTS,
    score: ({ table, col }, i) => (enough(col, i, SAFETY_INPUTS) ? table.sections(i).safetyStability : null),
    show: ({ table }, i) => round(table.sections(i).safetyStability),
  },
  {
    key: "qualityOfLife",
    title: "Best quality of life",
    blurb: "Quality of Life score: amenities, transport, health, internet",
    needs: [],
    score: ({ table }, i) => table.sections(i).liveability,
    show: ({ table }, i) => round(table.sections(i).liveability),
  },
  {
    key: "economy",
    title: "Strongest economy",
    blurb: "Economy score: growth, salaries, jobs, purchasing power",
    needs: ECONOMY_INPUTS,
    score: ({ table, col }, i) => (enough(col, i, ECONOMY_INPUTS) ? table.sections(i).economy : null),
    show: ({ table }, i) => round(table.sections(i).economy),
  },
  {
    key: "eternalSpring",
    title: "Eternal spring",
    blurb: "Mild all year: around 20°C, summer highs under 27°C, winter nights above 12°C",
    needs: ["climate.avgAnnualTemperatureC", "climate.hottestMonthHighC", "climate.coldestMonthLowC"],
    score: ({ col }, i) => {
      const avg = num(col("climate.avgAnnualTemperatureC")(i));
      const hi = num(col("climate.hottestMonthHighC")(i));
      const lo = num(col("climate.coldestMonthLowC")(i));
      if (avg == null || hi == null || lo == null) return null;
      return 100 - (2 * Math.abs(avg - 20) + 1.5 * Math.max(0, hi - 27) + 1.5 * Math.max(0, 12 - lo));
    },
    show: ({ col }, i, prefs) => {
      const lo = num(col("climate.coldestMonthLowC")(i)) ?? 0;
      const hi = num(col("climate.hottestMonthHighC")(i)) ?? 0;
      return `${formatTemperature(lo, prefs)} to ${formatTemperature(hi, prefs)}`;
    },
  },
  {
    key: "sunniest",
    title: "Sunniest",
    blurb: "Hours of sunshine a year (estimated)",
    needs: ["climate.avgAnnualSunshineHrs"],
    score: ({ col }, i) => num(col("climate.avgAnnualSunshineHrs")(i)),
    show: ({ col }, i) => `${Math.round(num(col("climate.avgAnnualSunshineHrs")(i)) ?? 0).toLocaleString("en-GB")} h`,
  },
  {
    key: "cleanAir",
    title: "Cleanest air",
    blurb: "Lowest fine-particle pollution (PM2.5)",
    needs: ["climate.avgAnnualPm25"],
    score: ({ col }, i) => {
      const pm = num(col("climate.avgAnnualPm25")(i));
      return pm == null ? null : -pm;
    },
    show: ({ col }, i) => `${(num(col("climate.avgAnnualPm25")(i)) ?? 0).toFixed(1)} µg/m³`,
  },
  {
    key: "fastInternet",
    title: "Fastest internet",
    blurb: "Average home broadband download speed",
    needs: ["liveability.broadbandDownloadMbps"],
    score: ({ col }, i) => num(col("liveability.broadbandDownloadMbps")(i)),
    show: ({ col }, i) => `${Math.round(num(col("liveability.broadbandDownloadMbps")(i)) ?? 0)} Mbps`,
  },
  {
    key: "beachLife",
    title: "Beach life",
    blurb: "A beach within 2 km and 2,000+ hours of sun, by Piltri score",
    needs: ["liveability.distanceToBeachKm", "climate.avgAnnualSunshineHrs"],
    score: ({ table, weights, col }, i) => {
      const beach = num(col("liveability.distanceToBeachKm")(i));
      const sun = num(col("climate.avgAnnualSunshineHrs")(i));
      return beach != null && beach <= 2 && sun != null && sun >= 2000 ? table.piltri(i, weights) : null;
    },
    show: ({ table, weights }, i) => round(table.piltri(i, weights)),
  },
  {
    key: "familyFriendly",
    title: "Family-friendly",
    blurb: "School and nursery nearby; safety, quality of life, parks and family activities",
    needs: ["liveability.hasSchool", "liveability.hasNursery", "liveability.parksPer10k", "liveability.familyActivitiesPer10k"],
    score: ({ table, col }, i) => {
      if (col("liveability.hasSchool")(i) !== true || col("liveability.hasNursery")(i) !== true) return null;
      const { safetyStability, liveability } = table.sections(i);
      const parks = num(col("liveability.parksPer10k")(i)) ?? 0;
      const family = num(col("liveability.familyActivitiesPer10k")(i)) ?? 0;
      return 0.4 * safetyStability + 0.4 * liveability + 0.2 * Math.min(100, parks * 8 + family * 15);
    },
    show: (ctx, i) => round(BOARDS.find((b) => b.key === "familyFriendly")!.score(ctx, i) ?? 0),
  },
];

/** Every column the boards read, plus population for the size filter. */
export const LEADERBOARD_COLUMNS = [...new Set(["demographics.population", ...BOARDS.flatMap((b) => b.needs)])];

export interface Filters {
  region: RegionKey | "world";
  size: SizeKey;
  /** At most this many places per country (null: no limit) - so a board
   *  isn't one country's towns all tied on a country-level score. */
  perCountry: number | null;
}

export interface Entry {
  rank: number;
  /** The place's position in the PlaceTable. */
  index: number;
  id: string;
  name: string;
  region: string | null;
  country: string;
  countryCode: string;
  shown: string;
}

/** Places closer than this to one already listed are left out: one entry
 *  per metro area, not Singapore and four of its estates. */
const METRO_KM = 20;

function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const x = (bLng - aLng) * rad * Math.cos(((aLat + bLat) / 2) * rad);
  const y = (bLat - aLat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/** A board's top `limit` places under `filters`: one per metro area, at
 *  most `perCountry` per country. Ties go to the bigger place (more
 *  recognisable). */
export function rankBoard(def: BoardDef, ctx: BoardContext, filters: Filters, prefs: UnitPreferences, limit = 10): Entry[] {
  const { table } = ctx;
  const population = ctx.col("demographics.population");
  const candidates: { i: number; score: number; pop: number }[] = [];
  for (let i = 0; i < table.count; i++) {
    if (filters.region !== "world" && regionOf(table.cc[i]) !== filters.region) continue;
    const pop = num(population(i)) ?? 0;
    if (!inSize(filters.size, pop)) continue;
    const score = def.score(ctx, i);
    if (score == null || !Number.isFinite(score)) continue;
    candidates.push({ i, score, pop });
  }
  candidates.sort((a, b) => b.score - a.score || b.pop - a.pop);
  const perCountry = new Map<string, number>();
  const out: Entry[] = [];
  const listed: number[] = [];
  for (const { i } of candidates) {
    const cc = table.cc[i];
    const n = perCountry.get(cc) ?? 0;
    if (filters.perCountry != null && n >= filters.perCountry) continue;
    if (listed.some((j) => km(table.lat[i], table.lng[i], table.lat[j], table.lng[j]) < METRO_KM)) continue;
    perCountry.set(cc, n + 1);
    listed.push(i);
    out.push({
      rank: out.length + 1,
      index: i,
      id: table.id(i),
      name: table.name[i],
      region: table.region[i],
      country: manifest.countryNames[cc] ?? cc,
      countryCode: cc,
      shown: def.show(ctx, i, prefs),
    });
    if (out.length >= limit) break;
  }
  return out;
}
