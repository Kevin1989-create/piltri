import { NextRequest, NextResponse } from "next/server";
import { searchCities } from "@/lib/dataset/search";

/** GET /api/explore/search?q=lis -> CitySearchResult[] (search suggestions,
 *  from the bundled city shortlist - no external geocoding call). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json([]);
  return NextResponse.json(searchCities(q), {
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
