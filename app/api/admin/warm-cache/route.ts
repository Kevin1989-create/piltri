import { NextRequest, NextResponse } from "next/server";
import { warmCache } from "@/lib/aggregation/warmCache";
import { isAdminRequest } from "@/lib/adminAuth";

export const maxDuration = 60;

// Same reasoning as the cron tick's DEADLINE_MS (see
// app/api/cron/warm-cache-tick/route.ts, including why this is 30s, not
// closer to the 60s ceiling): a single serverless invocation can never
// safely run for the hour+ a full ~6,300-city sweep takes, no matter who's
// calling it or whether a `limit` was given - this bounds every call so it
// always returns before Vercel would kill it. A genuine "warm everything"
// sweep is done by calling this endpoint repeatedly until `remaining`
// reads 0 (see the /admin page, which does exactly that for its "Warm
// everything stale" button) rather than by making one call try to do it
// all at once.
const DEADLINE_MS = 30000;

/**
 * POST /api/admin/warm-cache?limit=200
 *
 * Manual maintenance action — warms as many stale/missing shortlisted
 * cities as fit in one deadline-bounded call (`?limit=N` additionally
 * caps the candidate count, if you want a smaller batch than the deadline
 * would otherwise allow). Call it repeatedly (the /admin page's buttons
 * do this automatically) to work through the whole shortlist — same
 * shared `warmCache()` (lib/aggregation/warmCache.ts) the scheduled cron
 * tick uses, just triggered manually instead of on a timer.
 *
 * Gated by ADMIN_PASSWORD (see lib/adminAuth.ts) — call it via the /admin
 * back-office page, or `curl -H "Authorization: Bearer $ADMIN_PASSWORD"`.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const result = await warmCache({ limit, deadlineMs: DEADLINE_MS });
  return NextResponse.json(result);
}
