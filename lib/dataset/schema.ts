import type { EconomyFields, SafetyStabilityFields } from "@/lib/types";

/**
 * The precomputed dataset's on-disk shape, shared by the offline pipeline
 * (pipeline/, which writes it) and the website (lib/dataset/, which reads
 * it in the browser). Every value is computed offline from free bulk
 * downloads - see pipeline/README.md for sources and cadence. The site
 * serves the files as static assets from its own CDN (/data/<version>/),
 * so reading a city is one cached file fetch, with no server code at all.
 *
 * Bump DATASET_SCHEMA_VERSION whenever CITY_FIELDS or a file layout
 * changes - the build refuses a dataset built for a different schema.
 */
export const DATASET_SCHEMA_VERSION = 2;

/** Public Supabase Storage bucket the pipeline publishes to; the site's
 *  build step (scripts/sync-dataset.mjs) copies the current version from
 *  there into public/data/. */
export const DATA_BUCKET = "piltri-data";

/** City ids are `${name}-${countryCode}` slugs - derivable, so they're not
 *  stored on every row. */
export function cityIdFor(name: string, countryCode: string): string {
  return `${name}-${countryCode}`.toLowerCase().replace(/\s+/g, "-");
}

/** Countries' cities are split into chunks of about this many, so opening
 *  one city downloads a few KB rather than a whole country (the US has
 *  ~4,600 cities). A city's chunk is a hash of its id - findable from the
 *  id alone, no index file needed. */
export const CITY_CHUNK_SIZE = 250;

export function cityChunk(cityId: string, chunkCount: number): number {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < cityId.length; i++) {
    hash ^= cityId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % chunkCount;
}

/** Pin mode's points (airports, stations, beaches, coast, peaks, towns)
 *  are published in 5°x5° tiles. */
export const POI_TILE_DEG = 5;

export function tileKey(lat: number, lng: number): string {
  return `${Math.floor(lat / POI_TILE_DEG)}_${Math.floor(lng / POI_TILE_DEG)}`;
}

/** Country-level values - identical for every city in the country, so
 *  stored once per country (countries.json). */
export interface CountryRecord {
  name: string;
  demographics: {
    countryPopulation: number | null;
    countryPopulationDensityPerKm2: number | null;
    countryLandAreaKm2: number | null;
    countryAverageAge: number | null;
    countryPopulationTrend5yrPct: number | null;
    countryMostWidelySpokenLanguage: string | null;
  };
  economy: EconomyFields;
  safetyStability: SafetyStabilityFields;
  climateReadinessScore: number | null;
  healthcareQualityScore: number | null;
  lifeExpectancyYears: number | null;
  internetUsersPct: number | null;
  pisaMathScore: number | null;
  pisaReadingScore: number | null;
  pisaScienceScore: number | null;
  /** Raw GNI per capita (USD) - the Economy score is calibrated against
   *  this; averageSalaryGbp is the displayed, converted figure. */
  gniPerCapitaUsd: number | null;
  capital: { name: string; lat: number; lng: number } | null;
}

/** City-level values, stored as one compact array per city in exactly this
 *  order (keyed objects would be several times larger). */
export const CITY_FIELDS = [
  "name",
  "region",
  "lat",
  "lng",
  "population",
  "elevationM",
  "timezone",
  "densityPerKm2",
  "avgAnnualTemperatureC",
  "avgAnnualRainfallMm",
  "avgAnnualSunshineHrs",
  "avgAnnualSnowfallCm",
  "avgAnnualHumidityPct",
  "koppenCode",
  "koppenCode2085",
  "hottestMonthHighC",
  "coldestMonthLowC",
  "monthlyHighC",
  "monthlyLowC",
  "monthlyRainMm",
  "avgAnnualPm25",
  "avgAnnualUvIndexMax",
  "earthquakeCount50yr",
  "distanceToVolcanoKm",
  "distanceToCoastKm",
  "distanceToBeachKm",
  "distanceToMountainKm",
  "distanceToForestKm",
  "distanceToCapitalKm",
  "distanceToAirportKm",
  "distanceToTrainStationKm",
  "nearestLargeCityName",
  "nearestLargeCityKm",
  "restaurantsBarsWithin5km",
  "parksWithin5km",
  "culturalVenuesWithin5km",
  "familyActivitiesWithin5km",
  "hasTrainStation",
  "hasSubway",
  "hasTramway",
  "hasAirport",
  "hasBusStation",
  "hasSchool",
  "hasUniversity",
  "broadbandDownloadMbps",
  "mobileDownloadMbps",
  "rankPiltri",
  "rankEconomy",
  "rankSafetyStability",
  "rankClimate",
  "rankLiveability",
] as const;

export type CityFieldKey = (typeof CITY_FIELDS)[number];

