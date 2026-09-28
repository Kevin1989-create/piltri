import { getDaylightRange } from "@/lib/data-sources/daylight";
import { averageScores, computePiltriScore, normalise } from "@/lib/aggregation/scoring";
import type { CityExploreData, SectionKey, SectionScores } from "@/lib/types";
import type { CityRecord, CountryRecord } from "./schema";

/** Reference ranges that normalise raw metrics onto 0-100 for the section
 *  scores. kpiRows.ts colours rows against the same ranges. */
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
  /** WHO's guideline is 5 µg/m³; 50+ (Delhi, Lahore, Dhaka) scores 0. */
  pm25: { min: 5, max: 50 },
  pisaScore: { min: 350, max: 590 },
};

/** Amenity counts within 5 km run from 0 to tens of thousands (a village
 *  vs central London), so they're scored on a log scale: each order of
 *  magnitude counts the same. `cap` scores 100 - roughly the 95th
 *  percentile across cities of 100k+ people (calibrated 2026-09-26: eating
 *  3,286 / cultural 171 / family 28 / parks 145). A median town (36 places
 *  to eat) scores ~45; 600 scores ~80. kpiRows.ts colours with the same
 *  function. */
export const COUNT_CAPS = { restaurantsBars: 3000, cultural: 200, family: 30, parks: 150 };

export function countScore(count: number, cap: number): number {
  return normalise(Math.log10(1 + count), 0, Math.log10(1 + cap));
}

/** Coastal flood / sea-level-rise exposure proxies (see ClimateFields).
 *  Null (not "Low") when an input is missing. */
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

/** Each section's 0-100 sub-scores, null where the input is missing. */
function sectionInputs(data: CityExploreData, gniPerCapitaUsd: number | null): Record<SectionKey, (number | null)[]> {
  const e = data.economy;
  const s = data.safetyStability;
  const c = data.climate;
  const l = data.liveability;
  const pisa = [l.pisaMathScore, l.pisaReadingScore, l.pisaScienceScore].filter((v): v is number => v != null);
  const pisaAverage = pisa.length ? pisa.reduce((a, b) => a + b, 0) / pisa.length : null;
  const orNull = (v: number | null, f: (n: number) => number) => (v == null ? null : f(v));

  return {
    economy: [
      orNull(e.economicGrowth5yrGdpPct, (v) => normalise(v, RANGES.gdpGrowth.min, RANGES.gdpGrowth.max)),
      orNull(e.unemploymentRatePct, (v) => normalise(v, RANGES.unemployment.min, RANGES.unemployment.max, true)),
      orNull(gniPerCapitaUsd, (v) => normalise(v, RANGES.salary.min, RANGES.salary.max)),
      orNull(e.costOfLivingIndex, (v) => 100 - v),
      e.purchasingPowerIndex,
    ],
    safetyStability: [
      s.politicalStabilityScore,
      s.ruleOfLawScore,
      orNull(s.homicideRatePer100k, (v) => normalise(v, RANGES.homicideRate.min, RANGES.homicideRate.max, true)),
    ],
    climate: [
      orNull(c.avgAnnualTemperatureC, (v) => normalise(Math.abs(v - 20), RANGES.temperatureDistanceFrom20C.min, RANGES.temperatureDistanceFrom20C.max, true)),
      orNull(c.avgAnnualRainfallMm, (v) => normalise(Math.abs(v - 1000), RANGES.rainfallDistanceFromIdeal.min, RANGES.rainfallDistanceFromIdeal.max, true)),
      orNull(c.avgAnnualSunshineHrs, (v) => normalise(v, RANGES.sunshineHrs.min, RANGES.sunshineHrs.max)),
      orNull(c.avgAnnualSnowfallCm, (v) => normalise(v, RANGES.snowfallCm.min, RANGES.snowfallCm.max, true)),
      orNull(c.avgAnnualPm25, (v) => normalise(v, RANGES.pm25.min, RANGES.pm25.max, true)),
    ],
    liveability: [
      orNull(l.restaurantsBarsWithin5km, (v) => countScore(v, COUNT_CAPS.restaurantsBars)),
      orNull(l.parksWithin5km, (v) => countScore(v, COUNT_CAPS.parks)),
      orNull(l.culturalVenuesWithin5km, (v) => countScore(v, COUNT_CAPS.cultural)),
      orNull(l.familyActivitiesWithin5km, (v) => countScore(v, COUNT_CAPS.family)),
      l.healthcareQualityScore,
      // Countries that don't sit PISA get ~the OECD average, so not
      // participating neither rewards nor penalises them.
      normalise(pisaAverage ?? 470, RANGES.pisaScore.min, RANGES.pisaScore.max),
    ],
  };
}

