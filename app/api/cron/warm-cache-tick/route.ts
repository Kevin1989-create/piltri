import { NextRequest, NextResponse } from "next/server";
import { warmCache } from "@/lib/aggregation/warmCache";
import { isCronOrAdminRequest } from "@/lib/adminAuth";

// Sized to comfortably finish within a serverless function's execution
// time limit (Vercel Hobby allows up to 60s with maxDuration below) even
// on a fully cold run: ~CHUNK_SIZE/CONCURRENCY batches * (~1-2s per batch
// + the 600ms inter-batch pause in warmCache) - see that file for the
// pacing rationale (this project's IP got temporarily blocked by Overpass
// once already from too large a burst).
const CHUNK_SIZE = 80;

// Vercel-specific route config: request up to 60s (the Hobby-plan
// ceiling) for this route specifically, since the default is much shorter.
export const maxDuration = 60;

/**
 * POST /api/cron/warm-cache-tick
 *
 * Scheduled by vercel.json's `crons` entry (once daily — Vercel Cron's
 * own frequency floor on non-Enterprise plans). Warms up to CHUNK_SIZE
 * stale/missing cities per call rather than the whole ~6,300-city
 * shortlist in one request, which would blow past any serverless
 * function's time limit. Naturally resumable — see warmCache's doc
 * comment for why no persisted cursor/progress state is needed: at
 * CHUNK_SIZE=80/day this clears roughly one full pass over the shortlist
 * every ~80 days on a already-mostly-warm cache (far more of any given
 * day's run is just cities whose 30-day TTL happens to have lapsed, not
 * genuinely new ones), comfortably inside a "quarterly" freshness target.
 *
 * Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically
 * on every real cron invocation once CRON_SECRET is set in env vars (see
 * lib/adminAuth.ts) — this also accepts an admin request, so the /admin
 * page's "warm now" button can trigger the exact same bounded-chunk
 * behaviour instead of the unbounded full-sweep admin endpoint.
 */
export async function POST(req: NextRequest) {
  if (!isCronOrAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await warmCache(CHUNK_SIZE);
  return NextResponse.json(result);
}

// Vercel Cron sends a GET request by default unless configured otherwise —
// support both so the vercel.json entry doesn't need extra config.
export const GET = POST;
