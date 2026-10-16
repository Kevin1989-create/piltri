import type { PlaceTable } from "@/lib/advancedSearch/engine";
import { manifest } from "@/lib/dataset/files";
import { regionOf, REGION_ORDER, type RegionKey } from "@/lib/regions";
import { formatDistanceKm, formatTemperature, type UnitPreferences } from "@/lib/unitPreferences";
import type { CriterionValue, SectionKey, SectionScores } from "@/lib/types";

/**
 * Advanced search (/search, redesigned 2026-10-11): a handful of plain
 * choices - where, how big, what climate, what's within reach, what it's
 * strong at, which language - instead of a min/max box for each of 60
 * criteria. Every choice is a chip; results update as you tap. Runs in the
 * browser over the same files as before (PlaceTable).
 */

type Column = (i: number) => CriterionValue;
type Col = (key: string) => Column;

const num = (v: CriterionValue) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const thousands = (n: number) => Math.round(n).toLocaleString("en-GB");

/* ---- Size: the population column is in thousands. ---- */
export type SizeBand = "village" | "town" | "city" | "big";
export const SIZE_BANDS: { key: SizeBand; label: string; hint: string; test: (k: number) => boolean }[] = [
  { key: "village", label: "Villages", hint: "under 10k", test: (k) => k < 10 },
  { key: "town", label: "Towns", hint: "10k-50k", test: (k) => k >= 10 && k < 50 },
  { key: "city", label: "Cities", hint: "50k-500k", test: (k) => k >= 50 && k < 500 },
  { key: "big", label: "Big cities", hint: "500k+", test: (k) => k >= 500 },
];
const POPULATION = "demographics.population";

/* ---- Yes/no choices (climate and what's within reach). ---- */
export interface Toggle {
  key: string;
  label: string;
  hint: (prefs: UnitPreferences) => string;
  needs: string[];
  test: (col: Col, i: number) => boolean;
  /** The figure behind it, shown on each result - so you see why it
   *  matched (null: nothing worth showing, e.g. a plain Yes). */
  fact?: (col: Col, i: number, prefs: UnitPreferences) => string | null;
}

const atLeast = (key: string, min: number) => (col: Col, i: number) => {
  const v = num(col(key)(i));
  return v != null && v >= min;
};
const atMost = (key: string, max: number) => (col: Col, i: number) => {
  const v = num(col(key)(i));
  return v != null && v <= max;
};
const yes = (key: string) => (col: Col, i: number) => col(key)(i) === true;

const T_AVG = "climate.avgAnnualTemperatureC";
const T_HI = "climate.hottestMonthHighC";
const T_LO = "climate.coldestMonthLowC";
const SUN = "climate.avgAnnualSunshineHrs";
const RAIN = "climate.avgAnnualRainfallMm";
const SNOW = "climate.avgAnnualSnowfallCm";
const PM25 = "climate.avgAnnualPm25";

const rainText = (mm: number, prefs: UnitPreferences) =>
  prefs.distance === "imperial" ? `${Math.round(mm / 25.4)} in` : `${thousands(mm)} mm`;

