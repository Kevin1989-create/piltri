import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { getManifest } from "@/lib/dataset/load";

/** GET /api/admin/status - which precomputed dataset the site is serving
 *  (version, when it was built, how many cities/countries, sources). The
 *  dataset is rebuilt and published offline (see pipeline/README.md) - there
 *  is no cache to warm or backfill any more. */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ dataset: await getManifest() });
  } catch (err) {
    return NextResponse.json({ dataset: null, error: err instanceof Error ? err.message : String(err) });
  }
}