const SECTION_KEYS: SectionKey[] = ["economy", "safetyStability", "climate", "liveability"];

/** Section scores. Missing inputs are left out of a section's average
 *  (averageScores skips nulls) rather than counted as zero. A section with
 *  no inputs at all scores a neutral 50 - so the overall score isn't
 *  skewed - and is listed in `withoutData`, which the pages show as
 *  "No data". */
function scoreSections(data: CityExploreData, gniPerCapitaUsd: number | null): { scores: SectionScores; withoutData: SectionKey[] } {
  const inputs = sectionInputs(data, gniPerCapitaUsd);
  return {
    scores: {
      economy: averageScores(inputs.economy),
      safetyStability: averageScores(inputs.safetyStability),
      climate: averageScores(inputs.climate),
      liveability: averageScores(inputs.liveability),
    },
    withoutData: SECTION_KEYS.filter((key) => inputs[key].every((v) => v == null)),
  };
}

/** Merges one city's row with its country's record into the CityExploreData
 *  shape every page consumes - pure and cheap, so it runs in the browser
 *  (and in the pipeline, for ranks and Advanced Search columns). */
export function assembleCityExploreData(
  countryCode: string,
  city: CityRecord,
  country: CountryRecord,
  datasetGeneratedAt: string,
  totalCities?: number
): CityExploreData {
  const monthly =
    city.monthlyHighC && city.monthlyLowC && city.monthlyRainMm
      ? { highC: city.monthlyHighC, lowC: city.monthlyLowC, rainMm: city.monthlyRainMm }
      : null;
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
      cityDensityPerKm2: city.densityPerKm2,
      timezone: city.timezone,
    },
    economy: country.economy,
    safetyStability: country.safetyStability,
    climate: {
      avgAnnualTemperatureC: city.avgAnnualTemperatureC,
      avgAnnualRainfallMm: city.avgAnnualRainfallMm,
      avgAnnualSunshineHrs: city.avgAnnualSunshineHrs,
      avgAnnualSnowfallCm: city.avgAnnualSnowfallCm,
      koppenCode: city.koppenCode,
      koppenCode2085: city.koppenCode2085,
      avgAnnualHumidityPct: city.avgAnnualHumidityPct,
      hottestMonthHighC: city.hottestMonthHighC,
      coldestMonthLowC: city.coldestMonthLowC,
      monthly,
      elevationM: city.elevationM,
      avgAnnualPm25: city.avgAnnualPm25 ?? country.pm25NationalEstimate,
      avgAnnualPm25IsNational: city.avgAnnualPm25 == null && country.pm25NationalEstimate != null,
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
      healthcareQualityScore: country.healthcareQualityScore,
      hasTrainStation: city.hasTrainStation,
      hasSubway: city.hasSubway,
      hasTramway: city.hasTramway,
      hasAirport: city.hasAirport,
      hasBusStation: city.hasBusStation,
      hasSchool: city.hasSchool,
      hasUniversity: city.hasUniversity,
      broadbandDownloadMbps: city.broadbandDownloadMbps,
      broadbandRadiusKm: city.broadbandRadiusKm,
      mobileDownloadMbps: city.mobileDownloadMbps,
      mobileRadiusKm: city.mobileRadiusKm,
      distanceToBeachKm: city.distanceToBeachKm,
      distanceToMountainKm: city.distanceToMountainKm,
      distanceToForestKm: city.distanceToForestKm,
      distanceToCapitalKm: city.distanceToCapitalKm,
      distanceToAirportKm: city.distanceToAirportKm,
      distanceToTrainStationKm: city.distanceToTrainStationKm,
      nearestLargeCity:
        city.nearestLargeCityName != null && city.nearestLargeCityKm != null
          ? { name: city.nearestLargeCityName, km: city.nearestLargeCityKm }
          : null,
      lifeExpectancyYears: country.lifeExpectancyYears,
      internetUsersPct: country.internetUsersPct,
      pisaMathScore: country.pisaMathScore,
      pisaReadingScore: country.pisaReadingScore,
      pisaScienceScore: country.pisaScienceScore,
    },
    sectionScores: { economy: 0, safetyStability: 0, climate: 0, liveability: 0 },
    sectionsWithoutData: [],
    piltriScore: 0,
    lastUpdated: datasetGeneratedAt,
  };
  const { scores, withoutData } = scoreSections(data, country.gniPerCapitaUsd);
  data.sectionScores = scores;
  data.sectionsWithoutData = withoutData;
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

/** Straight-line km -> rough minutes at ~30 km/h average local travel -
 *  the disclosed estimate pin mode and the "distance from city centre"
 *  filters both use (there's no routing engine). */
export function kmToMinutes(km: number | null): number | null {
  return km == null ? null : Math.round((km / 30) * 60);
}
