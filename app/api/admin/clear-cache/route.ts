import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/clear-cache
 *
 * One-off maintenance action: deletes every row from city_scores (the
 * cached CityExploreData blobs), without touching the `cities` table
 * (harmless metadata: slug/name/lat/lng). Needed whenever the *shape* of
 * CityExploreData changes (a field renamed, removed, or added) — the normal
 * TTL-based freshness check in lib/aggregation/cache.ts only looks at how
 * old a cached row is, not whether its shape still matches the current
 * code, so an old-shaped-but-still-"fresh" row would otherwise keep being
 * served as-is (showing "undefined" for any renamed/new field) until its
 * 30-day TTL happens to expire on its own.
 *
 * Safe to run any time: every row here is fully re-derivable by calling
 * POST /api/admin/warm-cache afterwards (or just letting normal browsing
 * re-aggregate cities on demand) — nothing here is a source of truth.
 *
 * No auth here, same as the other /api/admin/* endpoints — fine while this
 * stays effectively private, but add a shared-secret header check before
 * any of these could be publicly discovered and hit by someone else.
 */
export async function POST() {
  const supabase = getSupabaseServiceClient();
  // Supabase's delete requires a filter — `neq` on a column that's never
  // actually null (city_id is a not-null primary key) is the standard way
  // to express "delete every row" without a raw SQL escape hatch.
  const { error, count } = await supabase.from("city_scores").delete({ count: "exact" }).not("city_id", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ cleared: count ?? 0 });
}
