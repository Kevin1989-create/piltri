import { NextRequest, NextResponse } from "next/server";
import { warmCache } from "@/lib/aggregation/warmCache";
import { isAdminRequest } from "@/lib/adminAuth";

/**
 * POST /api/admin/warm-cache?limit=200
 *
 * Manual maintenance action — walks the ~6,300-city shortlist and
 * populates the Supabase cache for every city that isn't already fresh.
 * With no `limit`, this is a full sweep and can take a long time on a
 * cold cache (the ~6,300-city shortlist at this endpoint's pacing is on
 * the order of an hour+ for a fully cold run) — pass `limit` to bound a
 * single call, same as the scheduled cron tick does automatically (see
 * /api/cron/warm-cache-tick). Both call the same shared warmCache()
 * (lib/aggregation/warmCache.ts), so behaviour is identical either way.
 *
 * Gated by ADMIN_PASSWORD (see lib/adminAuth.ts) — call it via the /admin
 * back-office page, or `curl -H "Authorization: Bearer $ADMIN_PASSWORD"`.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const result = await warmCache(limit);
  return NextResponse.json(result);
}
