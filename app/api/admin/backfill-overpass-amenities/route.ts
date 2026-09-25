import { NextRequest, NextResponse } from "next/server";
import { backfillOverpassAmenities } from "@/lib/aggregation/backfillOverpassAmenities";
import { isAdminRequest } from "@/lib/adminAuth";

export const maxDuration = 60;

// Same margin reasoning as backfill-wikidata-population's own DEADLINE_MS:
// the deadline check runs BEFORE each city's lookup, so real worst-case
// wall time is DEADLINE_MS + one more in-flight city's own timeout
// (FAR_LOOKUP_TIMEOUT_MS = 20s, see backfillOverpassAmenities.ts).
// 30000 + 20000 = 50s stays under Vercel's 60s maxDuration with a real
// margin, rather than the deadline itself flirting with the ceiling.
const DEADLINE_MS = 30000;

/**
 * POST /api/admin/backfill-overpass-amenities
 *
 * One-time (resumable) maintenance action — computes cities.overpass_amenities
 * (restaurant/green-space/cultural/family density, train/subway/tram/
 * airport/bus/school/university presence, distance to beach/mountain/
 * forest) for as many not-yet-checked shortlisted cities as fit in one
 * deadline-bounded, paced call (see lib/aggregation/backfillOverpassAmenities.ts).
 * Call repeatedly (the /admin page's "Backfill Overpass amenities" button
 * does this automatically) until `remaining` reads 0.
 *
 * Gated by ADMIN_PASSWORD (see lib/adminAuth.ts), same as every other
 * /api/admin/* route.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await backfillOverpassAmenities({ deadlineMs: DEADLINE_MS });
  return NextResponse.json(result);
}
