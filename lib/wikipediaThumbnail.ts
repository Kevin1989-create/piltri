"use client";

import { useEffect, useState } from "react";

/**
 * Best-effort city/country photo for Advanced search result cards, sourced
 * from Wikipedia's public REST summary API (no API key, CORS-enabled for
 * direct browser fetches — https://en.wikipedia.org/api/rest_v1/page/summary/<title>).
 *
 * Honest limitations, disclosed rather than hidden:
 *  - Coverage isn't universal. Smaller cities may have no Wikipedia page, or
 *    one with no lead image — those cards fall back to a plain placeholder
 *    (see ResultCard.tsx), not a broken image.
 *  - Common city names are ambiguous ("Springfield", "Paris" as a small US
 *    town, etc.). We ask for `cityName` first and, if the result looks like
 *    a disambiguation page, retry once with `cityName, country` appended -
 *    a reasonable improvement, not a guarantee of the right photo every
 *    time.
 *  - Country lookups use the country name directly, which is far less
 *    ambiguous and should resolve correctly almost always.
 *
 * Results are cached in memory (module-level, not persisted) so switching
 * sort order or paging back and forth doesn't re-fetch the same title.
 */

interface ThumbnailResult {
  src: string | null;
  loading: boolean;
}

const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

async function fetchSummaryThumbnail(title: string): Promise<{ src: string | null; isDisambiguation: boolean }> {
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { src: null, isDisambiguation: false };
    const body = await res.json();
    return {
      src: body?.thumbnail?.source ?? null,
      isDisambiguation: body?.type === "disambiguation",
    };
  } catch {
    return { src: null, isDisambiguation: false };
  }
}

async function resolveThumbnail(primaryTitle: string, fallbackTitle?: string): Promise<string | null> {
  const primary = await fetchSummaryThumbnail(primaryTitle);
  if (primary.src && !primary.isDisambiguation) return primary.src;
  if (fallbackTitle) {
    const fallback = await fetchSummaryThumbnail(fallbackTitle);
    if (fallback.src) return fallback.src;
  }
  return primary.src; // whatever we got (possibly null) if the fallback didn't help either
}

/** `title` is tried first (e.g. the bare city or country name); `fallbackTitle`
 *  (e.g. "City, Country") is only tried if the first lookup comes back empty
 *  or looks like a disambiguation page. */
export function useWikipediaThumbnail(title: string, fallbackTitle?: string): ThumbnailResult {
  const cacheKey = `${title}|${fallbackTitle ?? ""}`;
  const [src, setSrc] = useState<string | null>(cache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(!cache.has(cacheKey));

  useEffect(() => {
    if (!title) {
      setSrc(null);
      setLoading(false);
      return;
    }
    if (cache.has(cacheKey)) {
      setSrc(cache.get(cacheKey) ?? null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    let promise = inFlight.get(cacheKey);
    if (!promise) {
      promise = resolveThumbnail(title, fallbackTitle);
      inFlight.set(cacheKey, promise);
    }

    promise
      .then((result) => {
        cache.set(cacheKey, result);
        if (!cancelled) {
          setSrc(result);
          setLoading(false);
        }
      })
      .finally(() => inFlight.delete(cacheKey));

    return () => {
      cancelled = true;
    };
  }, [cacheKey, title, fallbackTitle]);

  return { src, loading };
}
