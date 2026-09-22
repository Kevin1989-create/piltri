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
 *
 * The cache-hit path is a SINGLE round trip (city_scores joined to cities,
 * filtered by slug) — this used to unconditionally UPSERT the `cities`
 * table (a write) on every single request, even an already-cached city,
 * then a second separate round trip to read city_scores. That was real,
 * measured latency with zero benefit on a hit (a live test found ~950ms
 * server time even for a city aggregated moments earlier) — see
 * HANDOFF.md's performance notes. The upsert now only happens on a
 * genuine cache miss/stale read, the actually-slow path where it doesn't
 * matter as much (live external-API aggregation dominates there anyway).
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

  const slug = citySlug(city);

  const { data: existing, error: readErr } = await supabase
    .from("city_scores")
    .select("city_id, data, last_updated, cities!inner(slug, osm_land_area_km2)")
    .eq("cities.slug", slug)
    .maybeSingle();

  if (!readErr && existing) {
    const ageMs = Date.now() - new Date(existing.last_updated as string).getTime();
    if (ageMs < CACHE_TTL_MS) {
      return existing.data as CityExploreData;
    }
  }

  // Cache miss or stale - need the city's row id (creating the row if this
  // city has genuinely never been seen before). A stale-but-existing
  // city_scores row already tells us the id via `existing`, so this only
  // does a fresh cities upsert for a truly new city. Same for the
  // pre-backfilled OSM land area (see schema.sql) - a brand new city won't
  // have one yet (backfill hasn't reached it), an existing-but-stale one
  // might.
  let cityId = existing?.city_id as string | undefined;
  // Supabase's JS client returns a joined many-to-one relation as a single
  // object, but its generic types model every embed as an array - handle
  // both shapes defensively, same as getCachedCityDataBatch below does.
  const existingCityRel = Array.isArray(existing?.cities) ? existing.cities[0] : existing?.cities;
  let osmLandAreaKm2 = existingCityRel?.osm_land_area_km2 as number | null | undefined;

  if (!cityId) {
    const { data: cityRow, error: cityErr } = await supabase
      .from("cities")
      .upsert(
        {
          slug,
          city_name: city.cityName,
          region: city.region,
          country: city.country,
          country_code: city.countryCode,
          lat: city.lat,
          lng: city.lng,
        },
        { onConflict: "slug" }
      )
      .select("id, osm_land_area_km2")
      .single();

    if (cityErr || !cityRow) {
      // If Supabase isn't reachable/configured, fall back to the in-memory
      // cache rather than failing (or re-fetching live) every time.
      console.error("Supabase city upsert failed, falling back to in-memory cache:", cityErr);
      return memoize(citySlug(city), CACHE_TTL_MS, () => aggregateCityData(city));
    }
    cityId = cityRow.id as string;
    osmLandAreaKm2 = cityRow.osm_land_area_km2 as number | null;
  }

  const fresh = await aggregateCityData({ ...city, cityId }, { osmLandAreaKm2: osmLandAreaKm2 ?? null });

  await supabase.from("city_scores").upsert({
    city_id: cityId,
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
 * This reads the whole candidate list via city_scores joined to cities
 * (one query per IN_CLAUSE_CHUNK_SIZE-sized chunk, not two sequential
 * lookups per chunk - see the comment on getOrAggregateCityData above for
 * why that halving matters) and returns whichever already have a fresh
 * (< CACHE_TTL_DAYS old) cache entry, keyed by citySlug. Whatever's
 * missing from the returned map still needs the slower per-city
 * live-aggregation path (getOrAggregateCityData) - that part can't be
 * sped up further without pre-computing it ahead of time (see
 * app/api/admin/warm-cache/route.ts).
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

  // One chunked pass, not two sequential ones (cities lookup, then
  // city_scores lookup) - city_scores joined to cities and filtered by
  // slug directly, same optimization as getOrAggregateCityData's single-city
  // read above and for the same reason: halves the round trips for no
  // loss of information. The chunks themselves run in parallel
  // (Promise.all), not one after another - at the full ~6,300-city
  // shortlist size that's ~21 chunks; sequential awaits measured ~2.7s
  // total (21 × ~125ms) for what should be a sub-second cache read, since
  // each chunk is an independent query with nothing to wait on the others
  // for.
  type Row = { data: CityExploreData; last_updated: string; cities: { slug: string } | { slug: string }[] };
  const chunkResults = await Promise.all(
    chunk(slugs, IN_CLAUSE_CHUNK_SIZE).map((slugChunk) =>
      supabase
        .from("city_scores")
        .select("data, last_updated, cities!inner(slug)")
        .in("cities.slug", slugChunk)
    )
  );
  const scoreRows: Row[] = [];
  for (const { data, error } of chunkResults) {
    if (error) {
      console.error("getCachedCityDataBatch: lookup failed for a chunk:", error);
      continue;
    }
    if (data) scoreRows.push(...(data as unknown as Row[]));
  }

  const now = Date.now();
  for (const row of scoreRows) {
    // Supabase's JS client returns a joined many-to-one relation as a
    // single object, but its generic types model every embed as an array -
    // handle both shapes defensively rather than assuming one.
    const cityRel = Array.isArray(row.cities) ? row.cities[0] : row.cities;
    const slug = cityRel?.slug;
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
