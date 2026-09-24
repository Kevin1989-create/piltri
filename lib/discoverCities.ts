import discoverCitiesJson from "@/data/static/discover-cities.json";
import type { DiscoverCity } from "@/lib/types";

/** Static shortlist of ~66,300 world cities (population 5,000+, or a
 *  national capital regardless of size) Discover mode can scan — built
 *  from GeoNames' free, public-domain cities5000 dataset
 *  (https://download.geonames.org/export/dump/), not hand-curated.
 *  Regenerate with `node scripts/generateDiscoverCities.mjs` (pulls fresh
 *  source files from GeoNames every run). Widened from a ~6,300-city
 *  cities15000-based cut (population >= 15,000) 2026-09-24, on request -
 *  same GeoNames source, just a lower population floor. Not exhaustive
 *  (every real data source behind the scored model works for any city on
 *  Earth, not just this list — see HANDOFF.md), but this is the fixed
 *  candidate list Advanced search needs to scan server-side. */
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
 *  whichever of these cities sit in it (245 countries/territories covered,
 *  some with just 1-2 cities) — not an authoritative national statistic. That's
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
