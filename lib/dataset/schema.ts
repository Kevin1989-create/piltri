import type { EconomyFields, EconomyTypeProfile, SafetyStabilityFields } from "@/lib/types";

/**
 * The precomputed dataset's on-disk shape, shared by the offline pipeline
 * (pipeline/, which writes it) and the website (lib/dataset/load.ts, which
 * reads it). Nothing here is fetched at request time from a third-party
 * API - every value is computed offline from free bulk downloads and
 * published as static JSON files to Supabase Storage (see
 * pipeline/README.md for sources, cadence and how to re-run).
 *
 * Bump DATASET_SCHEMA_VERSION whenever CITY_FIELDS changes shape (add,
 * remove or reorder a field) - the loader refuses a dataset built for a
 * different schema rather than silently misreading columns.
 */
export const DATASET_SCHEMA_VERSION = 1;

/** Country-level values - identical for every city in the country, so
 *  stored once per country (countries.json) rather than repeated on every
 *  city row. */
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
  economy: Omit<EconomyFields, "mainEconomyType">;
  safetyStability: SafetyStabilityFields;
  climateReadinessScore: number | null;
  healthcareQualityScore: number | null;
  lifeExpectancyYears: number | null;
  internetUsersPct: number | null;
  pisaMathScore: number | null;
  pisaReadingScore: number | null;
  pisaScienceScore: number | null;
  /** Raw GNI per capita (USD) - not displayed directly (averageSalaryGbp is
   *  the displayed, converted figure), but the Economy score is calibrated
   *  against this raw value. */
  gniPerCapitaUsd: number | null;
}

/** City-level values, stored as one compact array per city (in exactly
 *  this order) to keep the per-country shard files small - ~66,000 cities
 *  as keyed objects would be several times larger. */
export const CITY_FIELDS = [
  "id",
  "name",
  "region",
  "lat",
  "lng",
  "population",
  "elevationM",
  "avgAnnualTemperatureC",
  "avgAnnualRainfallMm",
  "avgAnnualSunshineHrs",
  "avgAnnualSnowfallCm",
  "avgAnnualHumidityPct",
  "koppenCode",
  "avgAnnualPm25",
  "avgAnnualUvIndexMax",
  "earthquakeCount50yr",
  "distanceToVolcanoKm",
  "distanceToCoastKm",
  "distanceToBeachKm",
  "distanceToMountainKm",
  "distanceToForestKm",
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
  "mainEconomyType",
  "cityAreaKm2",
  "distanceToAirportKm",
  "distanceToTrainStationKm",
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
  avgAnnualTemperatureC: number | null;
  avgAnnualRainfallMm: number | null;
  avgAnnualSunshineHrs: number | null;
  avgAnnualSnowfallCm: number | null;
  avgAnnualHumidityPct: number | null;
  koppenCode: string | null;
  avgAnnualPm25: number | null;
  avgAnnualUvIndexMax: number | null;
  earthquakeCount50yr: number | null;
  distanceToVolcanoKm: number | null;
  distanceToCoastKm: number | null;
  distanceToBeachKm: number | null;
  distanceToMountainKm: number | null;
  distanceToForestKm: number | null;
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
  mainEconomyType: keyof EconomyTypeProfile | null;
  cityAreaKm2: number | null;
  /** Not shown as KPI rows - they back Advanced Search's "Nearby" filters
   *  (which used to need a live pin lookup per candidate city). */
  distanceToAirportKm: number | null;
  distanceToTrainStationKm: number | null;
  /** World ranks (1 = best) among all cities, overall at the default
   *  weighting and per section - filled in by the pipeline's final pass. */
  rankPiltri: number | null;
  rankEconomy: number | null;
  rankSafetyStability: number | null;
  rankClimate: number | null;
  rankLiveability: number | null;
}

export type CityRow = (string | number | boolean | null)[];

export function encodeCity(record: CityRecord): CityRow {
  return CITY_FIELDS.map((key) => record[key] ?? null);
}

export function decodeCity(row: CityRow): CityRecord {
  const out: Record<string, unknown> = {};
  CITY_FIELDS.forEach((key, i) => {
    out[key] = row[i] ?? null;
  });
  return out as unknown as CityRecord;
}

/** Top-level pointer file (manifest.json) - the loader reads this first,
 *  then fetches versioned files under `version/`, so publishing a new
 *  dataset is atomic (the manifest flips only once every file is up) and
 *  every versioned file can be cached forever. */
export interface DatasetManifest {
  schemaVersion: number;
  version: string;
  generatedAt: string;
  cityCount: number;
  countryCount: number;
  /** Human-readable per-field source + vintage notes, shown in the UI's
   *  data notes and kept alongside the data rather than in code comments. */
  sources: Record<string, string>;
}

export interface CountryShard {
  countryCode: string;
  rows: CityRow[];
}
