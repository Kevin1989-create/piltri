import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { RESOURCE_LINK_CATEGORIES, type ResourceLinkCategory } from "@/lib/types";

/**
 * POST /api/admin/resource-links/bulk — body: { links: [{countryCode,
 * category, title, url}, ...] }. Added 2026-09-23 alongside the "curate
 * all 171 shortlisted countries" push - the single-link POST on
 * resource-links/route.ts is fine for one-off additions via the /admin
 * UI, but issuing one HTTP round trip per link when adding hundreds at
 * once is real, avoidable overhead. Same validation as the single-link
 * route, just batched; invalid rows are skipped (reported back, not
 * silently dropped) rather than failing the whole batch over one bad row.
 */

function isValidCategory(value: unknown): value is ResourceLinkCategory {
  return typeof value === "string" && (RESOURCE_LINK_CATEGORIES as string[]).includes(value);
}

function isValidUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const links = Array.isArray(body?.links) ? body.links : null;
  if (!links) return NextResponse.json({ error: "Body must be { links: [...] }" }, { status: 400 });

  const rows: { country_code: string; category: ResourceLinkCategory; title: string; url: string }[] = [];
  const rejected: { index: number; reason: string }[] = [];

  links.forEach((raw: unknown, index: number) => {
    const link = raw as Record<string, unknown>;
    const countryCode = typeof link?.countryCode === "string" ? link.countryCode.trim().toUpperCase() : "";
    const title = typeof link?.title === "string" ? link.title.trim() : "";
    const url = typeof link?.url === "string" ? link.url.trim() : "";
    const category = link?.category;

    if (countryCode.length !== 2) return rejected.push({ index, reason: "countryCode must be a 2-letter ISO code" });
    if (!isValidCategory(category)) return rejected.push({ index, reason: "invalid category" });
    if (!title) return rejected.push({ index, reason: "title is required" });
    if (!isValidUrl(url)) return rejected.push({ index, reason: "invalid url" });

    rows.push({ country_code: countryCode, category, title, url });
  });

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, rejected }, { status: rejected.length > 0 ? 400 : 200 });
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("country_resource_links").insert(rows).select("id, category, title, url");

  if (error) return NextResponse.json({ error: error.message, rejected }, { status: 500 });
  return NextResponse.json({ inserted: data?.length ?? 0, rejected });
}
