import { getDaylightRange } from "@/lib/data-sources/daylight";
import { averageScores, computePiltriScore, normalise } from "@/lib/aggregation/scoring";
import type { CityExploreData, SectionKey, SectionScores } from "@/lib/types";
import { INSIDE_KINDS, type CityRecord, type CountryRecord, type InsideKind } from "./schema";

/** Whether there's one in the city (or within 1 km of it) - null for a
 *  dataset from before 2026-10-29. */
const inCity = (city: CityRecord, kind: InsideKind): boolean | null =>
  city.insideCounts ? (city.insideCounts[INSIDE_KINDS.indexOf(kind)] ?? 0) !== 0 : null;

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

/** Amenities are shown and scored per resident: the places within 5 km of
 *  the centre per 1,000 people living within those 5 km (GHS-POP) - per
 *  10,000 for the rarer kinds, so they don't all read "0.0". `cap` scores
 *  100 on logScore: about the 95th percentile of all places (calibrated
 *  2026-09-28 - median / 95th: eating 1.5 / 6.8 per 1,000; parks 0.7 / 6.4,
 *  cultural 0.4 / 5.6, family 0 / 1.4 per 10,000). kpiRows.ts colours with
 *  the same scale. */
export const AMENITY_RATIOS = {
  restaurantsBars: { per: 1000, cap: 7 },
  parks: { per: 10000, cap: 6 },
  cultural: { per: 10000, cap: 5 },
  family: { per: 10000, cap: 1.5 },
};

/** Small islands the population grid undercounts are treated as having at
 *  least this many residents, so a handful of places can't produce an
 *  absurd ratio. */
const MIN_RESIDENTS = 1000;

/** People living within 5 km of the centre, from the density over that area. */
export function residentsWithin5km(densityPerKm2: number | null): number | null {
  return densityPerKm2 == null ? null : Math.round(densityPerKm2 * Math.PI * 25);
}

function perResidents(count: number | null, densityPerKm2: number | null, per: number): number | null {
  const residents = residentsWithin5km(densityPerKm2);
  if (count == null || residents == null) return null;
  return Math.round((count / Math.max(residents, MIN_RESIDENTS)) * per * 10) / 10;
}

/** 0-100 on a log scale, `cap` scoring 100: each doubling counts about the
 *  same, so the step from none to a few matters more than from many to
 *  more. */
export function logScore(value: number, cap: number): number {
  return normalise(Math.log10(1 + value), 0, Math.log10(1 + cap));
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
      orNull(l.restaurantsBarsPer1k, (v) => logScore(v, AMENITY_RATIOS.restaurantsBars.cap)),
      orNull(l.parksPer10k, (v) => logScore(v, AMENITY_RATIOS.parks.cap)),
      orNull(l.culturalVenuesPer10k, (v) => logScore(v, AMENITY_RATIOS.cultural.cap)),
      orNull(l.familyActivitiesPer10k, (v) => logScore(v, AMENITY_RATIOS.family.cap)),
      l.healthcareQualityScore,
      // Countries that don't sit PISA get ~the OECD average, so not
      // participating neither rewards nor penalises them.
      normalise(pisaAverage ?? 470, RANGES.pisaScore.min, RANGES.pisaScore.max),
    ],
  };
}

const SECTION_KEYS: SectionKey[] = ["economy", "safetyStability", "climate", "liveability"];

/** A section is scored only from at least half its figures (2026-10-11):
 *  an average of one or two misleads - North Korea's economy, from its
 *  unemployment rate alone, scored 86. */
export function hasEnoughFigures(values: (number | null)[]): boolean {
  const known = values.filter((v) => v != null && !Number.isNaN(v)).length;
  return known >= Math.ceil(values.length / 2);
}

/** Section scores. Missing inputs are left out of a section's average
 *  (averageScores skips nulls) rather than counted as zero. A section
 *  without enough figures (hasEnoughFigures) scores a neutral 50 - so the
 *  overall score isn't skewed - and is listed in `withoutData`, which the
 *  pages show as "No data". */