export const CLIMATE: Toggle[] = [
  {
    key: "warm",
    label: "Warm",
    hint: (p) => `${formatTemperature(18, p)}+ on average`,
    needs: [T_AVG],
    test: atLeast(T_AVG, 18),
    fact: (col, i, p) => `${formatTemperature(num(col(T_AVG)(i)) ?? 0, p)} average`,
  },
  {
    key: "mildWinters",
    label: "Mild winters",
    hint: (p) => `nights above ${formatTemperature(5, p)}`,
    needs: [T_LO],
    test: atLeast(T_LO, 5),
    fact: (col, i, p) => `${formatTemperature(num(col(T_LO)(i)) ?? 0, p)} winter nights`,
  },
  {
    key: "mildSummers",
    label: "Mild summers",
    hint: (p) => `days under ${formatTemperature(30, p)}`,
    needs: [T_HI],
    test: atMost(T_HI, 30),
    fact: (col, i, p) => `${formatTemperature(num(col(T_HI)(i)) ?? 0, p)} summer days`,
  },
  {
    key: "sunny",
    label: "Sunny",
    hint: () => "2,500+ hours of sun",
    needs: [SUN],
    test: atLeast(SUN, 2500),
    fact: (col, i) => `${thousands(num(col(SUN)(i)) ?? 0)} h of sun`,
  },
  {
    key: "dry",
    label: "Dry",
    hint: (p) => `under ${rainText(600, p)} of rain`,
    needs: [RAIN],
    test: atMost(RAIN, 600),
    fact: (col, i, p) => `${rainText(num(col(RAIN)(i)) ?? 0, p)} of rain`,
  },
  {
    key: "noSnow",
    label: "Little snow",
    hint: (p) => (p.distance === "imperial" ? "under 2 in a year" : "under 5 cm a year"),
    needs: [SNOW],
    test: atMost(SNOW, 5),
  },
  {
    key: "cleanAir",
    label: "Clean air",
    hint: () => "PM2.5 under 10 µg/m³",
    needs: [PM25],
    test: atMost(PM25, 10),
    fact: (col, i) => `PM2.5 ${(num(col(PM25)(i)) ?? 0).toFixed(1)}`,
  },
];

const distanceFact = (key: string, what: string) => (col: Col, i: number, p: UnitPreferences) => {
  const km = num(col(key)(i));
  if (km == null) return null;
  return km < 0.1 ? `${what} on the doorstep` : `${what} ${formatDistanceKm(km, p)}`;
};
const BEACH = "liveability.distanceToBeachKm";
const LAKE_BEACH = "liveability.distanceToLakeBeachKm";
const MOUNTAIN = "liveability.distanceToMountainKm";
const FOREST = "liveability.distanceToForestKm";
const BROADBAND = "liveability.broadbandDownloadMbps";

export const NEARBY: Toggle[] = [
  {
    key: "beach",
    label: "Beach",
    hint: (p) => `within ${formatDistanceKm(10, p)}`,
    needs: [BEACH],
    test: atMost(BEACH, 10),
    fact: distanceFact(BEACH, "Beach"),
  },
  {
    key: "lakeBeach",
    label: "Lake beach",
    hint: (p) => `within ${formatDistanceKm(10, p)}`,
    needs: [LAKE_BEACH],
    test: atMost(LAKE_BEACH, 10),
    fact: distanceFact(LAKE_BEACH, "Lake beach"),
  },
  {
    key: "mountains",
    label: "Mountains",
    hint: (p) => `within ${formatDistanceKm(30, p)}`,
    needs: [MOUNTAIN],
    test: atMost(MOUNTAIN, 30),
    fact: distanceFact(MOUNTAIN, "Mountains"),
  },
  {
    key: "forest",
    label: "Forest",
    hint: (p) => `within ${formatDistanceKm(5, p)}`,
    needs: [FOREST],
    test: atMost(FOREST, 5),
    fact: distanceFact(FOREST, "Forest"),
  },
  { key: "airport", label: "Airport", hint: (p) => `within ${formatDistanceKm(40, p)}`, needs: ["liveability.hasAirport"], test: yes("liveability.hasAirport") },
  { key: "train", label: "Train station", hint: (p) => `within ${formatDistanceKm(5, p)}`, needs: ["liveability.hasTrainStation"], test: yes("liveability.hasTrainStation") },
  { key: "metro", label: "Metro", hint: (p) => `within ${formatDistanceKm(5, p)}`, needs: ["liveability.hasSubway"], test: yes("liveability.hasSubway") },
  { key: "tram", label: "Tram", hint: (p) => `within ${formatDistanceKm(5, p)}`, needs: ["liveability.hasTramway"], test: yes("liveability.hasTramway") },
  { key: "port", label: "Port / ferry", hint: (p) => `within ${formatDistanceKm(10, p)}`, needs: ["liveability.hasPort"], test: yes("liveability.hasPort") },
  { key: "university", label: "University", hint: (p) => `within ${formatDistanceKm(5, p)}`, needs: ["liveability.hasUniversity"], test: yes("liveability.hasUniversity") },
  { key: "school", label: "School", hint: (p) => `within ${formatDistanceKm(5, p)}`, needs: ["liveability.hasSchool"], test: yes("liveability.hasSchool") },
  { key: "nursery", label: "Nursery", hint: (p) => `within ${formatDistanceKm(5, p)}`, needs: ["liveability.hasNursery"], test: yes("liveability.hasNursery") },
  { key: "careHome", label: "Care home", hint: (p) => `within ${formatDistanceKm(5, p)}`, needs: ["liveability.hasCareHome"], test: yes("liveability.hasCareHome") },
  {
    key: "fastInternet",
    label: "Fast internet",
    hint: () => "100 Mbps+ broadband",
    needs: [BROADBAND],
    test: atLeast(BROADBAND, 100),
    fact: (col, i) => `${Math.round(num(col(BROADBAND)(i)) ?? 0)} Mbps`,
  },
];

