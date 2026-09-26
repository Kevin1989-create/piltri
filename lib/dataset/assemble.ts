import { distanceToCapitalKm } from "@/lib/data-sources/capitals";
import { getDaylightRange } from "@/lib/data-sources/daylight";
import { averageScores, computePiltriScore, normalise } from "@/lib/aggregation/scoring";
import type { CityExploreData, SectionScores } from "@/lib/types";
import type { CityRecord, CountryRecord } from "./schema";

/** Reference ranges used to normalise raw metrics onto 0-100 for the
 *  section scores - moved verbatim from the old live aggregator
 *  (lib/aggregation/aggregate.ts) so scores stay comparable across the
 *  migration. kpiRows.ts's COLOR_RANGES mirror these for colouring. */
export const RANGES = {
  gdpGrowth: { min: -10, max: 40 },
  unemployment: { min: 0, max: 25 },
  salary: { min: 2000, max: 90000 }, // GNI per capita, USD
  ppp: { min: 2000, max: 120000 },
  priceLevel: { min: 15, max: 130 },
  homicideRate: { min: 0, max: 30 },
  temperatureDistanceFrom20C: { min: 0, max: 20 },
  rainfallDistanceFromIdeal: { min: 0, max: 1000 },
  sunshineHrs: { min: 1200, max: 3800 },
  snowfallCm: { min: 0, max: 300 },
  pisaScore: { min: 350, max: 590 },
};

/** Amenity counts within 5 km of the city centre span 0 to tens of
 *  thousands (a village vs central London), so they're scored on a log
 *  scale: each step up in the order of magnitude counts the same. `cap` is
 *  the count that scores 100 - set from the real distribution across all
 *  ~66k cities (see pipeline/build.ts's distribution report), roughly the
 *  95th percentile. kpiRows.ts colours with this same function. */
// Calibrated 2026-09-26 against the first full build (95th percentile of
// cities with 100k+ people: eating 3,286 / cultural 171 / family 28 /
// parks 145). A median town (36 places to eat) scores ~45; 600 scores ~80.
export const COUNT_CAPS = { restaurantsBars: 3000, cultural: 200, family: 30, parks: 150 };

export function countScore(count: number, cap: number): number {
  return normalise(Math.log10(1 + count), 0, Math.log10(1 + cap));
}

/** Coastal flood / sea-level-rise exposure - disclosed PROXIES (elevation
 *  + distance to the actual coastline), not inundation models. See
 *  ClimateFields' own comments in lib/types.ts for the full reasoning and
 *  the two different threshold sets. Null (not "Low") when either input
 *  is missing - an unknown must never read as "safe". */
function exposure(
  elevationM: number | null,
  coastKm: number | null,
  high: { elev: number; km: number },
  moderate: { elev: number; km: number }
): "High" | "Moderate" | "Low" | null {
  if (elevationM == null || coastKm == null) return null;
  if (elevationM <= high.elev && coastKm <= high.km) return "High";
  if (elevationM <= moderate.elev && coastKm <= moderate.km) return "Moderate";
  return "Low";
}

/** Section scores from a fully assembled city. Missing inputs are LEFT
 *  OUT of each section's average (averageScores skips nulls) rather than
 *  counted as zero - the old live aggregator scored a failed lookup as
 *  "0 restaurants", which dragged real cities' scores down for reasons
 *  that had nothing to do with the city. */
export function computeSectionScores(data: CityExploreData, gniPerCapitaUsd: number | null): SectionScores {
  const e = data.economy;
  const s = data.safetyStability;
  const c = data.climate;
  const l = data.liveability;
  const pisa = [l.pisaMathScore, l.pisaReadingScore, l.pisaScienceScore].filter((v): v is number => v != null);
  const pisaAverage = pisa.length ? pisa.reduce((a, b) => a + b, 0) / pisa.length : null;
  const orNull = (v: number | null, f: (n: number) => number) => (v == null ? null : f(v));

  return {
    economy: averageScores([
      normalise(e.economicGrowth5yrGdpPct, RANGES.gdpGrowth.min, RANGES.gdpGrowth.max),
      normalise(e.unemploymentRatePct, RANGES.unemployment.min, RANGES.unemployment.max, true),
      orNull(gniPerCapitaUsd, (v) => normalise(v, RANGES.salary.min, RANGES.salary.max)),
      100 - e.costOfLivingIndex,
      e.purchasingPowerIndex,
    ]),
    safetyStability: averageScores([
      s.politicalStabilityScore,
      s.ruleOfLawScore,
      normalise(s.homicideRatePer100k, RANGES.homicideRate.min, RANGES.homicideRate.max, true),
    ]),
    climate: averageScores([
      normalise(Math.abs(c.avgAnnualTemperatureC - 20), RANGES.temperatureDistanceFrom20C.min, RANGES.temperatureDistanceFrom20C.max, true),
      normalise(Math.abs(c.avgAnnualRainfallMm - 1000), RANGES.rainfallDistanceFromIdeal.min, RANGES.rainfallDistanceFromIdeal.max, true),
      normalise(c.avgAnnualSunshineHrs, RANGES.sunshineHrs.min, RANGES.sunshineHrs.max),
      normalise(c.avgAnnualSnowfallCm, RANGES.snowfallCm.min, RANGES.snowfallCm.max, true),
    ]),
    liveability: averageScores([
      orNull(l.restaurantsBarsWithin5km, (v) => countScore(v, COUNT_CAPS.restaurantsBars)),
      orNull(l.parksWithin5km, (v) => countScore(v, COUNT_CAPS.parks)),
      orNull(l.culturalVenuesWithin5km, (v) => countScore(v, COUNT_CAPS.cultural)),
      orNull(l.familyActivitiesWithin5km, (v) => countScore(v, COUNT_CAPS.family)),
      l.healthcareQualityScore,
      // Non-participating PISA countries fall back to ~the OECD average so
      // not sitting the test neither rewards nor penalises the score.
      normalise(pisaAverage ?? 470, RANGES.pisaScore.min, RANGES.pisaScore.max),
    ]),
  };
}

