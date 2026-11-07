import type { PlaceTable } from "@/lib/advancedSearch/engine";
import { BEACH_KM, ETERNAL_SPRING, MOUNTAINS_KM, SIZE_BANDS, SUNNY_HOURS, type SizeBand } from "@/lib/advancedSearch/thresholds";
import { hasEnoughFigures } from "@/lib/dataset/assemble";
import { regionOf, REGION_ORDER, type RegionKey } from "@/lib/regions";
import { formatTemperature, type UnitPreferences } from "@/lib/unitPreferences";
import type { CriterionValue, SectionScores } from "@/lib/types";

/**
 * Leaderboards (/leaderboards): twelve rankings of every place, from the
 * Advanced search files (section scores plus a few criterion columns) - so
 * they always match the data the site shows. Its sizes, and its boards'
 * rules, are Advanced search's own (2026-11-06, owner: "align"): the four
 * sections, and a filter for each themed board.
 *
 * At the default score settings the page reads them worked out ahead of
 * time by the pipeline, a small file per region (precomputeLeaderboards;
 * 2026-11-07, owner: the page took 2-3 s - it downloaded every place's
 * figures). With custom settings the browser works them out with the same
 * functions. No import here reads the site's dataset manifest, so the
 * pipeline can run them.
 */

export type BoardKey =
  | "overall"
  | "safest"
  | "economy"
  | "environment"
  | "qualityOfLife"
  | "eternalSpring"
  | "sunniest"
  | "cleanAir"
  | "fastInternet"
  | "beachLife"
  | "mountainLife"
  | "familyFriendly";

/** Advanced search's size groups (SIZE_BANDS), or every size. */
export type SizeKey = SizeBand | "all";
export const SIZE_KEYS: SizeKey[] = [...SIZE_BANDS.map((b) => b.key), "all"];

const inSize = (size: SizeKey, populationK: number) => size === "all" || SIZE_BANDS.find((b) => b.key === size)!.test(populationK);

export interface BoardContext {
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
  /** The figure shown beside a place, at the precision shown - what the
   *  boards worked out ahead of time keep. */
  figure: (ctx: BoardContext, i: number) => number[];
  /** That figure as shown, in the viewer's units. */
  format: (figure: number[], prefs: UnitPreferences) => string;
}

const num = (v: CriterionValue) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const oneDecimal = (n: number) => Math.round(n * 10) / 10;
const whole = (figure: number[]) => String(figure[0]);
const POPULATION = "demographics.population";

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

const familyScore = ({ table, col }: BoardContext, i: number): number | null => {
  if (col("liveability.hasSchool")(i) !== true || col("liveability.hasNursery")(i) !== true) return null;
  const { safetyStability, liveability } = table.sections(i);
  const parks = num(col("liveability.parksPer10k")(i)) ?? 0;
  const family = num(col("liveability.familyActivitiesPer10k")(i)) ?? 0;
  return 0.4 * safetyStability + 0.4 * liveability + 0.2 * Math.min(100, parks * 8 + family * 15);
};

