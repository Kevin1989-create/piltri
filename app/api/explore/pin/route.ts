import { NextRequest, NextResponse } from "next/server";
import { getPinnedLocationData } from "@/lib/dataset/pin";

/** GET /api/explore/pin?lat=&lng= -> PinnedLocationData (nearest beach,
 *  mountain, train station, airport) from the published POI tiles. */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Missing required params: lat, lng" }, { status: 400 });
  }
  try {
    const data = await getPinnedLocationData(lat, lng);
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (err) {
    console.error("Pin lookup failed:", err);
    return NextResponse.json({ error: "Failed to load pin data" }, { status: 500 });
  }
}
