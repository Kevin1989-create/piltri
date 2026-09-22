import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { RESOURCE_LINK_CATEGORIES, type ResourceLinkCategory } from "@/lib/types";

/**
 * Admin CRUD for country_resource_links (see schema.sql) - backs the
 * "Manage Resources" section of /admin. Deliberately simple (no pagination,
 * no bulk import): this list is meant to stay small by design (a handful
 * of links per country, not a directory), so a plain list-and-form is
 * enough.
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

/** GET /api/admin/resource-links?countryCode=GB — every link for a country, unfiltered by category. */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const countryCode = req.nextUrl.searchParams.get("countryCode")?.trim();
  if (!countryCode) return NextResponse.json({ error: "Missing required param: countryCode" }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("country_resource_links")
    .select("id, category, title, url, created_at")
    .eq("country_code", countryCode.toUpperCase())
    .order("category")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ links: data ?? [] });
}

/** POST /api/admin/resource-links — body: { countryCode, category, title, url }. */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const countryCode = typeof body?.countryCode === "string" ? body.countryCode.trim().toUpperCase() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const category = body?.category;

  if (!countryCode || countryCode.length !== 2) {
    return NextResponse.json({ error: "countryCode must be a 2-letter ISO code" }, { status: 400 });
  }
  if (!isValidCategory(category)) {
    return NextResponse.json({ error: `category must be one of: ${RESOURCE_LINK_CATEGORIES.join(", ")}` }, { status: 400 });
  }
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!isValidUrl(url)) return NextResponse.json({ error: "url must be a valid http(s) URL" }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("country_resource_links")
    .insert({ country_code: countryCode, category, title, url })
    .select("id, category, title, url")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ link: data });
}

/** DELETE /api/admin/resource-links?id=<uuid> */
export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing required param: id" }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("country_resource_links").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
