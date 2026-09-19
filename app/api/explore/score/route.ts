import { NextRequest, NextResponse } from "next/server";
import { getOrAggregateCityData } from "@/lib/aggregation/cache";
import type { CitySearchResult } from "@/lib/types";

/**
 * GET /api/explore/score?cityId=&city=&country=&countryCode=&region=&lat=&lng=
 * Returns the full CityExploreData (39 fields + section scores + Piltri score),
 * served from Supabase cache when fresh, otherwise aggregated live (4.3-4.5).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const cityName = params.get("city");

  if (!cityName || Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "Missing required params: city, lat, lng" }, { status: 400 });
  }

  const city: CitySearchResult = {
    cityId: params.get("cityId") ?? `${cityName}-${lat}-${lng}`,
    cityName,
    region: params.get("region"),
    country: params.get("country") ?? "Unknown",
    countryCode: params.get("countryCode") ?? "US",
    lat,
    lng,
  };

  try {
    const data = await getOrAggregateCityData(city);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Score aggregation failed:", err);
    return NextResponse.json({ error: "Failed to aggregate city data" }, { status: 500 });
  }
}