export const BOARDS: BoardDef[] = [
  {
    key: "overall",
    title: "Best overall",
    blurb: "The Piltri score, with your score settings",
    needs: [],
    score: ({ table, weights }, i) => table.piltri(i, weights),
    figure: ({ table, weights }, i) => [Math.round(table.piltri(i, weights))],
    format: whole,
  },
  {
    key: "safest",
    title: "Safest",
    blurb: "Safety score: stability, rule of law, crime",
    needs: SAFETY_INPUTS,
    score: ({ table, col }, i) => (enough(col, i, SAFETY_INPUTS) ? table.sections(i).safetyStability : null),
    figure: ({ table }, i) => [Math.round(table.sections(i).safetyStability)],
    format: whole,
  },
  {
    key: "economy",
    title: "Strongest economy",
    blurb: "Economy score: growth, salaries, jobs, purchasing power",
    needs: ECONOMY_INPUTS,
    score: ({ table, col }, i) => (enough(col, i, ECONOMY_INPUTS) ? table.sections(i).economy : null),
    figure: ({ table }, i) => [Math.round(table.sections(i).economy)],
    format: whole,
  },
  {
    key: "environment",
    title: "Best environment",
    blurb: "Environment score: climate, clean air, nature nearby",
    needs: [],
    score: ({ table }, i) => table.sections(i).climate,
    figure: ({ table }, i) => [Math.round(table.sections(i).climate)],
    format: whole,
  },
  {
    key: "qualityOfLife",
    title: "Best quality of life",
    blurb: "Quality of Life score: amenities, transport, health, internet",
    needs: [],
    score: ({ table }, i) => table.sections(i).liveability,
    figure: ({ table }, i) => [Math.round(table.sections(i).liveability)],
    format: whole,
  },
  {
    key: "eternalSpring",
    title: "Eternal spring",
    // Ranked by how close a place comes to Advanced search's Eternal
    // spring, so the board is always full: places that meet it lead
    // (2026-11-06: as a strict filter, only 3 big cities made it).
    blurb: `Closest to Advanced search's Eternal spring: winter nights above ${ETERNAL_SPRING.minLowC}°C, summer days under ${ETERNAL_SPRING.maxHighC}°C, around 20°C`,
    needs: ["climate.avgAnnualTemperatureC", "climate.hottestMonthHighC", "climate.coldestMonthLowC"],
    score: ({ col }, i) => {
      const avg = num(col("climate.avgAnnualTemperatureC")(i));
      const hi = num(col("climate.hottestMonthHighC")(i));
      const lo = num(col("climate.coldestMonthLowC")(i));
      if (avg == null || hi == null || lo == null) return null;
      const meets = hi <= ETERNAL_SPRING.maxHighC && lo >= ETERNAL_SPRING.minLowC;
      const closeness = 100 - (2 * Math.abs(avg - 20) + 1.5 * Math.max(0, hi - ETERNAL_SPRING.maxHighC) + 1.5 * Math.max(0, ETERNAL_SPRING.minLowC - lo));
      return (meets ? 1000 : 0) + closeness;
    },
    figure: ({ col }, i) => [oneDecimal(num(col("climate.coldestMonthLowC")(i)) ?? 0), oneDecimal(num(col("climate.hottestMonthHighC")(i)) ?? 0)],
    format: ([lo, hi], prefs) => `${formatTemperature(lo, prefs)} to ${formatTemperature(hi, prefs)}`,
  },
  {
    key: "sunniest",
    title: "Sunniest",
    blurb: "Hours of sunshine a year (estimated)",
    needs: ["climate.avgAnnualSunshineHrs"],
    score: ({ col }, i) => num(col("climate.avgAnnualSunshineHrs")(i)),
    figure: ({ col }, i) => [Math.round(num(col("climate.avgAnnualSunshineHrs")(i)) ?? 0)],
    format: ([hours]) => `${hours.toLocaleString("en-GB")} h`,
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
    figure: ({ col }, i) => [oneDecimal(num(col("climate.avgAnnualPm25")(i)) ?? 0)],
    format: ([pm]) => `${pm.toFixed(1)} µg/m³`,
  },
  {
    key: "fastInternet",
    title: "Fastest internet",
    blurb: "Average home broadband download speed",
    needs: ["liveability.broadbandDownloadMbps"],
    score: ({ col }, i) => num(col("liveability.broadbandDownloadMbps")(i)),
    figure: ({ col }, i) => [Math.round(num(col("liveability.broadbandDownloadMbps")(i)) ?? 0)],
    format: ([mbps]) => `${mbps} Mbps`,
  },
  {
    key: "beachLife",
    title: "Beach life",
    blurb: `Advanced search's Beach and Sunny - a beach within ${BEACH_KM} km, ${SUNNY_HOURS.toLocaleString("en-GB")}+ hours of sun - by Piltri score`,
    needs: ["liveability.distanceToBeachKm", "climate.avgAnnualSunshineHrs"],
    score: ({ table, weights, col }, i) => {
      const beach = num(col("liveability.distanceToBeachKm")(i));
      const sun = num(col("climate.avgAnnualSunshineHrs")(i));
      return beach != null && beach <= BEACH_KM && sun != null && sun >= SUNNY_HOURS ? table.piltri(i, weights) : null;
    },
    figure: ({ table, weights }, i) => [Math.round(table.piltri(i, weights))],
    format: whole,
  },
  {
    // The twelfth, so the boards pair up (2026-11-06, owner).
    key: "mountainLife",
    title: "Mountain life",
    blurb: `Advanced search's Mountains - a 1,000 m+ peak rising 500 m above the place, within ${MOUNTAINS_KM} km - by Piltri score`,
    needs: ["liveability.distanceToMountainKm"],
    score: ({ table, weights, col }, i) => {
      const mountain = num(col("liveability.distanceToMountainKm")(i));
      return mountain != null && mountain <= MOUNTAINS_KM ? table.piltri(i, weights) : null;
    },
    figure: ({ table, weights }, i) => [Math.round(table.piltri(i, weights))],
    format: whole,
  },
  {
    key: "familyFriendly",
    title: "Family-friendly",
    blurb: "Advanced search's School and Nursery, then safety, quality of life, parks and family activities",
    needs: ["liveability.hasSchool", "liveability.hasNursery", "liveability.parksPer10k", "liveability.familyActivitiesPer10k"],
    score: familyScore,
    figure: (ctx, i) => [Math.round(familyScore(ctx, i) ?? 0)],
    format: whole,
  },
];

/** Every column the boards read, plus population for the size filter. */
export const LEADERBOARD_COLUMNS = [...new Set([POPULATION, ...BOARDS.flatMap((b) => b.needs)])];

/** How many places one country may have on a board (null: any number). */
export const PER_COUNTRY_CHOICES: (number | null)[] = [1, 3, null];

export interface Filters {
  region: RegionKey | "world";
  size: SizeKey;
  /** At most this many places per country (null: no limit) - so a board
   *  isn't one country's towns all tied on a country-level score. */
  perCountry: number | null;
}