/** A choice is offered only when the dataset has its figures (a figure
 *  added later reaches the site with the next data refresh). */
export const available = (t: Toggle) => t.needs.every((key) => manifest.advCityColumns.includes(key));

/* ---- Strong in: a section scoring 70+ (green on the city page). ---- */
export const STRONG_MIN = 70;
export const STRONG: { key: string; section: SectionKey }[] = [
  { key: "safety", section: "safetyStability" },
  { key: "economy", section: "economy" },
  { key: "environment", section: "climate" },
  { key: "life", section: "liveability" },
];

/* ---- Official language: the most widely official ones. ---- */
export const LANGUAGES = ["English", "Spanish", "French", "Portuguese", "German", "Italian", "Dutch", "Arabic", "Chinese", "Russian"];

/* ---- Sort ---- */
export type SortKey = "match" | "safety" | "economy" | "environment" | "life" | "biggest" | "smallest";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "match", label: "Piltri score" },
  { key: "safety", label: "Safety" },
  { key: "economy", label: "Economy" },
  { key: "environment", label: "Environment" },
  { key: "life", label: "Quality of Life" },
  { key: "biggest", label: "Biggest first" },
  { key: "smallest", label: "Smallest first" },
];

export type View = "list" | "map" | "countries";

export interface FinderState {
  regions: RegionKey[];
  countries: string[];
  sizes: SizeBand[];
  climate: string[];
  nearby: string[];
  strong: string[];
  languages: string[];
  sort: SortKey;
  view: View;
  /** Every matching place, rather than one per neighbourhood (see
   *  groupNearby). */
  every: boolean;
}

export const EMPTY_STATE: FinderState = {
  regions: [],
  countries: [],
  sizes: [],
  climate: [],
  nearby: [],
  strong: [],
  languages: [],
  sort: "match",
  view: "list",
  every: false,
};

export function activeFilterCount(s: FinderState): number {
  return s.regions.length + s.countries.length + s.sizes.length + s.climate.length + s.nearby.length + s.strong.length + s.languages.length;
}

/* ---- Address: every choice is in the URL, so a search can be shared or
 *      bookmarked: /search?region=europe&near=beach,train&sort=safety ---- */
const list = (params: URLSearchParams, name: string) => (params.get(name) ?? "").split(",").filter(Boolean);
const only = <T extends string>(values: string[], allowed: readonly T[]) => values.filter((v): v is T => allowed.includes(v as T));

