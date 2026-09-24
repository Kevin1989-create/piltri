import { getDiscoverCities } from "@/lib/discoverCities";
import { getCityPopulationAndArea } from "@/lib/data-sources/wikidata";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { citySlug } from "./cache";

// Wikidata's query service has no hard documented per-second limit the way
// Nominatim's usage policy does, but it's a shared free service we've
// directly observed struggling under normal load (see HANDOFF.md,
// 2026-09-24) - paced gently rather than fired as fast as possible, same
// spirit as backfillLandArea.ts's REQUEST_PACE_MS even though the exact
// number differs.
const REQUEST_PACE_MS = 800;

// Same silent-failure class of bug backfillLandArea.ts's own comment
// documents for cache.ts's IN_CLAUSE_CHUNK_SIZE - an unchunked `.in()`
// across the full ~6,300-city shortlist risks the request URL exceeding
// practical limits.
const IN_CLAUSE_CHUNK_SIZE = 300;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BackfillWikidataPopulationResult {
  total: number;
  alreadyChecked: number;
  attempted: number;
  found: number;
  notFound: number;
  failed: number;
  remaining: number;
  stoppedReason: "exhausted" | "deadline";
}

/**
 * One-time (resumable) backfill of cities.wikidata_population/wikidata_area_km2
 * across the full ~6,300-city shortlist - see those columns' comment in
 * schema.sql for why this exists: getCityPopulationAndArea used to be
 * called live on every cache miss (aggregate.ts), which meant every
 * Explore search for a not-yet-cached shortlisted city depended on
 * Wikidata's query service answering within a few seconds, and that
 * service has real, demonstrated reliability problems independent of the
 * underlying data (confirmed live 2026-09-24: even a trivial `ASK { ?s ?p
 * ?o }` query timed out after 30s, while Wikidata's own wiki pages loaded
 * fine - the query service specifically, not Wikidata/Wikimedia broadly).
 *
 * Exact same shape as backfillLandArea.ts: resumable via
 * wikidata_checked_at (set regardless of whether a population/area value
 * was actually found - a real "checked, nothing there" is not the same as
 * "not attempted yet", and shouldn't be retried on every subsequent call).
 * Call repeatedly (the /admin page's "Backfill Wikidata population" button
 * does this automatically) until `remaining` reads 0.
 */
export async function backfillWikidataPopulation(options: { deadlineMs?: number } = {}): Promise<BackfillWikidataPopulationResult> {
  const { deadlineMs } = options;
  const startedAt = Date.now();

  const cities = getDiscoverCities();
  const supabase = getSupabaseServiceClient();

  const upsertRows = cities.map((c) => ({
    slug: citySlug(c),
    city_name: c.cityName,
    region: c.region,
    country: c.country,
    country_code: c.countryCode,
    lat: c.lat,
    lng: c.lng,
  }));
  for (const rowsChunk of chunk(upsertRows, IN_CLAUSE_CHUNK_SIZE)) {
    const { error } = await supabase.from("cities").upsert(rowsChunk, { onConflict: "slug", ignoreDuplicates: true });
    if (error) console.error("backfillWikidataPopulation: cities upsert chunk failed:", error);
  }

  const slugChunks = chunk(
    cities.map((c) => citySlug(c)),
    IN_CLAUSE_CHUNK_SIZE
  );
  const readResults = await Promise.all(
    slugChunks.map((slugChunk) =>
      supabase.from("cities").select("id, slug, city_name, lat, lng").in("slug", slugChunk).is("wikidata_checked_at", null)
    )
  );

  const candidates: { id: string; slug: string; city_name: string; lat: number; lng: number }[] = [];
  for (const { data, error } of readResults) {
    if (error) {
      console.error("backfillWikidataPopulation: read failed for a chunk:", error);
      continue;
    }
    if (data) candidates.push(...data);
  }
  const alreadyChecked = cities.length - candidates.length;

  let attempted = 0;
  let found = 0;
  let notFound = 0;
  let failed = 0;
  let stoppedReason: BackfillWikidataPopulationResult["stoppedReason"] = "exhausted";

  for (let i = 0; i < candidates.length; i++) {
    if (deadlineMs != null && Date.now() - startedAt >= deadlineMs) {
      stoppedReason = "deadline";
      break;
    }

    const row = candidates[i];
    attempted++;
    try {
      const { population, areaKm2 } = await getCityPopulationAndArea(row.lat, row.lng, row.city_name);
      await supabase
        .from("cities")
        .update({ wikidata_population: population, wikidata_area_km2: areaKm2, wikidata_checked_at: new Date().toISOString() })
        .eq("id", row.id);
      if (population != null || areaKm2 != null) found++;
      else notFound++;
    } catch (err) {
      console.error(`backfillWikidataPopulation: lookup failed for ${row.city_name}:`, err);
      failed++;
      // Deliberately NOT marked checked, same reasoning as
      // backfillLandArea.ts - a transient failure (timeout, momentary
      // WDQS hiccup) should retry naturally on the next call rather than
      // risk permanently skipping a city over one bad request.
    }

    if (i < candidates.length - 1) await sleep(REQUEST_PACE_MS);
  }

  return {
    total: cities.length,
    alreadyChecked,
    attempted,
    found,
    notFound,
    failed,
    remaining: candidates.length - attempted,
    stoppedReason,
  };
}
