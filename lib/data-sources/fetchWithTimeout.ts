/**
 * Every data source Piltri calls is a free, third-party public API with no
 * SLA — World Bank, Overpass, WHO's GHO OData API in particular are known
 * to be slow or to hang entirely under load. Plain `fetch` has no default
 * timeout, so a single slow source could drag out an entire Explore search
 * or pin lookup (which otherwise runs its sources in parallel and is only
 * as fast as the slowest one). This wraps `fetch` with an AbortController so
 * a source that doesn't respond in time fails fast instead of hanging —
 * callers already treat failures as "use the fallback/default", so this
 * turns a possible multi-second (or indefinite) stall into a bounded one.
 *
 * Callers should pass `cache: "no-store"`, not `next: { revalidate }`.
 * These fetches used to opt into Next's persistent Data Cache (up to a
 * 30-day revalidate window) - found, while chasing a bug where a city's
 * Wikidata population lookup was wrong even after the query itself was
 * fixed and verified fast, that Next's cache had permanently memorised an
 * earlier empty/degenerate response for that exact request (most likely
 * from a request that got aborted by this same timeout while contending
 * with other concurrent calls to the same endpoint) and kept serving it
 * instantly (no network call) on every later run, cache-fix or not. That
 * risk applies to any of these third-party calls, not just Wikidata's,
 * since all of them can time out under load per the paragraph above. The
 * real cache that matters here is the Supabase city_scores table (see
 * lib/aggregation/cache.ts) - it's explicit, per-city, and refreshed on a
 * known schedule; an unmanaged fetch-level cache underneath it only adds
 * a way for a transient failure to silently become a long-lived wrong
 * answer.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