export function readFinderState(params: URLSearchParams): FinderState {
  const sort = params.get("sort");
  const view = params.get("view");
  return {
    regions: only(list(params, "region"), REGION_ORDER),
    countries: list(params, "country").map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
    sizes: only(list(params, "size"), SIZE_BANDS.map((b) => b.key)),
    climate: only(list(params, "climate"), CLIMATE.map((t) => t.key)),
    nearby: only(list(params, "near"), NEARBY.map((t) => t.key)),
    strong: only(list(params, "strong"), STRONG.map((s) => s.key)),
    languages: only(list(params, "lang"), LANGUAGES),
    sort: SORTS.some((s) => s.key === sort) ? (sort as SortKey) : "match",
    view: view === "map" || view === "countries" ? view : "list",
    every: params.get("every") === "1",
  };
}

export function finderQuery(s: FinderState, from: string | null): string {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  const put = (name: string, values: string[]) => values.length && qs.set(name, values.join(","));
  put("region", s.regions);
  put("country", s.countries);
  put("size", s.sizes);
  put("climate", s.climate);
  put("near", s.nearby);
  put("strong", s.strong);
  put("lang", s.languages);
  if (s.sort !== "match") qs.set("sort", s.sort);
  if (s.view !== "list") qs.set("view", s.view);
  if (s.every) qs.set("every", "1");
  return qs.toString().replace(/%2C/g, ",");
}

/** The criterion columns a state needs loaded (population always: size
 *  and sort read it). */
export function columnsFor(s: FinderState): string[] {
  const toggles = [...CLIMATE.filter((t) => s.climate.includes(t.key)), ...NEARBY.filter((t) => s.nearby.includes(t.key))];
  return [...new Set([POPULATION, ...toggles.flatMap((t) => t.needs)])];
}

export interface FinderResult {
  /** Matching places, best first. */
  indices: number[];
  /** One per neighbourhood (groupNearby): the best of each, best first. */
  heads: number[];
  /** Head -> how many other matches it stands for. */
  nearby: Map<number, number>;
  /** Matching places per country, most first. */
  byCountry: { cc: string; count: number; best: number }[];
}

const SECTION_OF: Record<string, SectionKey> = { safety: "safetyStability", economy: "economy", environment: "climate", life: "liveability" };

export function runFinder(
  table: PlaceTable,
  col: Col,
  languagesOf: Record<string, string[]>,
  weights: SectionScores,
  s: FinderState
): FinderResult {
  const population = col(POPULATION);
  const toggles = [...CLIMATE.filter((t) => s.climate.includes(t.key)), ...NEARBY.filter((t) => s.nearby.includes(t.key))];
  const sizes = SIZE_BANDS.filter((b) => s.sizes.includes(b.key));
  const strong = s.strong.map((k) => SECTION_OF[k]);
  const regions = new Set<string>(s.regions);
  const countries = new Set(s.countries);
  // Language, per country (cheaper than per place).
  const speaks = new Map<string, boolean>();
  const speaksIn = (cc: string) => {
    let ok = speaks.get(cc);
    if (ok == null) {
      const langs = languagesOf[cc] ?? [];
      ok = s.languages.some((l) => langs.includes(l));
      speaks.set(cc, ok);
    }
    return ok;
  };

  const matches: number[] = [];
  for (let i = 0; i < table.count; i++) {
    const cc = table.cc[i];
    // Where: any of the regions or countries picked (Europe + Japan).
    if ((regions.size || countries.size) && !countries.has(cc) && !regions.has(regionOf(cc) ?? "")) continue;
    if (s.languages.length && !speaksIn(cc)) continue;
    if (sizes.length) {
      const k = num(population(i));
      if (k == null || !sizes.some((b) => b.test(k))) continue;
    }
    if (strong.length) {
      const sections = table.sections(i);
      if (!strong.every((key) => sections[key] >= STRONG_MIN)) continue;
    }
    if (!toggles.every((t) => t.test(col, i))) continue;
    matches.push(i);
  }

  const pop = (i: number) => num(population(i)) ?? 0;
  const piltri = new Map<number, number>();
  const score = (i: number) => {
    let v = piltri.get(i);
    if (v == null) piltri.set(i, (v = table.piltri(i, weights)));
    return v;
  };
  const key: (i: number) => number =
    s.sort === "biggest"
      ? pop
      : s.sort === "smallest"
        ? (i) => -pop(i)
        : s.sort === "match"
          ? score
          : (i) => table.sections(i)[SECTION_OF[s.sort]];
  matches.sort((a, b) => key(b) - key(a) || pop(b) - pop(a));

  const counts = new Map<string, { cc: string; count: number; best: number }>();
  for (const i of matches) {
    const cc = table.cc[i];
    const entry = counts.get(cc);
    if (entry) entry.count++;
    else counts.set(cc, { cc, count: 1, best: i });
  }
  const byCountry = [...counts.values()].sort((a, b) => b.count - a.count);
  // Sorted by a score, a bigger place within a point of its neighbourhood's
  // best stands for it (Monaco, not its quarter Fontvieille).
  const tolerance = s.sort === "biggest" || s.sort === "smallest" ? 0 : 1;
  return { indices: matches, ...groupNearby(table, matches, key, pop, tolerance), byCountry };
}