export interface Entry {
  rank: number;
  id: string;
  name: string;
  region: string | null;
  countryCode: string;
  /** BoardDef.figure - shown with BoardDef.format. */
  figure: number[];
  /** Its position on the board with no filter (boardRanks). */
  overall: number | null;
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

/** A board's places, best first - ties to the bigger place (more
 *  recognisable). The order holds whatever the filters, so it's worked out
 *  once per board. */
export function boardOrder(def: BoardDef, ctx: BoardContext): Int32Array {
  const { table } = ctx;
  const population = ctx.col(POPULATION);
  const score = new Float64Array(table.count);
  const pop = new Float64Array(table.count);
  const on: number[] = [];
  for (let i = 0; i < table.count; i++) {
    const s = def.score(ctx, i);
    if (s == null || !Number.isFinite(s)) continue;
    score[i] = s;
    pop[i] = num(population(i)) ?? 0;
    on.push(i);
  }
  on.sort((a, b) => score[b] - score[a] || pop[b] - pop[a]);
  return Int32Array.from(on);
}

/** Every place's position on a board with no filter - the whole world,
 *  all populations, any number per country - by the same rule as the
 *  board itself (one per metro area): "#45 overall" beside a filtered
 *  board's places (2026-10-17, on request: unfiltered, the board reads 1,
 *  2, 3...). A place left out as part of a better one's metro area gets
 *  the position it would take. 0 = not on this board. */
export function boardRanks(table: PlaceTable, order: Int32Array): Int32Array {
  // Listed places by grid cell of ~METRO_KM, so each check looks at the
  // neighbouring cells only.
  const cellDeg = METRO_KM / 111;
  const cells = new Map<string, number[]>();
  const cellOf = (i: number) => [Math.floor((table.lng[i] * Math.cos((table.lat[i] * Math.PI) / 180)) / cellDeg), Math.floor(table.lat[i] / cellDeg)];
  const rank = new Int32Array(table.count);
  let listed = 0;
  for (const i of order) {
    const [cx, cy] = cellOf(i);
    let near = false;
    search: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? [])
          if (km(table.lat[i], table.lng[i], table.lat[j], table.lng[j]) < METRO_KM) {
            near = true;
            break search;
          }
    if (near) {
      rank[i] = listed + 1;
      continue;
    }
    rank[i] = ++listed;
    const key = `${cx},${cy}`;
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  }
  return rank;
}

/** A board's top `limit` places under `filters`, down its order: one per
 *  metro area, at most `perCountry` per country. */
export function topOf(def: BoardDef, ctx: BoardContext, order: Int32Array, ranks: Int32Array, filters: Filters, limit = 10): Entry[] {
  const { table } = ctx;
  const population = ctx.col(POPULATION);
  const perCountry = new Map<string, number>();
  const out: Entry[] = [];
  const listed: number[] = [];
  for (const i of order) {
    const cc = table.cc[i];
    if (filters.region !== "world" && regionOf(cc) !== filters.region) continue;
    if (!inSize(filters.size, num(population(i)) ?? 0)) continue;
    const n = perCountry.get(cc) ?? 0;
    if (filters.perCountry != null && n >= filters.perCountry) continue;
    if (listed.some((j) => km(table.lat[i], table.lng[i], table.lat[j], table.lng[j]) < METRO_KM)) continue;
    perCountry.set(cc, n + 1);
    listed.push(i);
    out.push({
      rank: out.length + 1,
      id: table.id(i),
      name: table.name[i],
      region: table.region[i],
      countryCode: cc,
      figure: def.figure(ctx, i),
      overall: ranks[i] || null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** The key of a size and per-country choice in a precomputed file. */
export const comboKey = (size: SizeKey, perCountry: number | null) => `${size}-${perCountry ?? "any"}`;

/** leaderboards/<region>.json: every size and per-country choice's boards. */
export interface LeaderboardsFile {
  boards: Record<string, Record<BoardKey, Entry[]>>;
}

export const LEADERBOARD_REGIONS: (RegionKey | "world")[] = ["world", ...REGION_ORDER];

/** Every region's boards at `ctx.weights` (the default settings), for the
 *  pipeline: each board's order once, then every filter walks it. */
export function precomputeLeaderboards(ctx: BoardContext): Record<RegionKey | "world", LeaderboardsFile> {
  const files = Object.fromEntries(LEADERBOARD_REGIONS.map((region) => [region, { boards: {} }])) as Record<RegionKey | "world", LeaderboardsFile>;
  for (const def of BOARDS) {
    const order = boardOrder(def, ctx);
    const ranks = boardRanks(ctx.table, order);
    for (const region of LEADERBOARD_REGIONS)
      for (const size of SIZE_KEYS)
        for (const perCountry of PER_COUNTRY_CHOICES) {
          const boards = (files[region].boards[comboKey(size, perCountry)] ??= {} as Record<BoardKey, Entry[]>);
          boards[def.key] = topOf(def, ctx, order, ranks, { region, size, perCountry });
        }
  }
  return files;
}
