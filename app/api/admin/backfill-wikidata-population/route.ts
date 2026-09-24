import { NextRequest, NextResponse } from "next/server";
import { backfillWikidataPopulation } from "@/lib/aggregation/backfillWikidataPopulation";
import { isAdminRequest } from "@/lib/adminAuth";

export const maxDuration = 60;

// Paced at 800ms/request (see backfillWikidataPopulation.ts) - a bit less
// conservative than backfill-land-area's DEADLINE_MS since Wikidata's
// query service has no hard documented per-second policy the way
// Nominatim's does, but still leaves real margin against Vercel's function
// ceiling.
const DEADLINE_MS = 50000;

/**
 * POST /api/admin/backfill-wikidata-population
 *
 * One-time (resumable) maintenance action — computes cities.wikidata_population
 * and cities.wikidata_area_km2 from Wikidata for as many not-yet-checked
 * shortlisted cities as fit in one deadline-bounded, paced call (see
 * lib/aggregation/backfillWikidataPopulation.ts). Call repeatedly (the
 * /admin page's "Backfill Wikidata population" button does this
 * automatically) until `remaining` reads 0.
 *
 * Gated by ADMIN_PASSWORD (see lib/adminAuth.ts), same as every other
 * /api/admin/* route.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await backfillWikidataPopulation({ deadlineMs: DEADLINE_MS });
  return NextResponse.json(result);
}