/** Places this close to a better match are folded into it: GeoNames lists
 *  the quarters of many cities as places of their own (Monaco's ten, the
 *  estates of Singapore), and a list of them all hides everything else. */
export const GROUP_KM = 10;

/** Walks the sorted matches keeping the first in each neighbourhood - or
 *  the biggest of its neighbours scoring within `tolerance` of it. A grid
 *  of ~GROUP_KM cells (x scaled by latitude) makes it one pass, not a
 *  comparison with every kept place. */
function groupNearby(
  table: PlaceTable,
  sorted: number[],
  key: (i: number) => number,
  pop: (i: number) => number,
  tolerance: number
): { heads: number[]; nearby: Map<number, number> } {
  const shownFor = new Map<number, number>();
  const cellDeg = GROUP_KM / 111;
  const cells = new Map<string, number[]>();
  const heads: number[] = [];
  const nearby = new Map<number, number>();
  const xy = (i: number) => {
    const lat = table.lat[i];
    return { x: table.lng[i] * Math.cos((lat * Math.PI) / 180), y: lat };
  };
  for (const i of sorted) {
    const { x, y } = xy(i);
    const cx = Math.floor(x / cellDeg);
    const cy = Math.floor(y / cellDeg);
    let head: number | null = null;
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const h of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const p = xy(h);
          if (Math.hypot(p.x - x, p.y - y) * 111 < GROUP_KM) {
            head = h;
            break search;
          }
        }
      }
    }
    if (head != null) {
      nearby.set(head, (nearby.get(head) ?? 0) + 1);
      const shown = shownFor.get(head) ?? head;
      if (tolerance > 0 && key(i) >= key(head) - tolerance && pop(i) > pop(shown)) shownFor.set(head, i);
      continue;
    }
    heads.push(i);
    const cell = `${cx},${cy}`;
    const list = cells.get(cell);
    if (list) list.push(i);
    else cells.set(cell, [i]);
  }
  if (!shownFor.size) return { heads, nearby };
  const swapped = new Map<number, number>();
  for (const [head, n] of nearby) swapped.set(shownFor.get(head) ?? head, n);
  return { heads: heads.map((h) => shownFor.get(h) ?? h), nearby: swapped };
}

/** The figures behind the active choices, for one result (at most 3). */
export function factsFor(col: Col, i: number, s: FinderState, prefs: UnitPreferences): string[] {
  const out: string[] = [];
  for (const t of [...CLIMATE, ...NEARBY]) {
    if (!t.fact || !(s.climate.includes(t.key) || s.nearby.includes(t.key))) continue;
    const fact = t.fact(col, i, prefs);
    if (fact) out.push(fact);
    if (out.length === 3) break;
  }
  return out;
}
