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
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { next?: { revalidate: number } } = {},
  timeoutMs = 6000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
