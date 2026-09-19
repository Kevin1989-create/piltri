import { getWorldBankIndicators } from "@/lib/data-sources/worldbank";
import { getCountryLanguages } from "@/lib/data-sources/restcountries";
import { getClimateAverages } from "@/lib/data-sources/openmeteo";
import { getEconomySectorCounts, getOverpassCounts, getTransportPresence, pickMainEconomyType } from "@/lib/data-sources/overpass";
import { getHealthcareQualityScore } from "@/lib/data-sources/who";
import { countNotableRestaurants, countRankedUniversities, getCityPopulationAndArea } from "@/lib/data-sources/wikidata";
import { toIso3 } from "@/lib/data-sources/country-codes";
import * as manual from "@/lib/data-sources/manual-sources";
import { averageScores, computePiltriScore, normalise } from "./scoring";
import type { CityExploreData, CitySearchResult } from "@/lib/types";

// Best-effort global reference ranges used to normalise raw metrics onto a
// 0-100 scale. These are reasonable starting points, not scientific
// constants — tune as real data volume grows post-launch.
const RANGES = {
  gdpGrowth: { min: -5, max: 8 },
  unemployment: { min: 0, max: 25 },
  salary: { min: 2000, max: 90000 }, // GNI per capita, USD
  ppp: { min: 2000, max: 120000 },
  restaurantsBarsPer10k: { min: 0, max: 40 },
  culturalVenuesPer10k: { min: 0, max: 10 },
  familyActivitiesPer10k: { min: 0, max: 15 },
  greenSpaceCount: { min: 0, max: 60 },
};

/**
 * Orchestrates every data source into the full CityExploreData payload +
 * computed section scores + weighted Piltri score. This is the function the
 * caching layer calls on a cache miss (Phase 4.4 / 4.5).
 *
 * Demographics is fetched and returned like every other section, but is
 * NOT part of sectionScores/piltriScore — it's supplementary info shown
 * next to the city name on the results page rather than a scored section
 * (a population count doesn't really have a "good/bad" score).
 */
