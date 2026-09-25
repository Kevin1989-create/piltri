import { NextRequest, NextResponse } from "next/server";
import { getDiscoverCities } from "@/lib/discoverCities";
import { citySlug, getCachedCityDataBatch } from "@/lib/aggregation/cache";
import { isAdminRequest } from "@/lib/adminAuth";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type { CitySearchResult } from "@/lib/types";

const IN_CLAUSE_CHUNK_SIZE = 300;

// ~221 chunks at the ~66,300-city shortlist's current size (2026-09-24) -
// explicit ceiling as a safety net against Vercel's route default, same
// as the backfill routes already declare.
export const maxDuration = 60;

/**
 * GET /api/admin/status — coverage snapshot for the /admin back-office
 * page: how many of the shortlisted cities currently have a fresh
 * (< CACHE_TTL_DAYS old) cached score vs. how many are stale/missing, plus
 * how far the one-time OSM land-area backfill (see
 * lib/aggregation/backfillLandArea.ts) has gotten. Read-only, cheap (same
 * 2-query batch read Advanced search's "Search all" uses, see
 * getCachedCityDataBatch) — safe to poll on every page load of /admin.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const fresh = await getCachedCityDataBatch(cityInputs);
  const countries = new Set(cities.map((c) => c.countryCode)).size;

  let landAreaChecked = 0;
  let landAreaFound = 0;
  let wikidataChecked = 0;
  let wikidataFound = 0;
  let overpassChecked = 0;
  let overpassFound = 0;
  try {
    const supabase = getSupabaseServiceClient();
    const slugs = cityInputs.map((c) => citySlug(c));
    const slugChunks: string[][] = [];
    for (let i = 0; i < slugs.length; i += IN_CLAUSE_CHUNK_SIZE) slugChunks.push(slugs.slice(i, i + IN_CLAUSE_CHUNK_SIZE));

    // Parallel (Promise.all), not sequential - same fix as
    // getCachedCityDataBatch's own chunks already apply (see cache.ts's
    // comment: ~21 chunks sequential measured ~2.7s total). This endpoint
    // used to award one at a time, fine at the old ~21-chunk shortlist
    // size but not at ~221 chunks after the shortlist widened to ~66,300
    // cities (2026-09-24) - confirmed live it was taking 20s+ per call.
    const chunkResults = await Promise.all(
      slugChunks.map((slice) =>
        supabase
          .from("cities")
          .select(
            "osm_land_area_km2, osm_land_area_checked_at, wikidata_population, wikidata_area_km2, wikidata_checked_at, overpass_amenities, overpass_checked_at"
          )
          .in("slug", slice)
      )
    );
    for (const { data, error } of chunkResults) {
      if (error) {
        console.error("admin/status: coverage chunk read failed:", error);
        continue;
      }
      for (const row of data ?? []) {
        if (row.osm_land_area_checked_at != null) {
          landAreaChecked++;
          if (row.osm_land_area_km2 != null) landAreaFound++;
        }
        if (row.wikidata_checked_at != null) {
          wikidataChecked++;
          if (row.wikidata_population != null || row.wikidata_area_km2 != null) wikidataFound++;
        }
        if (row.overpass_checked_at != null) {
          overpassChecked++;
          if (row.overpass_amenities != null) overpassFound++;
        }
      }
    }
  } catch (err) {
    console.error("admin/status: coverage read failed:", err);
  }

  return NextResponse.json({
    totalCities: cityInputs.length,
    countries,
    freshCities: fresh.size,
    staleCities: cityInputs.length - fresh.size,
    cacheTtlDays: Number(process.env.CACHE_TTL_DAYS ?? 30),
    landAreaChecked,
    landAreaFound,
    wikidataChecked,
    wikidataFound,
    overpassChecked,
    overpassFound,
  });
}
