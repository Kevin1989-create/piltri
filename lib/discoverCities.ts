import discoverCitiesJson from "@/data/static/discover-cities.json";
import type { DiscoverCity } from "@/lib/types";

/** Static shortlist of ~6,300 world cities (population 100,000+) Discover
 *  mode can scan — built from GeoNames' free, public-domain cities15000
 *  dataset (http://download.geonames.org/export/dump/), not hand-curated.
 *  Not exhaustive (every real data source behind the scored model works for
 *  any city on Earth, not just this list — see HANDOFF.md), but this is the
 *  fixed candidate list Advanced search needs to scan server-side. */
export function getDiscoverCities(): DiscoverCity[] {
  return discoverCitiesJson as DiscoverCity[];
}

export interface DiscoverCountry {
  country: string;
  countryCode: string;
  cities: DiscoverCity[];
}

/** The same shortlist, grouped by country — Advanced search's "country"
 *  scope (see lib/advancedSearch/criteria.ts). There's no separate
 *  country-level dataset; a country's results are a genuine roll-up of
 *  whichever of these ~500 cities sit in it (191 countries covered, many
 *  with just 1-2 cities) — not an authoritative national statistic. That's
 *  disclosed to the user via citiesTracked on each result, not hidden. */
export function getDiscoverCountries(): DiscoverCountry[] {
  const byCode = new Map<string, DiscoverCountry>();
  for (const city of getDiscoverCities()) {
    const existing = byCode.get(city.countryCode);
    if (existing) {
      existing.cities.push(city);
    } else {
      byCode.set(city.countryCode, { country: city.country, countryCode: city.countryCode, cities: [city] });
    }
  }
  return Array.from(byCode.values());
}
