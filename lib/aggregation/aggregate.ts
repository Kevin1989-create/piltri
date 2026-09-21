import { getWorldBankIndicators } from "@/lib/data-sources/worldbank";
import { getCountryLanguages } from "@/lib/data-sources/languages";
import { getClimateAverages } from "@/lib/data-sources/openmeteo";
import { getCityOverpassData, pickMainEconomyType } from "@/lib/data-sources/overpass";
import { getHealthcareQualityScore } from "@/lib/data-sources/who";
import { getCityPopulationAndArea } from "@/lib/data-sources/wikidata";
import { toIso3 } from "@/lib/data-sources/country-codes";
import { memoize } from "./memoryCache";
import { averageScores, computePiltriScore, normalise } from "./scoring";
import type { CityExploreData, CitySearchResult } from "@/lib/types";

// World Bank and WHO are both country-level, not city-level — many cities
// in a batch (warm-cache scanning hundreds/thousands of candidates, or
// Advanced search's country-scope rollup) share the same country, so
// memoizing these by country code avoids repeating an identical API call
// once per city. 24h is plenty (these values only ever change annually at
// most) and keeps this simple - it's a same-process cache, so it also
// naturally resets between deploys rather than needing its own TTL logic.
const COUNTRY_LEVEL_TTL_MS = 24 * 60 * 60 * 1000;

// Best-effort global reference ranges used to normalise raw metrics onto a
// 0-100 scale. These are reasonable starting points, not scientific
// constants — tune as real data volume grows post-launch. Rainfall/
// sunshine/snowfall match the identical ranges kpiRows.ts colours those same
// stats with, so the KPI display and the actual score always agree on
// what counts as "good" for a given city.
const RANGES = {
  gdpGrowth: { min: -5, max: 8 },
  unemployment: { min: 0, max: 25 },
  salary: { min: 2000, max: 90000 }, // GNI per capita, USD
  ppp: { min: 2000, max: 120000 },
  // World Bank's Price Level Index (PA.NUS.PRVT.PLI) — verified real-world
  // spread runs from ~India (23) to ~Switzerland (128).
  priceLevel: { min: 15, max: 130 },
  restaurantsBarsPer10k: { min: 0, max: 40 },
  culturalVenuesPer10k: { min: 0, max: 10 },
  familyActivitiesPer10k: { min: 0, max: 15 },
  greenSpaceCount: { min: 0, max: 60 },
  temperatureDistanceFrom20C: { min: 0, max: 20 },
  rainfallDistanceFromIdeal: { min: 0, max: 1000 }, // ideal centre: 1000mm/yr
  sunshineHrs: { min: 1200, max: 3800 },
  snowfallCm: { min: 0, max: 300 },
};

/**
 * Orchestrates every data source into the full CityExploreData payload +
 * computed section scores + weighted Piltri score. This is the function the
 * caching layer calls on a cache miss (Phase 4.4 / 4.5).
 *
 * Demographics is fetched and returned like every other section, but is
 * NOT part of sectionScores/piltriScore — it's supplementary info shown
 * next to the city name on the results page rather than a scored section
 * (a population count doesn't really have a "good/bad" score). Real Estate
 * has no field here at all — see lib/types.ts's file header comment for why.
 */
