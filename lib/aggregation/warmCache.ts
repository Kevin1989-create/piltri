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
   *  call stopped (hit `limit`, ran out of `deadlineMs`, or both omitted
   *  and it genuinely finished the whole shortlist) — the caller (a cron
   *  tick) should expect to keep making progress on the next scheduled
   *  run rather than assuming the whole shortlist is now warm. */
  remaining: number;
  /** Why this call stopped - useful for the /admin page and for judging
   *  whether `deadlineMs` needs adjusting (e.g. consistently stopping on
   *  "deadline" with a low city count suggests Overpass is running slow
   *  that day, not a code problem). */
  stoppedReason: "exhausted" | "limit" | "deadline";
}

/**
 * Warms stale-or-missing cities from the shortlist — shared by the manual
 * admin endpoint (POST /api/admin/warm-cache, no bound by default, for a
 * full deliberate sweep) and the scheduled cron tick
 * (POST /api/cron/warm-cache-tick, always passes `deadlineMs`).
 *
 * `deadlineMs`, not a fixed city count, is what actually keeps a cron tick
 * inside a serverless function's execution time limit — Overpass's real
 * per-request latency varies a lot day to day (typical case: under a
 * second; worst case, when it's under load or a mirror needs to be raced:
 * several seconds), so a fixed "process N cities" count is either far too
 * conservative on a good day or genuinely blows the time budget on a slow
 * one (a real production run with a fixed count of 80 did exactly that —
 * hit Vercel's 60s ceiling and returned nothing). This checks the wall
 * clock after every batch and stops before starting another once the
 * deadline is close, so it always returns *something* rather than risking
 * a hard timeout that loses the whole call's progress.
 *
 * Naturally resumable regardless of which bound is used: every call just
 * asks "which of the ~6,300 shortlisted cities aren't fresh right now" and
 * processes what it can - repeated calls keep converging toward "everything
 * is warm" without needing any persisted cursor/progress state.
 */
export async function warmCache(options: { limit?: number; deadlineMs?: number } = {}): Promise<WarmCacheResult> {
  const { limit, deadlineMs } = options;
  const startedAt = Date.now();

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
  const candidates = limit != null ? stale.slice(0, limit) : stale;

  let warmed = 0;
  let failed = 0;
  let attempted = 0;
  const failedCities: string[] = [];
  let stoppedReason: WarmCacheResult["stoppedReason"] = "exhausted";

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    if (deadlineMs != null && Date.now() - startedAt >= deadlineMs) {
      stoppedReason = "deadline";
      break;
    }

    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((city) => getOrAggregateCityData(city)));
    attempted += batch.length;
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        warmed++;
      } else {
        failed++;
        failedCities.push(batch[j].cityName);
      }
    }

    if (i + CONCURRENCY >= candidates.length) {
      stoppedReason = limit != null && stale.length > candidates.length ? "limit" : "exhausted";
      break;
    }
    await sleep(BATCH_PAUSE_MS);
  }

  return {
    total: cityInputs.length,
    alreadyFresh: alreadyFresh.size,
    attempted,
    warmed,
    failed,
    failedCities: failedCities.slice(0, 20),
    remaining: stale.length - attempted,
    stoppedReason,
  };
}
