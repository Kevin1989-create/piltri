import { NextResponse } from "next/server";
import { getDiscoverCities } from "@/lib/discoverCities";
import { citySlug, getCachedCityDataBatch, getOrAggregateCityData } from "@/lib/aggregation/cache";
import type { CitySearchResult } from "@/lib/types";

// Same concurrency the main Advanced search route uses - keeps this within
// the same free-tier rate limits (Overpass, World Bank, Open-Meteo, WHO,
// REST Countries) rather than hammering them harder just because this runs
// standalone.
const CONCURRENCY = 6;

/**
 * POST /api/admin/warm-cache
 *
 * One-time (or periodic) maintenance action, not something end users ever
 * hit: walks the full ~500-city Advanced search shortlist and populates the
 * Supabase cache (city_scores) for every city that isn't already fresh.
 * Nothing about this shows up in the UI on its own — it exists purely so
 * "Search all" (and any other Advanced search) can hit the fast, batch-
 * cache-read path (see getCachedCityDataBatch in lib/aggregation/cache.ts)
 * from the very first real search, instead of only getting fast once
 * enough individual cities happen to have been viewed/cached through normal
 * browsing.
 *
 * Deliberately synchronous (the request stays open until every cold city
 * has been aggregated) rather than fire-and-forget, so the response's
 * summary counts are accurate — on a fully cold cache this can take
 * several minutes, same as an unfiltered Advanced search does today. Run
 * it once after deploying, and again any time the shortlist changes or the
 * 30-day cache TTL is a concern.
 *
 * No auth here - this is safe to leave open (it only ever reads/writes
 * scores, no user data), but if this API ever becomes reachable from a
 * public, untrusted network, add a shared-secret header check.
 */
export async function POST() {
  const cities = getDiscoverCities();
  const cityInputs: CitySearchResult[] = cities.map((c) => ({
    cityId: c.cityId,
    cityName: c.cityName,
    region: c.region,
    country: c.country,
    countryCode: c.countryCode,
    lat: c.lat,
    lng: c.lng,
  }));

  const alreadyFresh = await getCachedCityDataBatch(cityInputs);
  const toWarm = cityInputs.filter((c) => !alreadyFresh.has(citySlug(c)));

  let warmed = 0;
  let failed = 0;
  const failedCities: string[] = [];

  for (let i = 0; i < toWarm.length; i += CONCURRENCY) {
    const batch = toWarm.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((city) => getOrAggregateCityData(city)));
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        warmed++;
      } else {
        failed++;
        failedCities.push(batch[j].cityName);
      }
    }
  }

  return NextResponse.json({
    total: cityInputs.length,
    alreadyFresh: alreadyFresh.size,
    warmed,
    failed,
    failedCities: failedCities.slice(0, 20),
  });
}
