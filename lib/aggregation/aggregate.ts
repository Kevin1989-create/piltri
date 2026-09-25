import { getGdpWorldRanking, getWorldBankIndicators } from "@/lib/data-sources/worldbank";
import { getCountryLanguages } from "@/lib/data-sources/languages";
import { getCountryMedianAge } from "@/lib/data-sources/medianAge";
import { getClimateAverages, getKoppenClimateType } from "@/lib/data-sources/openmeteo";
import { getAirQualityAverages } from "@/lib/data-sources/airQuality";
import { getCityOverpassData, nearestFeatureWithDetails, nearestVerifiedBeach, pickMainEconomyType } from "@/lib/data-sources/overpass";
import { getHealthcareQualityScore } from "@/lib/data-sources/who";
import { getCityPopulationAndArea } from "@/lib/data-sources/wikidata";
import { toIso3 } from "@/lib/data-sources/country-codes";
import { distanceToCapitalKm } from "@/lib/data-sources/capitals";
import { getEarthquakeCount } from "@/lib/data-sources/usgs";
import { getClimateReadiness } from "@/lib/data-sources/climateReadiness";
import { getDaylightRange } from "@/lib/data-sources/daylight";
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
  // Recalibrated 2026-09-24 alongside the gdpGrowth5yrPct calc fix (see
  // lib/data-sources/worldbank.ts) - this now measures cumulative real GDP
  // growth over ~6 years (a LEVEL change), not an annual rate, so the old
  // -5/8 range (sized for a single year's %) no longer matches its scale.
  // -10 covers a genuine multi-year contraction; 40 covers a fast-growing
  // emerging economy compounding ~6%/yr over the window.
  gdpGrowth: { min: -10, max: 40 },
  unemployment: { min: 0, max: 25 },
  salary: { min: 2000, max: 90000 }, // GNI per capita, USD
  ppp: { min: 2000, max: 120000 },
  // World Bank's Price Level Index (PA.NUS.PRVT.PLI) — verified real-world
  // spread runs from ~India (23) to ~Switzerland (128).
  priceLevel: { min: 15, max: 130 },
  // Intentional homicides per 100k (UNODC/World Bank VC.IHR.PSRC.P5). Most
  // countries sit under ~5; a handful of high-crime outliers run into the
  // 20s-40s. 30 as the ceiling keeps those outliers meaningfully separated
  // from the mid-range rather than all clamping to 0.
  homicideRate: { min: 0, max: 30 },
  // Recalibrated 2026-09-21 after fixing the per10k population bug below
  // (was dividing by country population, not city - see per10k's own
  // comment). Tested live against real Overpass counts within 5km of a
  // city centre, divided by that city's own resolved population: London
  // 4,933 restaurants/bars/cafes -> 5.6 per 10k, Ljubljana 554 -> 19.5,
  // Prague 3,209 -> 23.0. Cultural venues: London 175 -> 0.2, Ljubljana
  // 33 -> 1.2, Prague 231 -> 1.65. Family activities: Ljubljana 92 -> 3.2
  // (only one clean data point - Overpass rate-limited the rest of this
  // session's testing traffic). Same "reasonable starting point, not a
  // scientific constant" caveat as the rest of this object.
  restaurantsBarsPer10k: { min: 0, max: 30 },
  culturalVenuesPer10k: { min: 0, max: 3 },
  familyActivitiesPer10k: { min: 0, max: 15 },
  greenSpaceCount: { min: 0, max: 60 },
  temperatureDistanceFrom20C: { min: 0, max: 20 },
  rainfallDistanceFromIdeal: { min: 0, max: 1000 }, // ideal centre: 1000mm/yr
  sunshineHrs: { min: 1200, max: 3800 },
  snowfallCm: { min: 0, max: 300 },
};

