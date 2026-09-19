import { NextRequest, NextResponse } from "next/server";
import { aggregatePinData } from "@/lib/aggregation/pin";
import { memoize } from "@/lib/aggregation/memoryCache";

const PIN_CACHE_TTL_MS = Number(process.env.CACHE_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000;

/** GET /api/explore/pin?lat=&lng= -> PinnedLocationData (13-field pin mode payload, incl. nearest subway). */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "Missing required params: lat, lng" }, { status: 400 });
  }

  try {
    // In-memory only (pin data isn't cached in Supabase yet, unlike city
    // scores) — but it means re-dropping a pin on the same spot within this
    // session doesn't re-run all 13 fields' worth of live lookups again.
    // Rounded to ~11m so near-identical clicks still hit the same entry.
    const key = `pin:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const data = await memoize(key, PIN_CACHE_TTL_MS, () => aggregatePinData(lat, lng));
    return NextResponse.json(data);
  } catch (err) {
    console.error("Pin aggregation failed:", err);
    return NextResponse.json({ error: "Failed to aggregate pin data" }, { status: 500 });
  }
}
