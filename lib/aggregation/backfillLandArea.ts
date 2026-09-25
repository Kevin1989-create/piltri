import { getDiscoverCities } from "@/lib/discoverCities";
import { getCityLandAreaKm2 } from "@/lib/data-sources/nominatim";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { citySlug } from "./cache";

// Nominatim's usage policy is a hard 1 request/second, strictly - unlike
// Overpass's "gentle concurrency + pause" tolerance (see warmCache.ts),
// this has to be genuinely sequential, one request at a time, not a
// batched/concurrent pattern. 1100ms (not a flat 1000ms) leaves a little
// headroom rather than running right at the policy's edge.
const REQUEST_PACE_MS = 1100;

// Supabase's `.in()` filter is passed as a query-string value - at the
// full ~6,300-city shortlist, a single unchunked `.in()` call for every
// slug at once fails silently (returns an empty result, no error) rather
// than erroring outright. Same real bug, same fix, as cache.ts's
// IN_CLAUSE_CHUNK_SIZE (see that file's comment) - this job hit exactly
// that on its first production run: every city read back as "not a
// candidate" despite none having been checked yet.
const IN_CLAUSE_CHUNK_SIZE = 300;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BackfillLandAreaResult {
  total: number;
  alreadyChecked: number;
  attempted: number;
  found: number;
  notFound: number;
  failed: number;
  remaining: number;
  stoppedReason: "exhausted" | "deadline";
}

/**
 * One-time (resumable) backfill of cities.osm_land_area_km2 across the
 * full ~6,300-city shortlist - see that column's comment in schema.sql
 * for why this lives outside the normal city_scores refresh cycle
 * entirely, as its own slow, separately-paced job. Shared by the manual
 * admin endpoint (POST /api/admin/backfill-land-area) the same way
 * warmCache() is shared by the cache-warming endpoints - call repeatedly
 * (the /admin page's "Backfill land area" button does this automatically)
 * until `remaining` reads 0.
 *
 * Unlike warmCache, there's no "already fresh" concept here - a city is
 * either checked (osm_land_area_checked_at is set, regardless of whether
 * a boundary was actually found) or it isn't, and checked cities are
 * simply skipped on every subsequent call. Genuinely resumable the same
 * way: no persisted cursor, each call just asks Supabase which cities
 * still have a null osm_land_area_checked_at.
 */
export async function backfillLandArea(options: { deadlineMs?: number } = {}): Promise<BackfillLandAreaResult> {
  const { deadlineMs } = options;
  const startedAt = Date.now();

  const cities = getDiscoverCities();
  const supabase = getSupabaseServiceClient();

  // Ensure every shortlisted city has a `cities` row to update - the same
  // upsert-by-slug pattern getOrAggregateCityData uses on a genuine cache
  // miss, done here in one batch up front instead, since this job needs
  // every city's row id regardless of whether it's ever been searched or
  // warmed yet.
  const upsertRows = cities.map((c) => ({
    slug: citySlug(c),
    city_name: c.cityName,
    region: c.region,
    country: c.country,
    country_code: c.countryCode,
    lat: c.lat,
    lng: c.lng,
  }));
  // Chunked for the same reason the read below is - upsert payloads this
  // large risk the same silent-failure class of problem. Parallel
  // (Promise.all), not sequential - at ~221 chunks (the shortlist's
  // current ~66,300-city size), a sequential loop here can eat the whole
  // deadline before a single city's real lookup even starts (confirmed
  // live in backfillOverpassAmenities.ts, same code shape - see that
  // file's comment) - same fix already applied to cache.ts's
  // getCachedCityDataBatch and admin/status after the shortlist widened.
  const upsertResults = await Promise.all(
    chunk(upsertRows, IN_CLAUSE_CHUNK_SIZE).map((rowsChunk) =>
      supabase.from("cities").upsert(rowsChunk, { onConflict: "slug", ignoreDuplicates: true })
    )
  );
  for (const { error } of upsertResults) {
    if (error) console.error("backfillLandArea: cities upsert chunk failed:", error);
  }

  const slugChunks = chunk(
    cities.map((c) => citySlug(c)),
    IN_CLAUSE_CHUNK_SIZE
  );
  const readResults = await Promise.all(
    slugChunks.map((slugChunk) =>
      supabase.from("cities").select("id, slug, city_name, country").in("slug", slugChunk).is("osm_land_area_checked_at", null)
    )
  );

  const candidates: { id: string; slug: string; city_name: string; country: string }[] = [];
  for (const { data, error } of readResults) {
    if (error) {
      console.error("backfillLandArea: read failed for a chunk:", error);
      continue;
    }
    if (data) candidates.push(...data);
  }
  const alreadyChecked = cities.length - candidates.length;

  let attempted = 0;
  let found = 0;
  let notFound = 0;
  let failed = 0;
  let stoppedReason: BackfillLandAreaResult["stoppedReason"] = "exhausted";

  for (let i = 0; i < candidates.length; i++) {
    if (deadlineMs != null && Date.now() - startedAt >= deadlineMs) {
      stoppedReason = "deadline";
      break;
    }

    const row = candidates[i];
    attempted++;
    try {
      const areaKm2 = await getCityLandAreaKm2(row.city_name, row.country);
      await supabase
        .from("cities")
        .update({ osm_land_area_km2: areaKm2, osm_land_area_checked_at: new Date().toISOString() })
        .eq("id", row.id);
      if (areaKm2 != null) found++;
      else notFound++;
    } catch (err) {
      console.error(`backfillLandArea: lookup failed for ${row.city_name}:`, err);
      failed++;
      // Deliberately NOT marked checked - most failures here are
      // transient (a timeout, a momentary Nominatim hiccup), so leaving
      // osm_land_area_checked_at null lets the next call retry it
      // naturally rather than risk permanently skipping a city over one
      // bad request.
    }

    if (i < candidates.length - 1) await sleep(REQUEST_PACE_MS);
  }

  return {
    total: cities.length,
    alreadyChecked,
    attempted,
    found,
    notFound,
    failed,
    remaining: candidates.length - attempted,
    stoppedReason,
  };
}
