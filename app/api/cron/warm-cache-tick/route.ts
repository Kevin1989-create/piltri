import { NextRequest, NextResponse } from "next/server";
import { warmCache } from "@/lib/aggregation/warmCache";
import { isCronOrAdminRequest } from "@/lib/adminAuth";

// Vercel-specific route config: request up to 60s (the Hobby-plan
// ceiling) for this route specifically, since the default is much shorter.
export const maxDuration = 60;

// warmCache only checks the deadline *between* batches, not during one -
// so the real worst-case total is this value PLUS one batch's own worst
// case (~12s, see BATCH_CLIENT_TIMEOUT_MS in lib/data-sources/overpass.ts),
// plus cold start/DB/serialization overhead. A real production test at
// 45000 measured ~56s total against a 60s maxDuration - too close for
// comfort. 30s leaves a real margin (30 + ~12 + a few seconds of overhead
// stays comfortably under 60s) rather than one that happened to survive a
// single test.
const DEADLINE_MS = 30000;

/**
 * POST /api/cron/warm-cache-tick
 *
 * Scheduled by vercel.json's `crons` entry (once daily — Vercel Cron's
 * own frequency floor on non-Enterprise plans). Warms as many stale/
 * missing cities as fit inside DEADLINE_MS rather than a fixed count —
 * see warmCache's doc comment for why: Overpass's real latency varies too
 * much day to day for a fixed city count to be safe (a production run
 * with a fixed count of 80 genuinely hit Vercel's 60s timeout and
 * returned nothing). Naturally resumable — no persisted cursor needed;
 * each tick just picks up whatever's still stale.
 *
 * Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically
 * on every real cron invocation once CRON_SECRET is set in env vars (see
 * lib/adminAuth.ts) — this also accepts an admin request, so the /admin
 * page's "warm now" button can trigger the exact same time-boxed
 * behaviour instead of the unbounded full-sweep admin endpoint.
 */
export async function POST(req: NextRequest) {
  if (!isCronOrAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await warmCache({ deadlineMs: DEADLINE_MS });
  return NextResponse.json(result);
}

// Vercel Cron sends a GET request by default unless configured otherwise —
// support both so the vercel.json entry doesn't need extra config.
export const GET = POST;