function scoreSections(data: CityExploreData, gniPerCapitaUsd: number | null): { scores: SectionScores; withoutData: SectionKey[] } {
  const inputs = sectionInputs(data, gniPerCapitaUsd);
  const withoutData = SECTION_KEYS.filter((key) => !hasEnoughFigures(inputs[key]));
  const score = (key: SectionKey) => (withoutData.includes(key) ? 50 : averageScores(inputs[key]));
  return {
    scores: {
      economy: score("economy"),
      safetyStability: score("safetyStability"),
      climate: score("climate"),
      liveability: score("liveability"),
    },
    withoutData,
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
    countryFiguresFrom: country.figuresFrom ?? null,
    lat: city.lat,
    lng: city.lng,
    demographics: {
      ...country.demographics,
      cityPopulation: city.population,
      cityDensityPerKm2: city.densityPerKm2,
      timezone: city.timezone,
      cityMedianAge: city.medianAge ?? null,
      cityPopulationGrowth5yrPct: city.populationGrowth5yrPct ?? null,
    },
    economy: {
      ...country.economy,
      regionGdpPerHeadPpp: city.regionGdpPerHeadPpp ?? null,
      regionGdpYear: city.regionGdpYear ?? null,
      regionGdpVsNationalPct: city.regionGdpVsNationalPct ?? null,
    },
    safetyStability: {
      ...country.safetyStability,
      conflictEvents5yr: city.conflictEvents5yr ?? null,
      conflictDeaths5yr: city.conflictDeaths5yr ?? null,
    },
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
      restaurantsBarsPer1k: perResidents(city.restaurantsBarsWithin5km, city.densityPerKm2, AMENITY_RATIOS.restaurantsBars.per),
      parksPer10k: perResidents(city.parksWithin5km, city.densityPerKm2, AMENITY_RATIOS.parks.per),
      culturalVenuesPer10k: perResidents(city.culturalVenuesWithin5km, city.densityPerKm2, AMENITY_RATIOS.cultural.per),
      familyActivitiesPer10k: perResidents(city.familyActivitiesWithin5km, city.densityPerKm2, AMENITY_RATIOS.family.per),
      healthcareQualityScore: country.healthcareQualityScore,
      // In the city (or within 1 km of it) where the dataset says so
      // (2026-10-29), as the city page does - Advanced search filters on
      // these; within 5 km of the centre before.
      hasTrainStation: inCity(city, "train") ?? city.hasTrainStation,
      hasSubway: inCity(city, "metro") ?? city.hasSubway,
      hasTramway: inCity(city, "tram") ?? city.hasTramway,
      hasAirport: city.hasAirport,
      hasBusStation: inCity(city, "bus") ?? city.hasBusStation,
      hasSchool: inCity(city, "school") ?? city.hasSchool,
      hasUniversity: inCity(city, "university") ?? city.hasUniversity,
      hasNursery: inCity(city, "nursery") ?? city.hasNursery,
      hasCareHome: inCity(city, "careHome") ?? city.hasCareHome,
      hasPort: inCity(city, "port") ?? city.hasPort,
      hasHospital: inCity(city, "hospital"),
      broadbandDownloadMbps: city.broadbandDownloadMbps,
      broadbandRadiusKm: city.broadbandRadiusKm,
      mobileDownloadMbps: city.mobileDownloadMbps,
      mobileRadiusKm: city.mobileRadiusKm,
      distanceToBeachKm: city.distanceToBeachKm,
      distanceToLakeBeachKm: city.distanceToLakeBeachKm ?? null,
      distanceToMountainKm: city.distanceToMountainKm,
      distanceToForestKm: city.distanceToForestKm,
      distanceToCapitalKm: city.distanceToCapitalKm,
      distanceToAirportKm: city.distanceToAirportKm,
      distanceToIntlAirportKm: city.distanceToIntlAirportKm ?? null,
      distanceToLocalAirportKm: city.distanceToLocalAirportKm ?? null,
      distanceToTrainStationKm: city.distanceToTrainStationKm,
      distanceToHospitalKm: city.distanceToHospitalKm ?? null,
      inside: city.insideCounts
        ? Object.fromEntries(INSIDE_KINDS.map((kind, k) => [kind, { count: city.insideCounts![k] ?? 0, nearestKm: city.insideNearestKm?.[k] ?? null }]))
        : undefined,
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

/** Roads run ~30% longer than the straight line. */
export const ROAD_DETOUR_FACTOR = 1.3;

/** Estimated minutes by car for a straight-line distance - there's no
 *  routing engine (by design: no live API), so it's a disclosed estimate:
 *  roads ~30% longer, the first 10 km at ~30 km/h (town), the next 40 at
 *  ~60, the rest at ~100 (main roads) - Paris to the coast (149 km) comes
 *  out at ~2 h 25 (real: ~2 h 15). Used by the distance rows, pin mode,
 *  directions and the "distance from city centre" filters alike. */
export function driveMinutes(straightKm: number | null): number | null {
  if (straightKm == null) return null;
  const road = straightKm * ROAD_DETOUR_FACTOR;
  const town = Math.min(road, 10);
  const regional = Math.min(Math.max(road - 10, 0), 40);
  const main = Math.max(road - 50, 0);
  return Math.max(1, Math.round((town / 30 + regional / 60 + main / 100) * 60));
}

/** "25 min" / "1 h 35 min" / "4 h" - rounded to 5 minutes past an hour. */
export function formatDriveTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const rounded = Math.round(minutes / 5) * 5;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
