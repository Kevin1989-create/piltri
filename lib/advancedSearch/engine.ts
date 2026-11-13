import { computePiltriScore, normaliseWeights } from "@/lib/aggregation/scoring";
import { countryName, loadFile, manifest } from "@/lib/dataset/files";
import { cityIdFor, type AdvCountries, type AdvPlaces, type AdvScores } from "@/lib/dataset/schema";
import type { AdvancedSearchCountryResult, CriterionValue, SectionScores } from "@/lib/types";

/**
 * The places table the browser searches (finder.ts) and ranks
 * (Leaderboards): every city's section scores (adv/scores.json) plus one
 * small column file per criterion actually used (adv/col/<key>.json), or a
 * per-country value for criteria that don't vary within a country
 * (adv/countries.json); names and positions from adv/places.json.
 */

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

function sectionsAt(base: Base, i: number): SectionScores {
  return { economy: base.economy[i], safetyStability: base.safetyStability[i], climate: base.climate[i], liveability: base.liveability[i] };
}

/** One country's roll-up, for the country page (/country?code=FR). */
export async function getCountryResult(countryCode: string, weights?: Partial<SectionScores>): Promise<AdvancedSearchCountryResult | null> {
  const code = countryCode.toUpperCase();
  const r = (await loadCountries()).rollups[code];
  if (!r) return null;
  const piltriScore = computePiltriScore(r.sectionScores, normaliseWeights(weights));
  return {
    country: countryName(code),
    countryCode: code,
    citiesTracked: r.citiesTracked,
    lat: r.lat,
    lng: r.lng,
    sectionScores: r.sectionScores,
    piltriScore,
    allValues: { ...r.values, "overall.piltriScore": piltriScore },
  };
}

/** Every place as the browser has it - for Leaderboards and the search
 *  page: country, section scores, name, id, plus any criterion's values
 *  per place on demand (a country-level value, or its column file). */
export interface PlaceTable {
  count: number;
  cc: string[];
  name: string[];
  region: (string | null)[];
  lat: number[];
  lng: number[];
  id: (i: number) => string;
  sections: (i: number) => SectionScores;
  /** With normalised weights (normaliseWeights). */
  piltri: (i: number, weights: SectionScores) => number;
  values: (key: string) => Promise<(i: number) => CriterionValue>;
}

export async function getPlaceTable(): Promise<PlaceTable> {
  const [base, places, countries] = await Promise.all([loadBase(), loadPlaces(), loadCountries()]);
  return {
    count: base.count,
    cc: base.cc,
    name: places.name,
    region: places.region,
    lat: places.lat,
    lng: places.lng,
    id: (i) => places.customIds?.[i] ?? cityIdFor(places.name[i], base.cc[i]),
    sections: (i) => sectionsAt(base, i),
    piltri: (i, weights) => computePiltriScore(sectionsAt(base, i), weights),
    values: async (key) => {
      const perCountry = countries.countryLevel[key];
      if (perCountry) return (i) => perCountry[base.cc[i]] ?? null;
      if (manifest.advCityColumns.includes(key)) {
        const column = await loadColumn(key);
        return (i) => column[i];
      }
      return () => null;
    },
  };
}