/** Merges one city's stored row with its country's record into the exact
 *  CityExploreData shape every page already consumes - pure and cheap
 *  (no I/O), so it runs per request rather than being stored. */
export function assembleCityExploreData(
  countryCode: string,
  city: CityRecord,
  country: CountryRecord,
  datasetGeneratedAt: string,
  totalCities?: number
): CityExploreData {
  const cityAreaKm2 = city.cityAreaKm2;
  const data: CityExploreData = {
    cityId: city.id,
    cityName: city.name,
    region: city.region,
    country: country.name,
    countryCode,
    lat: city.lat,
    lng: city.lng,
    demographics: {
      ...country.demographics,
      cityPopulation: city.population,
      cityAreaKm2,
      cityPopulationDensityPerKm2:
        city.population != null && cityAreaKm2 != null && cityAreaKm2 > 0 ? Number((city.population / cityAreaKm2).toFixed(1)) : null,
    },
    economy: { ...country.economy, mainEconomyType: city.mainEconomyType },
    safetyStability: country.safetyStability,
    climate: {
      avgAnnualTemperatureC: city.avgAnnualTemperatureC ?? 15,
      avgAnnualRainfallMm: city.avgAnnualRainfallMm ?? 700,
      avgAnnualSunshineHrs: city.avgAnnualSunshineHrs ?? 1800,
      avgAnnualSnowfallCm: city.avgAnnualSnowfallCm ?? 0,
      koppenCode: city.koppenCode,
      avgAnnualHumidityPct: city.avgAnnualHumidityPct ?? 60,
      elevationM: city.elevationM,
      avgAnnualPm25: city.avgAnnualPm25,
      avgAnnualUvIndexMax: city.avgAnnualUvIndexMax,
      earthquakeCount50yr: city.earthquakeCount50yr,
      distanceToVolcanoKm: city.distanceToVolcanoKm,
      coastalFloodExposure: exposure(city.elevationM, city.distanceToCoastKm, { elev: 5, km: 2 }, { elev: 15, km: 10 }),
      seaLevelRiseExposure: exposure(city.elevationM, city.distanceToCoastKm, { elev: 2, km: 10 }, { elev: 10, km: 25 }),
      climateReadinessScore: country.climateReadinessScore,
      ...getDaylightRange(city.lat),
    },
    liveability: {
      restaurantsBarsWithin5km: city.restaurantsBarsWithin5km,
      parksWithin5km: city.parksWithin5km,
      culturalVenuesWithin5km: city.culturalVenuesWithin5km,
      familyActivitiesWithin5km: city.familyActivitiesWithin5km,
      healthcareQualityScore: country.healthcareQualityScore ?? 55,
      hasTrainStation: city.hasTrainStation,
      hasSubway: city.hasSubway,
      hasTramway: city.hasTramway,
      hasAirport: city.hasAirport,
      hasBusStation: city.hasBusStation,
      hasSchool: city.hasSchool,
      hasUniversity: city.hasUniversity,
      distanceToBeachKm: city.distanceToBeachKm,
      distanceToMountainKm: city.distanceToMountainKm,
      distanceToForestKm: city.distanceToForestKm,
      distanceToCapitalKm: distanceToCapitalKm(city.lat, city.lng, countryCode),
      lifeExpectancyYears: country.lifeExpectancyYears,
      internetUsersPct: country.internetUsersPct,
      pisaMathScore: country.pisaMathScore,
      pisaReadingScore: country.pisaReadingScore,
      pisaScienceScore: country.pisaScienceScore,
    },
    sectionScores: { economy: 0, safetyStability: 0, climate: 0, liveability: 0 },
    piltriScore: 0,
    lastUpdated: datasetGeneratedAt,
  };
  data.sectionScores = computeSectionScores(data, country.gniPerCapitaUsd);
  data.piltriScore = computePiltriScore(data.sectionScores);
  if (totalCities && city.rankPiltri != null && city.rankEconomy != null && city.rankSafetyStability != null && city.rankClimate != null && city.rankLiveability != null) {
    data.ranks = {
      piltri: city.rankPiltri,
      economy: city.rankEconomy,
      safetyStability: city.rankSafetyStability,
      climate: city.rankClimate,
      liveability: city.rankLiveability,
      outOf: totalCities,
    };
  }
  return data;
}