export async function aggregateCityData(city: CitySearchResult): Promise<CityExploreData> {
  const iso3 = toIso3(city.countryCode);

  const [wb, languages, climate, overpass, healthcare, transportPresence, universityCount, restaurantCount, sectorCounts, cityDemo] =
    await Promise.all([
      safely(() => getWorldBankIndicators(city.countryCode), null),
      safely(() => getCountryLanguages(city.countryCode), { officialLanguages: [], mostWidelySpokenLanguage: "Unknown" }),
      safely(() => getClimateAverages(city.lat, city.lng), null),
      safely(() => getOverpassCounts(city.lat, city.lng), null),
      safely(() => getHealthcareQualityScore(iso3), null),
      safely(() => getTransportPresence(city.lat, city.lng), { hasTrainStation: false, hasSubway: false, hasTramway: false, hasAirport: false }),
      safely(() => countRankedUniversities(city.lat, city.lng), 0),
      safely(() => countNotableRestaurants(city.lat, city.lng), 0),
      safely(() => getEconomySectorCounts(city.lat, city.lng), null),
      safely(() => getCityPopulationAndArea(city.lat, city.lng, city.cityName), { population: null, areaKm2: null }),
    ]);

  const mainEconomyType = sectorCounts ? pickMainEconomyType(sectorCounts) : null;

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

  const criminality = manual.getCriminalityScore();
  const criminalityTrend = manual.getCriminalityTrend();
  const geoTension = manual.getGeopoliticalTensionScore();
  const realEstatePrice = manual.getRealEstatePricePerM2();
  const rent = manual.getAvgMonthlyRent1Bed();
  const reTrend = manual.getRealEstateTrend3yr();
  const costOfLiving = manual.getCostOfLivingIndex();
  const disasterRisk = manual.getNaturalDisasterRiskScore();
  const seaLevel = manual.getSeaLevelRiseExposure();
  const extremeWeather = manual.getExtremeWeatherRisk();
  const ndGain = manual.getNdGainScore();
  const schoolQuality = manual.getSchoolQualityScore();
  const englishProficiency = manual.getEnglishProficiencyScore();
  const publicTransport = manual.getPublicTransportScore();

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
      englishProficiencyScore: englishProficiency.value,
      areaKm2: cityDemo.areaKm2,
    },
    economy: {
      economicGrowth5yrGdpPct: wb?.gdpGrowth5yrPct ?? 0,
      averageSalaryGbp: Math.round((wb?.gniPerCapitaUsd ?? 0) * 0.79), // rough USD->GBP
      unemploymentRatePct: wb?.unemploymentRatePct ?? 0,
      economyTypeProfile: {
        // TODO: source real sector-mix data; equal-weighted placeholder for now.
        technologyAndInnovation: 17,
        tourismAndHospitality: 17,
        financeAndServices: 17,
        manufacturingAndIndustry: 17,
        governmentAndPublicSector: 16,
        naturalResourcesAndAgriculture: 16,
      },
      mainEconomyType,
      costOfLivingIndex: costOfLiving.value,
      purchasingPowerIndex: normalise(wb?.purchasingPowerParityGdpPerCapita ?? 0, RANGES.ppp.min, RANGES.ppp.max),
    },
    realEstate: {
      pricePerM2BuyGbp: realEstatePrice.value,
      avgMonthlyRent1BedGbp: rent.value,
      realEstateTrend3yrPct: reTrend.value,
    },
    safetyStability: {
      criminalityScore: criminality.value,
      criminalityTrend: criminalityTrend.value,
      geopoliticalTensionScore: geoTension.value,
    },
    climate: {
      avgAnnualTemperatureC: climate?.avgAnnualTemperatureC ?? 15,
      avgAnnualRainfallMm: climate?.avgAnnualRainfallMm ?? 700,
      avgAnnualSunshineHrs: climate?.avgAnnualSunshineHrs ?? 1800,
      avgAnnualSnowfallCm: climate?.avgAnnualSnowfallCm ?? 0,
      naturalDisasterRiskScore: disasterRisk.value,
      seaLevelRiseExposure: seaLevel.value,
      extremeWeatherRisk: extremeWeather.value,
      ndGainScore: ndGain.value,
    },
    liveability: {
      publicTransportScore: publicTransport.value,
      restaurantsBarsDensityPer10k: overpass ? per10k(overpass.restaurantsBars) : 0,
      greenSpacePctOfCityArea: overpass ? normalise(overpass.greenSpaceCount, RANGES.greenSpaceCount.min, RANGES.greenSpaceCount.max) / 5 : 10,
      culturalVenuesDensityPer10k: overpass ? per10k(overpass.culturalVenues) : 0,
      schoolQualityScore: schoolQuality.value,
      familyKidsActivitiesDensityPer10k: overpass ? per10k(overpass.familyKidsActivities) : 0,
      healthcareQualityScore: healthcare ?? 55,
      hasTrainStation: transportPresence.hasTrainStation,
      hasSubway: transportPresence.hasSubway,
      hasTramway: transportPresence.hasTramway,
      hasAirport: transportPresence.hasAirport,
      worldRankedUniversityCount: universityCount,
      notableRestaurantCount: restaurantCount,
    },
    sectionScores: {
      economy: 0,
      realEstate: 0,
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
      normalise((wb?.gniPerCapitaUsd ?? 0), RANGES.salary.min, RANGES.salary.max),
      100 - data.economy.costOfLivingIndex, // lower cost of living = better score
      data.economy.purchasingPowerIndex,
    ]),
    realEstate: averageScores([
      normalise(data.realEstate.pricePerM2BuyGbp, 500, 12000, true),
      normalise(data.realEstate.avgMonthlyRent1BedGbp, 200, 3000, true),
      normalise(data.realEstate.realEstateTrend3yrPct, -10, 20),
    ]),
    safetyStability: averageScores([
      data.safetyStability.criminalityScore,
      100 - data.safetyStability.geopoliticalTensionScore,
    ]),
    climate: averageScores([
      normalise(Math.abs(data.climate.avgAnnualTemperatureC - 20), 0, 20, true), // closer to 20C scores higher
      100 - data.climate.naturalDisasterRiskScore,
      100 - data.climate.seaLevelRiseExposure,
      100 - data.climate.extremeWeatherRisk,
    ]),
    liveability: averageScores([
      data.liveability.publicTransportScore,
      normalise(data.liveability.restaurantsBarsDensityPer10k, RANGES.restaurantsBarsPer10k.min, RANGES.restaurantsBarsPer10k.max),
      data.liveability.greenSpacePctOfCityArea,
      normalise(data.liveability.culturalVenuesDensityPer10k, RANGES.culturalVenuesPer10k.min, RANGES.culturalVenuesPer10k.max),
      data.liveability.schoolQualityScore,
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
