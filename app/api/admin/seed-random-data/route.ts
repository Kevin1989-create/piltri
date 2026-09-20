import { NextRequest, NextResponse } from "next/server";
import { getDiscoverCities } from "@/lib/discoverCities";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { CACHE_TTL_MS, citySlug } from "@/lib/aggregation/cache";
import { seed as seedMemoryCache } from "@/lib/aggregation/memoryCache";
import { randomCityData } from "@/lib/aggregation/randomSeed";
import { isAdminRequest } from "@/lib/adminAuth";
import type { CityExploreData, CitySearchResult } from "@/lib/types";

// Pure writes (DB or in-memory), no external API to rate-limit against here
// (unlike warm-cache's CONCURRENCY=6, which has to respect Overpass/World
// Bank/etc) - can run considerably more in parallel.
const CONCURRENCY = 20;

/**
 * POST /api/admin/seed-random-data
 *
 * TEST-ONLY convenience endpoint - NOT part of the real search path and
 * never called from the UI. Writes random (not real) CityExploreData for
 * every city in the shortlist, so the very next Advanced search finds
 * everything already cached and returns almost instantly, without waiting
 * on live external APIs - makes it much faster to iterate on the search
 * UI/UX (filters, sorting, pagination, cards, map) during testing.
 *
 * Writes to Supabase (city_scores) when it's configured - same cache the
 * real pipeline uses, so this also exercises getCachedCityDataBatch's fast
 * path. When Supabase isn't configured (as in this project's .env.local
 * today - NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are blank),
 * this instead seeds the in-memory fallback cache (memoryCache.ts) under
 * the exact key getOrAggregateCityData falls back to reading
 * (citySlug(city)) - so per-city lookups still hit instantly even without a
 * Supabase project, at the cost of resetting on the next dev-server
 * restart, same limitation the rest of the in-memory fallback already has.
 *
 * Important: this OVERWRITES whatever real data was cached for these
 * cities. Re-run a real (filtered or "Search all") Advanced search
 * afterwards, or POST /api/admin/warm-cache, to replace the random values
 * with genuine live-aggregated ones before this is shown to real users -
 * this endpoint should never be run against a production dataset.
 *
 * Gated by ADMIN_PASSWORD (see lib/adminAuth.ts), same as the other
 * /api/admin/* endpoints.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let supabase: ReturnType<typeof getSupabaseServiceClient> | null = null;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    supabase = null;
  }

  const cities = getDiscoverCities();
  let seeded = 0;
  let failed = 0;
  const failedCities: string[] = [];

  for (let i = 0; i < cities.length; i += CONCURRENCY) {
    const batch = cities.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (candidate) => {
        const city: CitySearchResult = {
          cityId: candidate.cityId,
          cityName: candidate.cityName,
          region: candidate.region,
          country: candidate.country,
          countryCode: candidate.countryCode,
          lat: candidate.lat,
          lng: candidate.lng,
        };
        try {
          if (supabase) {
            const { data: cityRow, error: cityErr } = await supabase
              .from("cities")
              .upsert(
                {
                  slug: citySlug(city),
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
            if (cityErr || !cityRow) throw cityErr ?? new Error("no city row returned");

            const fake: CityExploreData = randomCityData({ ...city, cityId: cityRow.id });
            const { error: scoreErr } = await supabase.from("city_scores").upsert({
              city_id: cityRow.id,
              data: fake,
              piltri_score: fake.piltriScore,
              section_scores: fake.sectionScores,
              last_updated: fake.lastUpdated,
            });
            if (scoreErr) throw scoreErr;
          } else {
            const fake: CityExploreData = randomCityData(city);
            seedMemoryCache(citySlug(city), fake, CACHE_TTL_MS);
          }
          seeded++;
        } catch (err) {
          failed++;
          failedCities.push(city.cityName);
          console.error(`Random seed failed for ${city.cityName}:`, err);
        }
      })
    );
  }

  return NextResponse.json({
    total: cities.length,
    seeded,
    failed,
    failedCities: failedCities.slice(0, 20),
    storage: supabase ? "supabase" : "in-memory (Supabase not configured in .env.local - resets on next server restart)",
    note: "Random test data written to the cache - re-run a real search (or POST /api/admin/warm-cache) to overwrite these with live data before this is shown to real users.",
  });
}
