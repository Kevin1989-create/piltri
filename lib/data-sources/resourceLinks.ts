import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { RESOURCE_LINK_CATEGORIES, type ResourceLink, type ResourceLinksByCategory } from "@/lib/types";

/**
 * Resources — hand-curated external links per country, see
 * lib/types.ts's ResourceLinkCategory doc comment for the full reasoning
 * (why this is its own table, not part of the cached CityExploreData
 * blob). This is a plain, uncached read - the table is small (a handful
 * of rows per country, by design) and this is called once per results-page
 * view, not per candidate in a batch search, so there's no real cost to
 * reading it live every time rather than caching it anywhere.
 */
export async function getCountryResourceLinks(countryCode: string): Promise<ResourceLinksByCategory> {
  const empty: ResourceLinksByCategory = { home: [], immigration: [], health: [], jobs: [] };

  let supabase;
  try {
    supabase = getSupabaseServiceClient();
  } catch {
    return empty;
  }

  const { data, error } = await supabase
    .from("country_resource_links")
    .select("id, category, title, url")
    .eq("country_code", countryCode.toUpperCase())
    .order("created_at", { ascending: true });

  if (error || !data) return empty;

  const result: ResourceLinksByCategory = { home: [], immigration: [], health: [], jobs: [] };
  for (const row of data as ResourceLink[]) {
    if (RESOURCE_LINK_CATEGORIES.includes(row.category)) {
      result[row.category].push({ id: row.id, category: row.category, title: row.title, url: row.url });
    }
  }
  return result;
}
