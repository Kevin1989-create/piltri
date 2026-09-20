import { getDiscoverCities } from "@/lib/discoverCities";
import { citySlug, getCachedCityDataBatch, getOrAggregateCityData } from "./cache";
import type { CitySearchResult } from "@/lib/types";

// Kept modest and paced specifically for Overpass — a shared, free public
// instance that firing hundreds of cities' worth of requests back-to-back
// genuinely got this project's own IP temporarily blocked (406s on every
// request, including a plain status check) during real testing. Each city
// is now just 1 Overpass request (was 14 - see getCityOverpassData in
// lib/data-sources/overpass.ts), so this concurrency is far gentler in
// practice than the number alone suggests, but the pause between batches
// is what actually avoids bursting.
const CONCURRENCY = 4;
// Pause between each concurrency batch - turns "CONCURRENCY requests
// back-to-back forever" into "CONCURRENCY requests, then breathe" so a
// large shortlist doesn't read as a burst/DoS pattern to Overpass's WAF.
const BATCH_PAUSE_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WarmCacheResult {
  total: number;
  alreadyFresh: number;
  attempted: number;
  warmed: number;
  failed: number;
  failedCities: string[];
  /** True if there were still more stale/missing cities left after this
   *  call's `limit` was reached — the caller (a cron tick) should expect
   *  to keep making progress on the next scheduled run rather than
   *  assuming the whole shortlist is now warm. */
  remaining: number;
}

/**
 * Warms up to `limit` stale-or-missing cities from the shortlist (all of
 * them, if `limit` is omitted) — shared by the manual admin endpoint
 * (POST /api/admin/warm-cache, no limit by default, for a full deliberate
 * sweep) and the scheduled cron tick (POST /api/cron/warm-cache-tick,
 * always a bounded `limit` so a single invocation comfortably fits inside
 * a serverless function's execution time limit). Naturally resumable:
 * every call just asks "which of the ~6,300 shortlisted cities aren't
 * fresh right now" and processes up to `limit` of them - repeated calls
 * (whether daily cron ticks or another manual run) keep converging toward
 * "everything is warm" without needing any persisted cursor/progress state.
 */
export async function warmCache(limit?: number): Promise<WarmCacheResult> {
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
  const stale = cityInputs.filter((c) => !alreadyFresh.has(citySlug(c)));
  const toWarm = limit != null ? stale.slice(0, limit) : stale;

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
    if (i + CONCURRENCY < toWarm.length) await sleep(BATCH_PAUSE_MS);
  }

  return {
    total: cityInputs.length,
    alreadyFresh: alreadyFresh.size,
    attempted: toWarm.length,
    warmed,
    failed,
    failedCities: failedCities.slice(0, 20),
    remaining: stale.length - toWarm.length,
  };
}
