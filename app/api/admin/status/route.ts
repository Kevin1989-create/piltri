import { NextRequest, NextResponse } from "next/server";
import { getDiscoverCities } from "@/lib/discoverCities";
import { citySlug, getCachedCityDataBatch } from "@/lib/aggregation/cache";
import { isAdminRequest } from "@/lib/adminAuth";
import type { CitySearchResult } from "@/lib/types";

/**
 * GET /api/admin/status — coverage snapshot for the /admin back-office
 * page: how many of the shortlisted cities currently have a fresh
 * (< CACHE_TTL_DAYS old) cached score vs. how many are stale/missing.
 * Read-only, cheap (same 2-query batch read Advanced search's "Search
 * all" uses, see getCachedCityDataBatch) — safe to poll on every page
 * load of /admin.
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

  return NextResponse.json({
    totalCities: cityInputs.length,
    countries,
    freshCities: fresh.size,
    staleCities: cityInputs.length - fresh.size,
    cacheTtlDays: Number(process.env.CACHE_TTL_DAYS ?? 30),
  });
}
