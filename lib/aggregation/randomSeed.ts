import { averageScores, computePiltriScore, normalise } from "./scoring";
import type { CityExploreData, CitySearchResult, EconomyTypeProfile } from "@/lib/types";

// Same ranges Advanced search itself shows as suggestedRange bounds (see
// lib/advancedSearch/criteria.ts) - random data drawn from these ranges
// means filters return a realistic spread of matches while testing, rather
// than every field clustering around one implausible value.
const LANGUAGES = ["English", "Spanish", "Mandarin", "French", "German", "Portuguese", "Arabic", "Japanese", "Italian", "Dutch"];
const ECONOMY_TYPES: (keyof EconomyTypeProfile)[] = [
  "technologyAndInnovation",
  "tourismAndHospitality",
  "financeAndServices",
  "manufacturingAndIndustry",
  "governmentAndPublicSector",
  "naturalResourcesAndAgriculture",
];
const TRENDS = ["Improving", "Stable", "Worsening"] as const;

function randInt(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}
function randFloat(min: number, max: number, decimals = 1): number {
  return Number((min + Math.random() * (max - min)).toFixed(decimals));
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function chance(p: number): boolean {
  return Math.random() < p;
}

/**
 * Generates a fully-shaped, internally-consistent CityExploreData with
 * random (not fetched) field values - a stand-in for aggregateCityData used
 * purely to test Advanced search's UI/UX (speed, filtering, sorting, cards,
 * map) without waiting on live external APIs for every candidate.
 *
 * Only ever reached via the explicit /api/admin/seed-random-data maintenance
 * endpoint (see that route's doc comment) - never part of the real search
 * path. Section scores are computed with the same scoring.ts helpers
 * (normalise/averageScores/computePiltriScore) real aggregation uses, not
 * just randomised directly, so the resulting Piltri Scores still behave
 * sensibly relative to the raw field values shown on a city's report.
 */
export function randomCityData(city: CitySearchResult): CityExploreData {
  const economicGrowth5yrGdpPct = randFloat(-5, 8);
  const unemploymentRatePct = randFloat(0, 25);
  const averageSalaryGbp = randInt(5000, 100000);
  const costOfLivingIndex = randInt(20, 90);
  const purchasingPowerIndex = randInt(20, 90);

  const pricePerM2BuyGbp = randInt(500, 12000);
  const avgMonthlyRent1BedGbp = randInt(200, 3000);
  const realEstateTrend3yrPct = randFloat(-10, 20);

  const criminalityScore = randInt(20, 95);
  const geopoliticalTensionScore = randInt(5, 70);

  const avgAnnualTemperatureC = randFloat(-5, 32);
  const naturalDisasterRiskScore = randInt(5, 80);
  const seaLevelRiseExposure = randInt(0, 70);
  const extremeWeatherRisk = randInt(5, 75);

  const restaurantsBarsDensityPer10k = randFloat(0, 40, 2);
  const culturalVenuesDensityPer10k = randFloat(0, 10, 2);
  const familyKidsActivitiesDensityPer10k = randFloat(0, 15, 2);

  const data: CityExploreData = {
    cityId: city.cityId,
    cityName: city.cityName,
    region: city.region,
    country: city.country,
    countryCode: city.countryCode,
    lat: city.lat,
    lng: city.lng,

    demographics: {
      population: randInt(1000, 5000000),
      populationDensityPerKm2: randInt(500, 20000),
      populationTrend5yrPct: randFloat(-10, 15),
      averageAge: randInt(25, 48),
      mostWidelySpokenLanguage: pick(LANGUAGES),
      englishProficiencyScore: randInt(20, 95),
      areaKm2: chance(0.9) ? randInt(10, 10000) : null,
    },
    economy: {
      economicGrowth5yrGdpPct,
      averageSalaryGbp,
      unemploymentRatePct,
      economyTypeProfile: {
        // Flat placeholder, same as the real pipeline (aggregate.ts) uses
        // today - not a randomised field, so nothing here regresses once
        // real sector-mix data lands.
        technologyAndInnovation: 17,
        tourismAndHospitality: 17,
        financeAndServices: 17,
        manufacturingAndIndustry: 17,
        governmentAndPublicSector: 16,
        naturalResourcesAndAgriculture: 16,
      },
      mainEconomyType: chance(0.85) ? pick(ECONOMY_TYPES) : null,
      costOfLivingIndex,
      purchasingPowerIndex,
    },
    realEstate: {
      pricePerM2BuyGbp,
      avgMonthlyRent1BedGbp,
      realEstateTrend3yrPct,
    },
    safetyStability: {
      criminalityScore,
      criminalityTrend: pick(TRENDS),
      geopoliticalTensionScore,
    },
    climate: {
      avgAnnualTemperatureC,
      avgAnnualRainfallMm: randInt(0, 2500),
      avgAnnualSunshineHrs: randInt(800, 4000),
      avgAnnualSnowfallCm: chance(0.5) ? 0 : randInt(0, 100),
      naturalDisasterRiskScore,
      seaLevelRiseExposure,
      extremeWeatherRisk,
      ndGainScore: randInt(1, 191),
    },
    liveability: {
      publicTransportScore: randInt(20, 95),
      restaurantsBarsDensityPer10k,
      greenSpacePctOfCityArea: randInt(0, 45),
      culturalVenuesDensityPer10k,
      schoolQualityScore: randInt(30, 95),
      familyKidsActivitiesDensityPer10k,
      healthcareQualityScore: randInt(30, 95),
      hasTrainStation: chance(0.6),
      hasSubway: chance(0.35),
      hasTramway: chance(0.2),
      hasAirport: chance(0.4),
      worldRankedUniversityCount: randInt(0, 8),
      notableRestaurantCount: randInt(0, 15),
    },
    sectionScores: { economy: 0, realEstate: 0, safetyStability: 0, climate: 0, liveability: 0 },
    piltriScore: 0,
    lastUpdated: new Date().toISOString(),
  };

  data.sectionScores = {
    economy: averageScores([
      normalise(economicGrowth5yrGdpPct, -5, 8),
      normalise(unemploymentRatePct, 0, 25, true),
      normalise(averageSalaryGbp, 5000, 100000),
      100 - costOfLivingIndex,
      purchasingPowerIndex,
    ]),
    realEstate: averageScores([
      normalise(pricePerM2BuyGbp, 500, 12000, true),
      normalise(avgMonthlyRent1BedGbp, 200, 3000, true),
      normalise(realEstateTrend3yrPct, -10, 20),
    ]),
    safetyStability: averageScores([criminalityScore, 100 - geopoliticalTensionScore]),
    climate: averageScores([
      normalise(Math.abs(avgAnnualTemperatureC - 20), 0, 20, true),
      100 - naturalDisasterRiskScore,
      100 - seaLevelRiseExposure,
      100 - extremeWeatherRisk,
    ]),
    liveability: averageScores([
      data.liveability.publicTransportScore,
      normalise(restaurantsBarsDensityPer10k, 0, 40),
      data.liveability.greenSpacePctOfCityArea,
      normalise(culturalVenuesDensityPer10k, 0, 10),
      data.liveability.schoolQualityScore,
      normalise(familyKidsActivitiesDensityPer10k, 0, 15),
      data.liveability.healthcareQualityScore,
    ]),
  };

  data.piltriScore = computePiltriScore(data.sectionScores);
  return data;
}
