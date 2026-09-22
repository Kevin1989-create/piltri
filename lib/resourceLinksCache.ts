import type { ResourceLinksByCategory } from "@/lib/types";

const EMPTY: ResourceLinksByCategory = { home: [], immigration: [], health: [], jobs: [] };

const cache = new Map<string, Promise<ResourceLinksByCategory>>();

/** Kicks off (or reuses) the Resources links fetch for a country. Callers
 *  that mount well before the user actually opens Resources (SectionColumn,
 *  as soon as it knows the city's countryCode) call this early so the
 *  network round trip has usually already finished by the time
 *  ResourcesDetail mounts and awaits the same cached promise - avoiding the
 *  click-to-open loading flash a fresh fetch-on-open would otherwise show
 *  for what's meant to be a basic, instant display. */
export function prefetchResourceLinks(countryCode: string): Promise<ResourceLinksByCategory> {
  let entry = cache.get(countryCode);
  if (!entry) {
    entry = fetch(`/api/explore/resource-links?countryCode=${countryCode}`)
      .then((res) => res.json())
      .then((body) => body.links as ResourceLinksByCategory)
      .catch(() => EMPTY);
    cache.set(countryCode, entry);
  }
  return entry;
}
