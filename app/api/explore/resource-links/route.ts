import { NextRequest, NextResponse } from "next/server";
import { getCountryResourceLinks } from "@/lib/data-sources/resourceLinks";

/**
 * GET /api/explore/resource-links?countryCode=<ISO alpha-2>
 * Returns this country's hand-curated Resources links, grouped by
 * category (home/immigration/health/jobs) - see lib/types.ts's
 * ResourceLinkCategory doc comment. Read live from Supabase (not the
 * static dataset) so an edit in /admin shows up immediately.
 */
export async function GET(req: NextRequest) {
  const countryCode = req.nextUrl.searchParams.get("countryCode")?.trim();
  if (!countryCode) {
    return NextResponse.json({ error: "Missing required param: countryCode" }, { status: 400 });
  }

  const links = await getCountryResourceLinks(countryCode);
  return NextResponse.json({ links });
}
