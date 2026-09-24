import { averageScores, computePiltriScore, normalise } from "./scoring";
import type { CityExploreData, CitySearchResult, EconomyTypeProfile, GdpSector } from "@/lib/types";

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
const GDP_SECTORS: GdpSector[] = ["Agriculture", "Industry", "Services"];
const KOPPEN_CODES = ["Af", "Am", "Aw", "BWh", "BWk", "BSh", "BSk", "Csa", "Csb", "Cfa", "Cfb", "Dfa", "Dfb", "Dfc", "ET"];

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
  const economicGrowth5yrGdpPct = randFloat(-10, 40); // cumulative ~6yr growth, matches aggregate.ts's RANGES.gdpGrowth
  const unemploymentRatePct = randFloat(0, 25);
  const averageSalaryGbp = randInt(5000, 100000);
  const costOfLivingIndex = randInt(20, 90);
  const purchasingPowerIndex = randInt(20, 90);

  const politicalStabilityScore = randInt(20, 95);
  const ruleOfLawScore = randInt(20, 95);
  const homicideRatePer100k = randFloat(0, 15);

  const avgAnnualTemperatureC = randFloat(-5, 32);
  const avgAnnualRainfallMm = randInt(0, 2500);
  const avgAnnualSunshineHrs = randInt(800, 4000);
  const avgAnnualSnowfallCm = chance(0.5) ? 0 : randInt(0, 100);

  const restaurantsBarsDensityPer10k = randFloat(0, 30, 2);
  const culturalVenuesDensityPer10k = randFloat(0, 3, 2);
  const familyKidsActivitiesDensityPer10k = randFloat(0, 15, 2);
  const healthcareQualityScore = randInt(30, 95);

  const data: CityExploreData = {
    cityId: city.cityId,
    cityName: city.cityName,
    region: city.region,
    country: city.country,
    countryCode: city.countryCode,
    lat: city.lat,
    lng: city.lng,

    demographics: (() => {
      // Country fields: near-universal in reality (see
      // lib/data-sources/worldbank.ts / medianAge.ts / languages.ts), so
      // present ~97% of the time here too. City fields (Wikidata,
      // exact-label match) resolve for roughly 70% of real cities - see
      // lib/data-sources/wikidata.ts's doc comment - mirrored here so
      // Advanced search's "Not available" handling gets exercised too,
      // not just the happy path.
      const cityPopulation = chance(0.7) ? randInt(1000, 5000000) : null;
      const cityAreaKm2 = chance(0.7) ? randInt(10, 10000) : null;
      return {
        countryPopulation: chance(0.97) ? randInt(500000, 1400000000) : null,
        countryPopulationDensityPerKm2: chance(0.97) ? randInt(2, 500) : null,
        countryLandAreaKm2: chance(0.97) ? randInt(300, 17000000) : null,
        countryAverageAge: chance(0.97) ? randFloat(15, 49, 1) : null,
        countryPopulationTrend5yrPct: chance(0.97) ? randFloat(-10, 15) : null,
        countryMostWidelySpokenLanguage: pick(LANGUAGES),
        cityPopulation,
        cityAreaKm2,
        cityPopulationDensityPerKm2: cityPopulation != null && cityAreaKm2 != null ? Number((cityPopulation / cityAreaKm2).toFixed(1)) : null,
      };
    })(),
    economy: {
      economicGrowth5yrGdpPct,
      averageSalaryGbp,
      unemploymentRatePct,
      mainEconomyType: chance(0.85) ? pick(ECONOMY_TYPES) : null,
      gdpSectorRanking: chance(0.97)
        ? GDP_SECTORS.map((sector) => ({ sector, sharePct: randFloat(1, 80) })).sort((a, b) => b.sharePct - a.sharePct)
        : [],
      costOfLivingIndex,
      purchasingPowerIndex,
    },
    safetyStability: {
      politicalStabilityScore,
      ruleOfLawScore,
      safetyTrend: pick(TRENDS),
      homicideRatePer100k,
    },
    climate: {
      avgAnnualTemperatureC,
      avgAnnualRainfallMm,
      avgAnnualSunshineHrs,
      avgAnnualSnowfallCm,
      distanceToBeachKm: chance(0.85) ? randFloat(1, 400) : null,
      distanceToMountainKm: chance(0.85) ? randFloat(1, 300) : null,
      koppenCode: chance(0.95) ? pick(KOPPEN_CODES) : null,
      avgAnnualHumidityPct: randInt(30, 90),
      elevationM: chance(0.95) ? randInt(0, 2500) : null,
      avgAnnualPm25: chance(0.9) ? randFloat(3, 60) : null,
      avgAnnualUvIndexMax: chance(0.9) ? randFloat(2, 11) : null,
    },
    liveability: {
      restaurantsBarsDensityPer10k,
      greenSpaceScore: randInt(0, 100),
      culturalVenuesDensityPer10k,
      familyKidsActivitiesDensityPer10k,
      healthcareQualityScore,
      hasTrainStation: chance(0.6),
      hasSubway: chance(0.35),
      hasTramway: chance(0.2),
      hasAirport: chance(0.4),
    },
    sectionScores: { economy: 0, safetyStability: 0, climate: 0, liveability: 0 },
    piltriScore: 0,
    lastUpdated: new Date().toISOString(),
  };

  data.sectionScores = {
    economy: averageScores([
      normalise(economicGrowth5yrGdpPct, -10, 40),
      normalise(unemploymentRatePct, 0, 25, true),
      normalise(averageSalaryGbp, 5000, 100000),
      100 - costOfLivingIndex,
      purchasingPowerIndex,
    ]),
    safetyStability: averageScores([politicalStabilityScore, ruleOfLawScore, normalise(homicideRatePer100k, 0, 30, true)]),
    climate: averageScores([
      normalise(Math.abs(avgAnnualTemperatureC - 20), 0, 20, true),
      normalise(Math.abs(avgAnnualRainfallMm - 1000), 0, 1000, true),
      normalise(avgAnnualSunshineHrs, 1200, 3800),
      normalise(avgAnnualSnowfallCm, 0, 300, true),
    ]),
    liveability: averageScores([
      normalise(restaurantsBarsDensityPer10k, 0, 30),
      data.liveability.greenSpaceScore,
      normalise(culturalVenuesDensityPer10k, 0, 3),
      normalise(familyKidsActivitiesDensityPer10k, 0, 15),
      healthcareQualityScore,
    ]),
  };

  data.piltriScore = computePiltriScore(data.sectionScores);
  return data;
}