// See withTimeout's comment for why beach/mountain need their own hard
// cap, separate from each source's own internal fetchWithTimeout budget.
// 12s, not the app's usual ~6s ceiling - measured live 2026-09-24 that
// even the narrowest 20km beach-search tier alone took 13s under that
// day's Overpass load (a slow day for the service generally, not specific
// to this query - same kind of rough day WDQS had earlier that session).
// Still bounded, still falls back to null honestly rather than blocking
// indefinitely - just a fairer shot than 8s gives it on a normal day.
const FAR_LOOKUP_TIMEOUT_MS = 12000;

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
 *
 * `opts.osmLandAreaKm2` is the city's precomputed OSM/Nominatim boundary
 * area (see lib/data-sources/nominatim.ts getCityLandAreaKm2 and
 * lib/aggregation/backfillLandArea.ts) - looked up by the caller
 * (cache.ts) from the `cities` table rather than fetched live here, since
 * Nominatim's 1 request/second usage-policy limit makes a live per-request
 * call impractical, and a city's boundary essentially never changes
 * anyway. When present, it's preferred over Wikidata's stated area for
 * `cityAreaKm2` - see this function's `demographics` block below.
 *
 * `opts.wikidataChecked`/`wikidataPopulation`/`wikidataAreaKm2` are the
 * same idea for city-level population - see
 * lib/aggregation/backfillWikidataPopulation.ts. getCityPopulationAndArea
 * used to be called live here on every cache miss; Wikidata's query
 * service proved too unreliable to depend on at request time (confirmed
 * live 2026-09-24 - see that file's doc comment), so a shortlisted city
 * that's already been checked by the backfill uses its stored value
 * (population/area both null is a real, checked negative, not "not
 * attempted") and skips the live call entirely. A city NOT yet reached by
 * the backfill (wikidataChecked false - a brand new search, or the
 * backfill hasn't gotten there yet) still falls back to the live call, so
 * Explore's "search anywhere" behaviour is unchanged for those.
 */
export async function aggregateCityData(
  city: CitySearchResult,
  opts: { osmLandAreaKm2?: number | null; wikidataChecked?: boolean; wikidataPopulation?: number | null; wikidataAreaKm2?: number | null } = {}
): Promise<CityExploreData> {
  const osmLandAreaKm2 = opts.osmLandAreaKm2 ?? null;
  const wikidataChecked = opts.wikidataChecked ?? false;
  const iso3 = toIso3(city.countryCode);

  const [
    wb,
    languages,
    climate,
    overpassData,
    healthcare,
    cityDemo,
    koppenCode,
    beach,
    mountain,
    forest,
    airQuality,
    earthquakeCount,
    volcano,
    gdpWorldRanking,
  ] = await Promise.all([
    safely(() => memoize(`wb:${city.countryCode}`, COUNTRY_LEVEL_TTL_MS, () => getWorldBankIndicators(city.countryCode)), null),
    safely(() => getCountryLanguages(city.countryCode), { officialLanguages: [], mostWidelySpokenLanguage: "Unknown" }),
    safely(() => getClimateAverages(city.lat, city.lng), null),
    // One Overpass request covering amenity density, transport presence,
    // and economy-sector counts together - was 14 separate requests (see
    // getCityOverpassData's doc comment).
    safely(() => getCityOverpassData(city.lat, city.lng), null),
    safely(() => memoize(`who:${iso3}`, COUNTRY_LEVEL_TTL_MS, () => getHealthcareQualityScore(iso3)), null),
    wikidataChecked
      ? Promise.resolve({ population: opts.wikidataPopulation ?? null, areaKm2: opts.wikidataAreaKm2 ?? null })
      : safely(() => getCityPopulationAndArea(city.lat, city.lng, city.cityName), { population: null, areaKm2: null }),
    safely(() => getKoppenClimateType(city.lat, city.lng), null),
    // withTimeout, not just safely - see that helper's own comment for why
    // beach/mountain specifically need a hard outer cap.
    safely(() => withTimeout(nearestVerifiedBeach(city.lat, city.lng), FAR_LOOKUP_TIMEOUT_MS, null), null),
    safely(
      () => withTimeout(nearestFeatureWithDetails(city.lat, city.lng, '"natural"="peak"', 40000), FAR_LOOKUP_TIMEOUT_MS, null),
      null
    ),
    safely(
      () =>
        withTimeout(
          nearestFeatureWithDetails(city.lat, city.lng, ['"natural"="wood"', '"landuse"="forest"'], 20000),
          FAR_LOOKUP_TIMEOUT_MS,
          null
        ),
      null
    ),
    safely(() => getAirQualityAverages(city.lat, city.lng), null),
    safely(() => getEarthquakeCount(city.lat, city.lng), null),
    safely(
      () => withTimeout(nearestFeatureWithDetails(city.lat, city.lng, '"natural"="volcano"', 100000), FAR_LOOKUP_TIMEOUT_MS, null),
      null
    ),
    // Shared across every city in a batch (fixed memoize key, not keyed
    // by country) - same bulk result regardless of which city is being
    // aggregated, see getGdpWorldRanking's own comment for why this is
    // one request, not 190+.
    safely(() => memoize("gdp-world-ranking", COUNTRY_LEVEL_TTL_MS, () => getGdpWorldRanking()), null),
  ]);

  const transportPresence = overpassData?.transport ?? { hasTrainStation: false, hasSubway: false, hasTramway: false, hasAirport: false };
  const mainEconomyType = overpassData ? pickMainEconomyType(overpassData.economySectors) : null;

  // Demographics used to silently prefer the city-level Wikidata figure
  // and fall back to the World Bank country one on a miss, both shown
  // under one "Population" label - no way to tell which you were looking
  // at (see lib/types.ts's DemographicsFields comment for the full
  // reasoning). Country and city values are now kept fully separate in
  // the returned `demographics` object below; this local
  // bestEffortPopulation is purely an internal calculation input for
  // Liveability's per10k ratios further down, not something displayed -
  // those ratios need *some* population figure to divide by, and a
  // city-preferred, country-as-fallback number is the most defensible
  // choice for that even though the two tiers are no longer blended
  // anywhere the user actually sees.
  const bestEffortPopulation = cityDemo.population ?? wb?.population ?? 0;

  // Liveability's "per 10k population" density fields divide by
  // bestEffortPopulation above - not the raw country population
  // unconditionally. An earlier version divided by the country's
  // population unconditionally, which produced a meaningless ratio: a
  // city's genuine, city-level Overpass amenity count over an unrelated
  // country-wide denominator (a small capital in a large country would
  // read as artificially "sparse" purely from the country's size, nothing
  // to do with the city itself).
  const per10k = (count: number) => (bestEffortPopulation > 0 ? Number(((count / bestEffortPopulation) * 10000).toFixed(2)) : 0);

  // Coastal flood exposure - a disclosed, simple PROXY (elevation + real
  // coastline distance), not a scientific flood model - see
  // ClimateFields.coastalFloodExposure's own comment in lib/types.ts for
  // why. Only computed when BOTH inputs genuinely resolved - a landlocked
  // city that's simply far from any coast (beach search exhausted all
  // tiers, found nothing) is honestly "Low", but a beach lookup that
  // timed out (see withTimeout above) must never silently read the same
  // way, so this stays null rather than guess "Low" for a real unknown.
  const elevationForFloodCheck = climate?.elevationM;
  const beachKmForFloodCheck = beach?.km;
  const coastalFloodExposure: "High" | "Moderate" | "Low" | null =
    elevationForFloodCheck == null || beachKmForFloodCheck == null
      ? null
      : elevationForFloodCheck <= 5 && beachKmForFloodCheck <= 2
        ? "High"
        : elevationForFloodCheck <= 15 && beachKmForFloodCheck <= 10
          ? "Moderate"
          : "Low";

  // Cost of living: World Bank's real Price Level Index, normalised onto
  // the same 0-100 "index" scale the UI has always shown (see
  // RANGES.priceLevel). Falls back to a neutral 50 only when the country
  // genuinely has no published figure.
  const costOfLivingIndex = wb?.priceLevelIndex != null ? normalise(wb.priceLevelIndex, RANGES.priceLevel.min, RANGES.priceLevel.max) : 50;

  // OSM/Nominatim's real boundary-polygon area (osmLandAreaKm2, see this
  // function's doc comment) is preferred over Wikidata's areaKm2 - a
  // single manually-entered number with no geometry behind it,
  // unverifiable for staleness or a mismatched definition (city proper
  // vs. metro). Tested live against 3 cities: matched Wikidata closely
  // where Wikidata happened to be right (London 1589 km² vs Wikidata's
  // 1572, Paris 105.06 km² vs 105.4), and caught a real error where it
  // wasn't (Zagreb 639.69 km² - matches its official area - vs
  // Wikidata's 305.8, roughly half the real figure). Wikidata remains
  // the fallback for the ~35-40% of cities where Nominatim has no
  // boundary polygon at all (see backfillLandArea.ts). Population is
  // still Wikidata-only - no change there, only which area feeds the
  // density calculation.
  const resolvedCityAreaKm2 = osmLandAreaKm2 ?? cityDemo.areaKm2;

  const data: CityExploreData = {
    cityId: city.cityId,
    cityName: city.cityName,
    region: city.region,
    country: city.country,
    countryCode: city.countryCode,
    lat: city.lat,
    lng: city.lng,

    demographics: {
      countryPopulation: wb?.population ?? null,
      countryPopulationDensityPerKm2: wb?.populationDensityPerKm2 ?? null,
      countryLandAreaKm2: wb?.landAreaKm2 ?? null,
      countryAverageAge: getCountryMedianAge(city.countryCode),
      countryPopulationTrend5yrPct: wb?.populationTrend5yrPct ?? null,
      countryMostWidelySpokenLanguage: languages.mostWidelySpokenLanguage,

      cityPopulation: cityDemo.population,
      cityAreaKm2: resolvedCityAreaKm2,
      cityPopulationDensityPerKm2:
        cityDemo.population != null && resolvedCityAreaKm2 != null
          ? Number((cityDemo.population / resolvedCityAreaKm2).toFixed(1))
          : null,
    },
    economy: {
      economicGrowth5yrGdpPct: wb?.gdpGrowth5yrPct ?? 0,
      averageSalaryGbp: Math.round((wb?.gniPerCapitaUsd ?? 0) * 0.79), // rough USD->GBP
      unemploymentRatePct: wb?.unemploymentRatePct ?? 0,
      mainEconomyType,
      gdpSectorRanking: wb?.gdpSectorRanking ?? [],
      costOfLivingIndex,
      purchasingPowerIndex: normalise(wb?.purchasingPowerParityGdpPerCapita ?? 0, RANGES.ppp.min, RANGES.ppp.max),
      gdpUsd: wb?.gdpCurrentUsd ?? null,
      gdpWorldRank: gdpWorldRanking?.get(iso3) ?? null,
      taxRevenuePctGdp: wb?.taxRevenuePctGdp ?? null,
    },
    safetyStability: {
      politicalStabilityScore: wb?.politicalStabilityScore != null ? Math.round(wb.politicalStabilityScore) : 50,
      ruleOfLawScore: wb?.ruleOfLawScore != null ? Math.round(wb.ruleOfLawScore) : 50,
      safetyTrend: wb?.politicalStabilityTrend ?? "Stable",
      homicideRatePer100k: wb?.homicideRatePer100k ?? RANGES.homicideRate.min,
    },
    climate: {
      avgAnnualTemperatureC: climate?.avgAnnualTemperatureC ?? 15,
      avgAnnualRainfallMm: climate?.avgAnnualRainfallMm ?? 700,
      avgAnnualSunshineHrs: climate?.avgAnnualSunshineHrs ?? 1800,
      avgAnnualSnowfallCm: climate?.avgAnnualSnowfallCm ?? 0,
      koppenCode,
      avgAnnualHumidityPct: climate?.avgAnnualHumidityPct ?? 60,
      elevationM: climate?.elevationM ?? null,
      avgAnnualPm25: airQuality?.avgAnnualPm25 ?? null,
      avgAnnualUvIndexMax: airQuality?.avgAnnualUvIndexMax ?? null,
      earthquakeCount50yr: earthquakeCount,
      distanceToVolcanoKm: volcano?.km != null ? Number(volcano.km.toFixed(1)) : null,
      coastalFloodExposure,
      climateReadinessScore: getClimateReadiness(city.countryCode)?.gainScore ?? null,
      ...getDaylightRange(city.lat),
    },
    liveability: {
      restaurantsBarsDensityPer10k: overpassData ? per10k(overpassData.raw.restaurantsBars) : 0,
      greenSpaceScore: overpassData
        ? normalise(overpassData.raw.greenSpaceCount, RANGES.greenSpaceCount.min, RANGES.greenSpaceCount.max)
        : 50,
      culturalVenuesDensityPer10k: overpassData ? per10k(overpassData.raw.culturalVenues) : 0,
      familyKidsActivitiesDensityPer10k: overpassData ? per10k(overpassData.raw.familyKidsActivities) : 0,
      healthcareQualityScore: healthcare ?? 55,
      hasTrainStation: transportPresence.hasTrainStation,
      hasSubway: transportPresence.hasSubway,
      hasTramway: transportPresence.hasTramway,
      hasAirport: transportPresence.hasAirport,
      distanceToBeachKm: beach?.km != null ? Number(beach.km.toFixed(1)) : null,
      distanceToMountainKm: mountain?.km != null ? Number(mountain.km.toFixed(1)) : null,
      distanceToForestKm: forest?.km != null ? Number(forest.km.toFixed(1)) : null,
      distanceToCapitalKm: distanceToCapitalKm(city.lat, city.lng, city.countryCode),
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
    safetyStability: averageScores([
      data.safetyStability.politicalStabilityScore,
      data.safetyStability.ruleOfLawScore,
      normalise(data.safetyStability.homicideRatePer100k, RANGES.homicideRate.min, RANGES.homicideRate.max, true), // lower homicide rate = better
    ]),
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
      data.liveability.greenSpaceScore,
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

/** Races a promise against a plain timer, resolving to `fallback` if the
 *  timer wins - unlike fetchWithTimeout's AbortController-based timeouts
 *  used everywhere else in this codebase, this doesn't cancel the
 *  underlying request (nearestVerifiedBeach/nearestFeatureWithDetails
 *  don't accept an AbortSignal), it just stops this aggregation from
 *  waiting on it. Needed specifically for distance-to-beach/mountain:
 *  nearestVerifiedBeach tries up to 4 widening search radii sequentially
 *  for a landlocked city, each with its own internal ~15s budget - a
 *  genuine worst case of over a minute, wildly out of step with every
 *  other source in this Promise.all (all bounded to a ~6s ceiling this
 *  session already tuned everything else to, see Wikidata/Overpass
 *  comments elsewhere in this file's siblings). A landlocked city that
 *  can't resolve a beach distance in time gets a null (same honest
 *  "no answer in time" convention as everything else) rather than
 *  dragging the whole page down with it. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

