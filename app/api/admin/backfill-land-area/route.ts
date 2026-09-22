import { NextRequest, NextResponse } from "next/server";
import { backfillLandArea } from "@/lib/aggregation/backfillLandArea";
import { isAdminRequest } from "@/lib/adminAuth";

export const maxDuration = 60;

// Nominatim's strict 1 request/second means one invocation can only get
// through ~45-50 cities before Vercel's function ceiling, versus warm-cache's
// hundreds - deliberately conservative relative to the 60s maxDuration
// above, same reasoning as warm-cache's own DEADLINE_MS (leaves margin for
// one in-flight request's own timeout to land before Vercel would kill the
// function outright).
const DEADLINE_MS = 45000;

/**
 * POST /api/admin/backfill-land-area
 *
 * One-time (resumable) maintenance action — computes cities.osm_land_area_km2
 * from a real Nominatim/OSM boundary polygon for as many not-yet-checked
 * shortlisted cities as fit in one deadline-bounded, 1-req/sec-paced call
 * (see lib/aggregation/backfillLandArea.ts). Call repeatedly (the /admin
 * page's "Backfill land area" button does this automatically) until
 * `remaining` reads 0 - given the full ~6,300-city shortlist at ~1
 * city/second, that's dozens of calls, not one.
 *
 * Gated by ADMIN_PASSWORD (see lib/adminAuth.ts), same as every other
 * /api/admin/* route.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await backfillLandArea({ deadlineMs: DEADLINE_MS });
  return NextResponse.json(result);
}
