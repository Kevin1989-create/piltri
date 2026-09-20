import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { aggregateCityData } from "./aggregate";
import { aggregatePinData } from "./pin";
import { memoize } from "./memoryCache";
import type { CityExploreData, CitySearchResult, PinnedLocationData } from "@/lib/types";

const CACHE_TTL_DAYS = Number(process.env.CACHE_TTL_DAYS ?? 30);
// Exported so other callers writing into the same in-memory fallback cache
// (see memoryCache.ts's `seed`, used by /api/admin/seed-random-data when
// Supabase isn't configured) use an identical TTL to the one this module
// applies on a real cache miss - a mismatch here wouldn't break anything
// today, but would silently make seeded entries expire earlier/later than a
// real cached entry would, for no reason.
export const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

export function citySlug(city: Pick<CitySearchResult, "cityName" | "countryCode">): string {
  return `${city.cityName}-${city.countryCode}`.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Caching layer (Phase 4.5). Reads a cached score from Supabase if it's
 * fresher than CACHE_TTL_DAYS; otherwise re-aggregates from source APIs and
 * writes the fresh result back. This is what keeps the free-tier API calls
 * (Mapbox, Overpass, etc) within their rate limits.
 *
 * If Supabase isn't configured yet (env vars missing — step 4.2 not done),
 * this falls back to a live, uncached aggregation instead of failing the
 * whole request, so Explore still works end-to-end before Supabase is wired
 * up. The 500 error some fields returned before this fix came from
 * getSupabaseServiceClient() throwing outside of any try/catch here.
 */
export async function getOrAggregateCityData(city: CitySearchResult): Promise<CityExploreData> {
  let supabase;
  try {
    supabase = getSupabaseServiceClient();
  } catch (err) {
    // No persistent cache available yet — fall back to an in-memory one so
    // at least repeat searches within this dev/server session are instant,
    // rather than every single search re-hitting every external API live.
    console.warn("Supabase not configured yet — using in-memory cache only:", err);
    return memoize(citySlug(city), CACHE_TTL_MS, () => aggregateCityData(city));
  }

  const { data: cityRow, error: cityErr } = await supabase
    .from("cities")
    .upsert(
      {
        slug: `${city.cityName}-${city.countryCode}`.toLowerCase().replace(/\s+/g, "-"),
        city_name: city.cityName,
        region: city.region,
        country: city.country,
        country_code: city.countryCode,
        lat: city.lat,
        lng: city.lng,
      },
      { onConflict: "slug" }
    )
    .select()
    .single();

  if (cityErr || !cityRow) {
    // If Supabase isn't reachable/configured, fall back to the in-memory
    // cache rather than failing (or re-fetching live) every time.
    console.error("Supabase city upsert failed, falling back to in-memory cache:", cityErr);
    return memoize(citySlug(city), CACHE_TTL_MS, () => aggregateCityData(city));
  }

  const { data: cached } = await supabase
    .from("city_scores")
    .select("*")
    .eq("city_id", cityRow.id)
    .single();

  if (cached) {
    const ageMs = Date.now() - new Date(cached.last_updated).getTime();
    const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    if (ageMs < ttlMs) {
      return cached.data as CityExploreData;
    }
  }

  const fresh = await aggregateCityData({ ...city, cityId: cityRow.id });

  await supabase.from("city_scores").upsert({
    city_id: cityRow.id,
    data: fresh,
    piltri_score: fresh.piltriScore,
    section_scores: fresh.sectionScores,
    last_updated: fresh.lastUpdated,
  });

  return fresh;
}

/**
 * Batch version of getOrAggregateCityData's Supabase-read half — built for
 * Advanced search, which needs to check up to 500 candidates in a single
 * request. The single-city function above does one upsert + one select PER
 * city; called 500 times in a row (even at the existing CONCURRENCY=6) that
 * alone is up to ~1000 sequential-ish Supabase round trips, easily several
 * seconds to tens of seconds on database latency before a single external
 * API call ever happens — the real reason a "warm" search (every candidate
 * already cached) was still slow, not just cold ones.
 *
 * This reads the whole candidate list in 2 queries total and returns
 * whichever already have a fresh (< CACHE_TTL_DAYS old) cache entry, keyed
 * by citySlug. Whatever's missing from the returned map still needs the
 * slower per-city live-aggregation path (getOrAggregateCityData) - that
 * part can't be sped up further without pre-computing it ahead of time
 * (see app/api/admin/warm-cache/route.ts).
 */
// Postgrest's `.in(...)` filter is passed as a query-string value — with
// the shortlist now ~6,300 cities (was ~500), a single unchunked `.in()`
// call for every slug/id at once risks the request URL exceeding practical
// size limits and failing outright (silently, since callers here treat any
// error as "nothing cached" and fall through to the slow path - discovered
// via real testing: after expanding the shortlist, every candidate read
// as stale even for a city aggregated moments earlier). Chunking avoids
// that regardless of the exact limit that would otherwise bite.
const IN_CLAUSE_CHUNK_SIZE = 300;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function getCachedCityDataBatch(cities: CitySearchResult[]): Promise<Map<string, CityExploreData>> {
  const result = new Map<string, CityExploreData>();
  if (cities.length === 0) return result;

  let supabase;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    // No persistent cache configured - every candidate falls through to the
    // live (or in-memory-memoized) path, same as getOrAggregateCityData
    // does in this situation.
    return result;
  }

  const slugs = Array.from(new Set(cities.map((c) => citySlug(c))));

  const cityRows: { id: string; slug: string }[] = [];
  for (const slugChunk of chunk(slugs, IN_CLAUSE_CHUNK_SIZE)) {
    const { data, error } = await supabase.from("cities").select("id, slug").in("slug", slugChunk);
    if (error) {
      console.error("getCachedCityDataBatch: cities lookup failed for a chunk:", error);
      continue;
    }
    if (data) cityRows.push(...(data as { id: string; slug: string }[]));
  }
  if (cityRows.length === 0) return result;

  const idToSlug = new Map<string, string>(cityRows.map((r) => [r.id, r.slug]));
  const ids = cityRows.map((r) => r.id);

  const scoreRows: { city_id: string; data: CityExploreData; last_updated: string }[] = [];
  for (const idChunk of chunk(ids, IN_CLAUSE_CHUNK_SIZE)) {
    const { data, error } = await supabase.from("city_scores").select("city_id, data, last_updated").in("city_id", idChunk);
    if (error) {
      console.error("getCachedCityDataBatch: city_scores lookup failed for a chunk:", error);
      continue;
    }
    if (data) scoreRows.push(...(data as { city_id: string; data: CityExploreData; last_updated: string }[]));
  }

  const now = Date.now();
  for (const row of scoreRows) {
    const slug = idToSlug.get(row.city_id);
    if (!slug) continue;
    const ageMs = now - new Date(row.last_updated).getTime();
    if (ageMs < CACHE_TTL_MS) {
      result.set(slug, row.data);
    }
  }
  return result;
}

/**
 * Cached wrapper around aggregatePinData, run at a city's own centre
 * coordinates rather than a user-dropped pin — this is what powers Advanced
 * search's "Nearby & distance" criteria (Beach, Subway, School, etc.) at
 * city scope, and the country-scope roll-up of the same fields (see
 * lib/advancedSearch/criteria.ts).
 *
 * aggregatePinData is expensive (~13 Overpass/Mapbox lookups per call), so
 * this is deliberately cached the same way getOrAggregateCityData is —
 * except in-memory only for now (no Supabase table for it yet), which is a
 * real, disclosed limitation: unlike the score cache, this resets on every
 * server restart/redeploy rather than persisting. Acceptable for now since
 * the API route only ever calls this when a Nearby filter is actually
 * active, but worth revisiting alongside the general loading-time work
 * already logged in KNOWN-ISSUES.md if Advanced search sees real traffic.
 */
export async function getOrAggregatePinDataForCity(city: CitySearchResult): Promise<PinnedLocationData> {
  return memoize(`pin-centre:${citySlug(city)}`, CACHE_TTL_MS, () => aggregatePinData(city.lat, city.lng));
}
