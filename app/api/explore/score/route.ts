import { NextRequest, NextResponse } from "next/server";
import { getCityExploreData } from "@/lib/dataset/load";

/**
 * GET /api/explore/score?countryCode=&lat=&lng=&cityId=  (city/region/country accepted but not needed)
 * Returns the full CityExploreData for that shortlisted city (by cityId,
 * else the one nearest the point), assembled from the precomputed dataset - no live API
 * calls. Responses are cached at Vercel's edge: the data only changes when
 * a new dataset is published.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const countryCode = params.get("countryCode");

  if (!countryCode || !Number.isFinite(lat) || !Number.isFinite(lng) || params.get("lat") === null || params.get("lng") === null) {
    return NextResponse.json({ error: "Missing required params: countryCode, lat, lng" }, { status: 400 });
  }

  try {
    const data = await getCityExploreData(countryCode, lat, lng, params.get("cityId"));
    if (!data) return NextResponse.json({ error: "No data for this location" }, { status: 404 });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error("Score lookup failed:", err);
    return NextResponse.json({ error: "Failed to load city data" }, { status: 500 });
  }
}
