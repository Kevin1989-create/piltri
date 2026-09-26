import { computePiltriScore, normaliseWeights } from "@/lib/aggregation/scoring";
import { loadFile, manifest } from "@/lib/dataset/files";
import { cityIdFor, type AdvCountries, type AdvPlaces, type AdvScores } from "@/lib/dataset/schema";
import type {
  AdvancedSearchCityResult,
  AdvancedSearchCountryResult,
  AdvancedSearchRequest,
  AdvancedSearchResponse,
  AdvancedSearchScope,
  CriterionValue,
  SectionScores,
} from "@/lib/types";
import { getCriterion, kindForScope, matchesFilter, type CriterionDef } from "./criteria";

/**
 * Advanced search, entirely in the browser: every city's section scores
 * (adv/scores.json) plus one small column file per criterion actually used
 * (adv/col/<key>.json), or a per-country value for criteria that don't
 * vary within a country (adv/countries.json). Filtering all ~66,000 cities
 * takes a few milliseconds once the files are cached, so the search page
 * can show a live match count as filters change. Names and positions
 * (adv/places.json) are only needed to show the results.
 */

export const MAX_RESULTS = 50;

interface Base extends AdvScores {
  /** Country code of every city (expanded from the country runs). */
  cc: string[];
  count: number;
}

let basePromise: Promise<Base> | null = null;

function loadBase(): Promise<Base> {
  if (!basePromise) {
    basePromise = loadFile<AdvScores>("adv/scores.json").then((b) => {
      const cc = b.countryCodes.flatMap((code, i) => Array<string>(b.countryCounts[i]).fill(code));
      return { ...b, cc, count: cc.length };
    });
    basePromise.catch(() => (basePromise = null));
  }
  return basePromise;
}

const loadPlaces = () => loadFile<AdvPlaces>("adv/places.json");
const loadCountries = () => loadFile<AdvCountries>("adv/countries.json");
const loadColumn = (key: string) => loadFile<CriterionValue[]>(`adv/col/${key}.json`);

/** Starts downloading what a search needs: scores first (the live count),
 *  then names for the results. */
export function prefetchAdvancedSearch(scope: AdvancedSearchScope): void {
  const ignore = () => {};
  loadCountries().catch(ignore);
  if (scope === "city") loadBase().then(() => loadPlaces().catch(ignore), ignore);
}

type Getter = (i: number) => CriterionValue;

/** Resolves each active filter to a per-city value getter. */
async function cityGetters(base: Base, filters: AdvancedSearchRequest["filters"], weights: SectionScores) {
  const countries = await loadCountries();
  const out: { def: CriterionDef; filter: AdvancedSearchRequest["filters"][number]; get: Getter }[] = [];
  for (const filter of filters) {
    const def = getCriterion(filter.key);
    if (!def) continue;
    let get: Getter;
    if (def.fromScores === "piltri") get = (i) => piltriAt(base, i, weights);
    else if (def.fromScores) {
      const scores = base[def.fromScores];
      get = (i) => scores[i];
    } else if (countries.countryLevel[def.key]) {
      const perCountry = countries.countryLevel[def.key];
      get = (i) => perCountry[base.cc[i]] ?? null;
    } else if (manifest.advCityColumns.includes(def.key)) {
      const column = await loadColumn(def.key);
      get = (i) => column[i];
    } else continue;
    out.push({ def, filter, get });
  }
  return out;
}

function sectionsAt(base: Base, i: number): SectionScores {
  return { economy: base.economy[i], safetyStability: base.safetyStability[i], climate: base.climate[i], liveability: base.liveability[i] };
}

function piltriAt(base: Base, i: number, weights: SectionScores): number {
  return computePiltriScore(sectionsAt(base, i), weights);
}

async function citySearch(request: AdvancedSearchRequest, limit: number): Promise<AdvancedSearchResponse> {
  const base = await loadBase();
  const weights = normaliseWeights(request.weights);
  const getters = await cityGetters(base, request.filters ?? [], weights);
  const kinds = getters.map(({ def }) => kindForScope(def, "city"));
  const passes = (i: number) => getters.every(({ filter, get }, f) => matchesFilter(get(i), filter, kinds[f]));
  if (limit === 0) {
    // Count only (the live counter) - no scoring or sorting needed.
    let count = 0;
    for (let i = 0; i < base.count; i++) if (passes(i)) count++;
    return { scope: "city", checked: base.count, matchCount: count, cityResults: [] };
  }
  const matches: { i: number; score: number }[] = [];
  for (let i = 0; i < base.count; i++) {
    if (passes(i)) matches.push({ i, score: piltriAt(base, i, weights) });
  }
  matches.sort((a, b) => b.score - a.score);
  const places = await loadPlaces();
  const cityResults: AdvancedSearchCityResult[] = matches.slice(0, limit).map(({ i, score }) => ({
    cityId: cityIdFor(places.name[i], base.cc[i]),
    cityName: places.name[i],
    region: places.region[i],
    country: manifest.countryNames[base.cc[i]] ?? base.cc[i],
    countryCode: base.cc[i],
    lat: places.lat[i],
    lng: places.lng[i],
    sectionScores: sectionsAt(base, i),
    piltriScore: score,
    matchedValues: Object.fromEntries(getters.map(({ def, get }) => [def.key, get(i)])),
  }));
  return { scope: "city", checked: base.count, matchCount: matches.length, cityResults };
}

async function countrySearch(request: AdvancedSearchRequest, limit: number): Promise<AdvancedSearchResponse> {
  const { rollups } = await loadCountries();
  const weights = normaliseWeights(request.weights);
  const filters = (request.filters ?? []).flatMap((filter) => {
    const def = getCriterion(filter.key);
    return def ? [{ def, filter }] : [];
  });
  const results: AdvancedSearchCountryResult[] = [];
  for (const [countryCode, r] of Object.entries(rollups)) {
    const piltriScore = computePiltriScore(r.sectionScores, weights);
    const valueOf = (def: CriterionDef): CriterionValue =>
      def.fromScores === "piltri" ? piltriScore : def.fromScores ? r.sectionScores[def.fromScores] : r.values[def.key] ?? null;
    if (!filters.every(({ def, filter }) => matchesFilter(valueOf(def), filter, kindForScope(def, "country")))) continue;
    results.push({
      country: manifest.countryNames[countryCode] ?? countryCode,
      countryCode,
      citiesTracked: r.citiesTracked,
      lat: r.lat,
      lng: r.lng,
      sectionScores: r.sectionScores,
      piltriScore,
      matchedValues: Object.fromEntries(filters.map(({ def }) => [def.key, valueOf(def)])),
      allValues: { ...r.values, "overall.piltriScore": piltriScore },
    });
  }
  results.sort((a, b) => b.piltriScore - a.piltriScore);
  return { scope: "country", checked: Object.keys(rollups).length, matchCount: results.length, countryResults: results.slice(0, limit) };
}

export function runAdvancedSearch(request: AdvancedSearchRequest, limit = MAX_RESULTS): Promise<AdvancedSearchResponse> {
  return request.scope === "country" ? countrySearch(request, limit) : citySearch(request, limit);
}

/** How many cities/countries match - for the live count on the search page. */
export async function countMatches(request: AdvancedSearchRequest): Promise<number> {
  return (await runAdvancedSearch(request, 0)).matchCount;
}