export async function aggregateCityData(city: CitySearchResult): Promise<CityExploreData> {
  const iso3 = toIso3(city.countryCode);

  const [wb, languages, climate, overpassData, healthcare, cityDemo] = await Promise.all([
    safely(() => memoize(`wb:${city.countryCode}`, COUNTRY_LEVEL_TTL_MS, () => getWorldBankIndicators(city.countryCode)), null),
    safely(() => getCountryLanguages(city.countryCode), { officialLanguages: [], mostWidelySpokenLanguage: "Unknown" }),
    safely(() => getClimateAverages(city.lat, city.lng), null),
    // One Overpass request covering amenity density, transport presence,
    // and economy-sector counts together - was 14 separate requests (see
    // getCityOverpassData's doc comment).
    safely(() => getCityOverpassData(city.lat, city.lng), null),
    safely(() => memoize(`who:${iso3}`, COUNTRY_LEVEL_TTL_MS, () => getHealthcareQualityScore(iso3)), null),
    safely(() => getCityPopulationAndArea(city.lat, city.lng, city.cityName), { population: null, areaKm2: null }),
  ]);

  const transportPresence = overpassData?.transport ?? { hasTrainStation: false, hasSubway: false, hasTramway: false, hasAirport: false };
  const mainEconomyType = overpassData ? pickMainEconomyType(overpassData.economySectors) : null;

  // Country-level population from World Bank - kept under its own name
  // (rather than reused for demographics.population below) because the
  // liveability per10k density stats further down are calibrated against
  // this country total, not the new city-level figure.
  const population = wb?.population ?? 0;
  const per10k = (count: number) => (population > 0 ? Number(((count / population) * 10000).toFixed(2)) : 0);

  // Demographics population/density: prefer the genuinely city-level
  // Wikidata match, falling back to the World Bank country figure only on
  // a miss. Density never mixes a country population with a city area or
  // vice versa - it's only computed from the two paired city-level
  // figures; otherwise it falls back to the World Bank country density.
  // Both are shown as city-level in the UI regardless (see CityHeader.tsx).
  const resolvedPopulation = cityDemo.population ?? population;
  const resolvedDensityPerKm2 =
    cityDemo.population != null && cityDemo.areaKm2 != null
      ? Number((cityDemo.population / cityDemo.areaKm2).toFixed(1))
      : wb?.populationDensityPerKm2 ?? 0;

  // Cost of living: World Bank's real Price Level Index, normalised onto
  // the same 0-100 "index" scale the UI has always shown (see
  // RANGES.priceLevel). Falls back to a neutral 50 only when the country
  // genuinely has no published figure.
  const costOfLivingIndex = wb?.priceLevelIndex != null ? normalise(wb.priceLevelIndex, RANGES.priceLevel.min, RANGES.priceLevel.max) : 50;

  const data: CityExploreData = {
    cityId: city.cityId,
    cityName: city.cityName,
    region: city.region,
    country: city.country,
    countryCode: city.countryCode,
    lat: city.lat,
    lng: city.lng,

    demographics: {
      population: resolvedPopulation,
      populationDensityPerKm2: resolvedDensityPerKm2,
      populationTrend5yrPct: wb?.populationTrend5yrPct ?? 0,
      averageAge: wb?.medianAgeProxy ?? 38, // world median-ish default until sourced
      mostWidelySpokenLanguage: languages.mostWidelySpokenLanguage,
      areaKm2: cityDemo.areaKm2,
    },
    economy: {
      economicGrowth5yrGdpPct: wb?.gdpGrowth5yrPct ?? 0,
      averageSalaryGbp: Math.round((wb?.gniPerCapitaUsd ?? 0) * 0.79), // rough USD->GBP
      unemploymentRatePct: wb?.unemploymentRatePct ?? 0,
      mainEconomyType,
      costOfLivingIndex,
      purchasingPowerIndex: normalise(wb?.purchasingPowerParityGdpPerCapita ?? 0, RANGES.ppp.min, RANGES.ppp.max),
    },
    safetyStability: {
      politicalStabilityScore: wb?.politicalStabilityScore != null ? Math.round(wb.politicalStabilityScore) : 50,
      ruleOfLawScore: wb?.ruleOfLawScore != null ? Math.round(wb.ruleOfLawScore) : 50,
      safetyTrend: wb?.politicalStabilityTrend ?? "Stable",
    },
    climate: {
      avgAnnualTemperatureC: climate?.avgAnnualTemperatureC ?? 15,
      avgAnnualRainfallMm: climate?.avgAnnualRainfallMm ?? 700,
      avgAnnualSunshineHrs: climate?.avgAnnualSunshineHrs ?? 1800,
      avgAnnualSnowfallCm: climate?.avgAnnualSnowfallCm ?? 0,
    },
    liveability: {
      restaurantsBarsDensityPer10k: overpassData ? per10k(overpassData.raw.restaurantsBars) : 0,
      greenSpacePctOfCityArea: overpassData
        ? normalise(overpassData.raw.greenSpaceCount, RANGES.greenSpaceCount.min, RANGES.greenSpaceCount.max) / 5
        : 10,
      culturalVenuesDensityPer10k: overpassData ? per10k(overpassData.raw.culturalVenues) : 0,
      familyKidsActivitiesDensityPer10k: overpassData ? per10k(overpassData.raw.familyKidsActivities) : 0,
      healthcareQualityScore: healthcare ?? 55,
      hasTrainStation: transportPresence.hasTrainStation,
      hasSubway: transportPresence.hasSubway,
      hasTramway: transportPresence.hasTramway,
      hasAirport: transportPresence.hasAirport,
    },
    sectionScores: {
      economy: 0,
      safetyStability: 0,
      climate: 0,
      liveability: 0,
    },
    piltriScore: 0,
    lastUpdated: new Date().toISOString(),
  };

  data.sectionScores = {
    economy: averageScores([
      normalise(data.economy.economicGrowth5yrGdpPct, RANGES.gdpGrowth.min, RANGES.gdpGrowth.max),
      normalise(data.economy.unemploymentRatePct, RANGES.unemployment.min, RANGES.unemployment.max, true),
      normalise(wb?.gniPerCapitaUsd ?? 0, RANGES.salary.min, RANGES.salary.max),
      100 - data.economy.costOfLivingIndex, // lower cost of living = better score
      data.economy.purchasingPowerIndex,
    ]),
    safetyStability: averageScores([data.safetyStability.politicalStabilityScore, data.safetyStability.ruleOfLawScore]),
    climate: averageScores([
      normalise(Math.abs(data.climate.avgAnnualTemperatureC - 20), RANGES.temperatureDistanceFrom20C.min, RANGES.temperatureDistanceFrom20C.max, true), // closer to 20C scores higher
      normalise(
        Math.abs(data.climate.avgAnnualRainfallMm - 1000),
        RANGES.rainfallDistanceFromIdeal.min,
        RANGES.rainfallDistanceFromIdeal.max,
        true
      ),
      normalise(data.climate.avgAnnualSunshineHrs, RANGES.sunshineHrs.min, RANGES.sunshineHrs.max),
      normalise(data.climate.avgAnnualSnowfallCm, RANGES.snowfallCm.min, RANGES.snowfallCm.max, true),
    ]),
    liveability: averageScores([
      normalise(data.liveability.restaurantsBarsDensityPer10k, RANGES.restaurantsBarsPer10k.min, RANGES.restaurantsBarsPer10k.max),
      data.liveability.greenSpacePctOfCityArea,
      normalise(data.liveability.culturalVenuesDensityPer10k, RANGES.culturalVenuesPer10k.min, RANGES.culturalVenuesPer10k.max),
      normalise(data.liveability.familyKidsActivitiesDensityPer10k, RANGES.familyActivitiesPer10k.min, RANGES.familyActivitiesPer10k.max),
      data.liveability.healthcareQualityScore,
    ]),
  };

  data.piltriScore = computePiltriScore(data.sectionScores);

  return data;
}

async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("Data source failed, using fallback:", err);
    return fallback;
  }
}

