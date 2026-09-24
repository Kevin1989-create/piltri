import { NextRequest, NextResponse } from "next/server";
import { backfillWikidataPopulation } from "@/lib/aggregation/backfillWikidataPopulation";
import { isAdminRequest } from "@/lib/adminAuth";

export const maxDuration = 60;

// The deadline check runs BEFORE starting each city's lookup, not after -
// so the real worst-case wall time is DEADLINE_MS + one more in-flight
// lookup's own timeout (PER_CITY_TIMEOUT_MS = 20s, see
// backfillWikidataPopulation.ts). 50000 + 20000 = 70s blew straight past
// maxDuration=60s, and Vercel killed the function outright rather than
// letting it return a result - confirmed live 2026-09-24 ("Request failed"
// with 0 progress, even though individual lookups were succeeding).
// 30000 leaves a genuine ~10s margin (30 + 20 = 50, under 60) the same way
// backfill-land-area's own DEADLINE_MS reasoning already describes.
const DEADLINE_MS = 30000;

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
