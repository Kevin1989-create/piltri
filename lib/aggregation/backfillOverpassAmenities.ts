import { getDiscoverCities } from "@/lib/discoverCities";
import {
  getCityOverpassData,
  nearestFeatureWithDetails,
  nearestVerifiedBeach,
  type OverpassAmenitiesBackfill,
} from "@/lib/data-sources/overpass";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { withTimeout } from "./aggregate";
import { citySlug } from "./cache";

// Overpass is the shared free service this session has repeatedly found
// struggling under normal load (3-mirror fallback in overpass.ts, the
// null-vs-false Quality of Life fix, the Sea level rise exposure entry
// above) - paced gently, same spirit as the Wikidata/land-area backfills'
// own REQUEST_PACE_MS, even though the exact number differs (Overpass
// tolerates a bit more than Nominatim's strict 1/sec, but not much more
// than Wikidata's own pacing given how much a single city's worth of
// calls below already asks of it).
const REQUEST_PACE_MS = 1500;

// A background job with nobody waiting synchronously on any single city
// can afford to ride out Overpass's tail latency rather than the ~6s
// ceiling a live page load is bound to (see aggregate.ts's
// FAR_LOOKUP_TIMEOUT_MS comment) - 20s per far-lookup call comfortably
// covers even nearestVerifiedBeach's worst realistic case (4 widening
// search tiers) without letting one stuck city block the whole run for
// long.
const FAR_LOOKUP_TIMEOUT_MS = 20000;

const IN_CLAUSE_CHUNK_SIZE = 300;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BackfillOverpassAmenitiesResult {
  total: number;
  alreadyChecked: number;
  attempted: number;
  found: number;
  failed: number;
  remaining: number;
  stoppedReason: "exhausted" | "deadline";
}

/**
 * One-time (resumable) backfill of cities.overpass_amenities across the
 * full shortlist - see that column's comment in schema.sql for the full
 * reasoning. Runs the exact same 4 Overpass calls aggregateCityData makes
 * live (getCityOverpassData + nearestVerifiedBeach + 2x
 * nearestFeatureWithDetails for mountain/forest) per city, in parallel,
 * and stores the combined result as one OverpassAmenitiesBackfill blob. A
 * shortlisted, already-backfilled city then skips ALL 4 live calls on its
 * next cache miss/refresh (see aggregate.ts's overpassChecked opt) -
 * genuinely eliminating Overpass as a point of failure for that city,
 * not just caching around it.
 *
 * Exact same resumable shape as backfillWikidataPopulation.ts:
 * overpass_checked_at is set regardless of whether anything actually
 * resolved (a real "checked, genuinely far from any coast/no schools
 * nearby" is not the same as "not attempted yet"). Call repeatedly (the
 * /admin page's "Backfill Overpass amenities" button does this
 * automatically) until `remaining` reads 0. Unlike the land-area/Wikidata
 * backfills, there's no separate "notFound" bucket here - `found` counts
 * a city where the combined Overpass call itself succeeded (even if every
 * individual flag/count came back negative), `failed` is a genuine
 * request failure (left unchecked so it retries naturally, same reasoning
 * as those two backfills).
 */
export async function backfillOverpassAmenities(options: { deadlineMs?: number } = {}): Promise<BackfillOverpassAmenitiesResult> {
  const { deadlineMs } = options;
  const startedAt = Date.now();

  const cities = getDiscoverCities();
  const supabase = getSupabaseServiceClient();

  const upsertRows = cities.map((c) => ({
    slug: citySlug(c),
    city_name: c.cityName,
    region: c.region,
    country: c.country,
    country_code: c.countryCode,
    lat: c.lat,
    lng: c.lng,
  }));
  // Parallel (Promise.all), not sequential - at the shortlist's current
  // ~66,300-city size that's ~221 chunks; a sequential loop here measured
  // live 2026-09-26 as eating the ENTIRE 30s deadline before a single
  // city's actual Overpass lookup even started (attempted: 0 on the first
  // real run) - same class of regression cache.ts's getCachedCityDataBatch
  // and admin/status already hit and fixed after the shortlist widened
  // from ~6,300 (see HANDOFF.md), just not yet applied here since this
  // backfill didn't exist until after that widening.
  const upsertResults = await Promise.all(
    chunk(upsertRows, IN_CLAUSE_CHUNK_SIZE).map((rowsChunk) =>
      supabase.from("cities").upsert(rowsChunk, { onConflict: "slug", ignoreDuplicates: true })
    )
  );
  for (const { error } of upsertResults) {
    if (error) console.error("backfillOverpassAmenities: cities upsert chunk failed:", error);
  }

  const slugChunks = chunk(
    cities.map((c) => citySlug(c)),
    IN_CLAUSE_CHUNK_SIZE
  );
  const readResults = await Promise.all(
    slugChunks.map((slugChunk) =>
      supabase.from("cities").select("id, slug, city_name, lat, lng").in("slug", slugChunk).is("overpass_checked_at", null)
    )
  );

  const candidates: { id: string; slug: string; city_name: string; lat: number; lng: number }[] = [];
  for (const { data, error } of readResults) {
    if (error) {
      console.error("backfillOverpassAmenities: read failed for a chunk:", error);
      continue;
    }
    if (data) candidates.push(...data);
  }
  const alreadyChecked = cities.length - candidates.length;

  let attempted = 0;
  let found = 0;
  let failed = 0;
  let stoppedReason: BackfillOverpassAmenitiesResult["stoppedReason"] = "exhausted";

  for (let i = 0; i < candidates.length; i++) {
    if (deadlineMs != null && Date.now() - startedAt >= deadlineMs) {
      stoppedReason = "deadline";
      break;
    }

    const row = candidates[i];
    attempted++;
    try {
      const [overpassData, beach, mountain, forest] = await Promise.all([
        getCityOverpassData(row.lat, row.lng),
        withTimeout(nearestVerifiedBeach(row.lat, row.lng), FAR_LOOKUP_TIMEOUT_MS, null),
        withTimeout(nearestFeatureWithDetails(row.lat, row.lng, '"natural"="peak"', 40000), FAR_LOOKUP_TIMEOUT_MS, null),
        withTimeout(
          nearestFeatureWithDetails(row.lat, row.lng, ['"natural"="wood"', '"landuse"="forest"'], 20000),
          FAR_LOOKUP_TIMEOUT_MS,
          null
        ),
      ]);

      const amenities: OverpassAmenitiesBackfill = {
        raw: overpassData.raw,
        transport: overpassData.transport,
        economySectors: overpassData.economySectors,
        beach,
        mountain,
        forest,
      };

      await supabase
        .from("cities")
        .update({ overpass_amenities: amenities, overpass_checked_at: new Date().toISOString() })
        .eq("id", row.id);
      found++;
    } catch (err) {
      console.error(`backfillOverpassAmenities: lookup failed for ${row.city_name}:`, err);
      failed++;
      // Deliberately NOT marked checked, same reasoning as the other 2
      // backfills - a transient failure should retry naturally rather
      // than risk permanently skipping a city over one bad request.
    }

    if (i < candidates.length - 1) await sleep(REQUEST_PACE_MS);
  }

  return {
    total: cities.length,
    alreadyChecked,
    attempted,
    found,
    failed,
    remaining: candidates.length - attempted,
    stoppedReason,
  };
}