export interface CityRecord {
  id: string;
  name: string;
  region: string | null;
  lat: number;
  lng: number;
  population: number | null;
  elevationM: number | null;
  timezone: string | null;
  /** People per km² within 5 km of the centre (GHS-POP). */
  densityPerKm2: number | null;
  avgAnnualTemperatureC: number | null;
  avgAnnualRainfallMm: number | null;
  avgAnnualSunshineHrs: number | null;
  avgAnnualSnowfallCm: number | null;
  avgAnnualHumidityPct: number | null;
  /** Beck et al. Köppen-Geiger type, 1991-2020 and 2071-2099 (SSP2-4.5). */
  koppenCode: string | null;
  koppenCode2085: string | null;
  hottestMonthHighC: number | null;
  coldestMonthLowC: number | null;
  /** 12 values, January first. */
  monthlyHighC: number[] | null;
  monthlyLowC: number[] | null;
  monthlyRainMm: number[] | null;
  avgAnnualPm25: number | null;
  avgAnnualUvIndexMax: number | null;
  earthquakeCount50yr: number | null;
  distanceToVolcanoKm: number | null;
  distanceToCoastKm: number | null;
  distanceToBeachKm: number | null;
  distanceToMountainKm: number | null;
  distanceToForestKm: number | null;
  distanceToCapitalKm: number | null;
  /** Back Advanced Search's "distance from city centre" filters. */
  distanceToAirportKm: number | null;
  distanceToTrainStationKm: number | null;
  /** Nearest other city of 500,000+ people (null for such cities themselves). */
  nearestLargeCityName: string | null;
  nearestLargeCityKm: number | null;
  restaurantsBarsWithin5km: number | null;
  parksWithin5km: number | null;
  culturalVenuesWithin5km: number | null;
  familyActivitiesWithin5km: number | null;
  hasTrainStation: boolean | null;
  hasSubway: boolean | null;
  hasTramway: boolean | null;
  hasAirport: boolean | null;
  hasBusStation: boolean | null;
  hasSchool: boolean | null;
  hasUniversity: boolean | null;
  /** Test-weighted average download speed within 5 km (Ookla). */
  broadbandDownloadMbps: number | null;
  mobileDownloadMbps: number | null;
  /** World ranks (1 = best) among all cities, at the default weighting. */
  rankPiltri: number | null;
  rankEconomy: number | null;
  rankSafetyStability: number | null;
  rankClimate: number | null;
  rankLiveability: number | null;
}

export type CityValue = string | number | boolean | number[] | null;
export type CityRow = CityValue[];

export function encodeCity(record: CityRecord): CityRow {
  return CITY_FIELDS.map((key) => record[key] ?? null);
}

export function decodeCity(row: CityRow, countryCode: string): CityRecord {
  const out: Record<string, unknown> = {};
  CITY_FIELDS.forEach((key, i) => {
    out[key] = row[i] ?? null;
  });
  out.id = cityIdFor(out.name as string, countryCode);
  return out as unknown as CityRecord;
}

/** One chunk file: cities/<CC>-<n>.json. */
export interface CityChunkFile {
  rows: CityRow[];
}

/** manifest.json - also bundled into the site at build time
 *  (lib/dataset/meta.generated.json), so the browser knows the version,
 *  chunk counts and POI tile list without an extra request. */
export interface DatasetManifest {
  schemaVersion: number;
  version: string;
  generatedAt: string;
  cityCount: number;
  countryCount: number;
  /** Country code -> display name (search results need these). */
  countryNames: Record<string, string>;
  /** Country code -> number of city chunk files. */
  chunks: Record<string, number>;
  /** Keys of the POI tiles that exist (most of the ocean has none). */
  tiles: string[];
  /** Search index files that exist (search/<key>.json). */
  searchFiles: string[];
  /** Advanced Search criteria stored as per-city columns (adv/col/<key>.json);
   *  every other criterion is either country-level or derived from scores. */
  advCityColumns: string[];
  /** Human-readable source + vintage notes, shown on /admin. */
  sources: Record<string, string>;
}

/** Search-as-you-type index entries: [name, region, countryCode, lat, lng],
 *  largest places first. Split by the first two characters of any word in
 *  the name (search/<2 chars>.json, a few KB each), plus the 300 largest
 *  places per first letter (search/<1 char>.json) for the first keystroke. */
export type SearchEntry = [string, string | null, string, number, number];
export const SEARCH_TOP_PER_LETTER = 300;

/** Accent- and case-insensitive form used for search matching. */
export function normaliseSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The two-character index key of a normalised word or query: "lisbon" ->
 *  "li"; a one-letter word, or a query whose second character is a space,
 *  -> "a_". */
export function searchKey(text: string): string {
  const safe = (c: string | undefined) => (c && /[a-z0-9]/.test(c) ? c : "_");
  return safe(text[0]) + safe(text[1]);
}

/** Advanced Search scores (adv/scores.json): every city, grouped by country
 *  (runs of countryCounts[i] cities for countryCodes[i]), largest first
 *  within each country; section scores 0-100 with one decimal. Enough to
 *  filter and count - names only matter for the results shown. */
export interface AdvScores {
  countryCodes: string[];
  countryCounts: number[];
  economy: number[];
  safetyStability: number[];
  climate: number[];
  liveability: number[];
}

/** Advanced Search display data (adv/places.json), same order as AdvScores. */
export interface AdvPlaces {
  name: string[];
  region: (string | null)[];
  lat: number[];
  lng: number[];
}

/** Advanced Search country file (adv/countries.json). */
export interface AdvCountries {
  /** Criteria whose value is the same for every city in a country:
   *  key -> countryCode -> value. */
  countryLevel: Record<string, Record<string, string | number | boolean | null>>;
  /** Country-scope results: each country's roll-up of its cities. */
  rollups: Record<
    string,
    {
      citiesTracked: number;
      lat: number;
      lng: number;
      sectionScores: { economy: number; safetyStability: number; climate: number; liveability: number };
      values: Record<string, string | number | boolean | null>;
    }
  >;
}
