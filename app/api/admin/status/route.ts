import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { manifest } from "@/lib/dataset/files";

/** GET /api/admin/status - which precomputed dataset this deployment serves
 *  (version, build date, counts, sources). Also the /admin pages' login
 *  check. The dataset is rebuilt offline (see pipeline/README.md). */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tiles: _t, chunks: _c, countryNames: _n, searchFiles: _s, advCityColumns: _a, ...summary } = manifest;
  return NextResponse.json({ dataset: summary });
}
