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
  // Supabase upsert has a practical payload/row-count ceiling similar to
  // the IN_CLAUSE_CHUNK_SIZE issue documented in cache.ts - chunk defensively
  // rather than risk one giant call failing silently.
  const UPSERT_CHUNK_SIZE = 500;
  for (let i = 0; i < upsertRows.length; i += UPSERT_CHUNK_SIZE) {
    const { error } = await supabase
      .from("cities")
      .upsert(upsertRows.slice(i, i + UPSERT_CHUNK_SIZE), { onConflict: "slug", ignoreDuplicates: true });
    if (error) console.error("backfillLandArea: cities upsert chunk failed:", error);
  }

  const { data: uncheckedRows, error: readErr } = await supabase
    .from("cities")
    .select("id, slug, city_name, country")
    .in(
      "slug",
      cities.map((c) => citySlug(c))
    )
    .is("osm_land_area_checked_at", null);

  if (readErr) {
    console.error("backfillLandArea: read failed:", readErr);
    return {
      total: cities.length,
      alreadyChecked: 0,
      attempted: 0,
      found: 0,
      notFound: 0,
      failed: 0,
      remaining: cities.length,
      stoppedReason: "exhausted",
    };
  }

  const candidates = uncheckedRows ?? [];
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
