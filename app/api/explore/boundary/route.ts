import { NextRequest, NextResponse } from "next/server";
import { getPlaceBoundary } from "@/lib/data-sources/nominatim";

/**
 * GET /api/explore/boundary?q=<place name>
 * Returns { geometry, bbox } for the real administrative boundary of the
 * searched place, or { geometry: null, bbox: null } if none was found (the
 * map falls back to a fixed-radius circle in that case).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing required param: q" }, { status: 400 });
  }

  try {
    const boundary = await getPlaceBoundary(q);
    if (!boundary) {
      return NextResponse.json({ geometry: null, bbox: null });
    }
    return NextResponse.json(boundary);
  } catch (err) {
    console.error("Boundary lookup failed:", err);
    return NextResponse.json({ geometry: null, bbox: null });
  }
}
