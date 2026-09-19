import { NextRequest, NextResponse } from "next/server";
import { searchPlaces } from "@/lib/data-sources/mapbox";

/** GET /api/explore/search?q=lis -> CitySearchResult[] (Explore search suggestions). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length === 0) {
    return NextResponse.json([]);
  }

  try {
    const results = await searchPlaces(q);
    return NextResponse.json(results);
  } catch (err) {
    console.error("Search failed:", err);
    return NextResponse.json([], { status: 200 }); // fail soft — suggestions just don't appear
  }
}
