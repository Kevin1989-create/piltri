import { NextRequest, NextResponse } from "next/server";
import { getDiscoverCities } from "@/lib/discoverCities";
import { citySlug, getCachedCityDataBatch } from "@/lib/aggregation/cache";
import { isAdminRequest } from "@/lib/adminAuth";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type { CitySearchResult } from "@/lib/types";

const IN_CLAUSE_CHUNK_SIZE = 300;

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
  try {
    const supabase = getSupabaseServiceClient();
    const slugs = cityInputs.map((c) => citySlug(c));
    for (let i = 0; i < slugs.length; i += IN_CLAUSE_CHUNK_SIZE) {
      const { data, error } = await supabase
        .from("cities")
        .select("osm_land_area_km2, osm_land_area_checked_at")
        .in("slug", slugs.slice(i, i + IN_CLAUSE_CHUNK_SIZE))
        .not("osm_land_area_checked_at", "is", null);
      if (error) {
        console.error("admin/status: land-area chunk read failed:", error);
        continue;
      }
      for (const row of data ?? []) {
        landAreaChecked++;
        if (row.osm_land_area_km2 != null) landAreaFound++;
      }
    }
  } catch (err) {
    console.error("admin/status: land-area coverage read failed:", err);
  }

  return NextResponse.json({
    totalCities: cityInputs.length,
    countries,
    freshCities: fresh.size,
    staleCities: cityInputs.length - fresh.size,
    cacheTtlDays: Number(process.env.CACHE_TTL_DAYS ?? 30),
    landAreaChecked,
    landAreaFound,
  });
}
