import discoverCitiesJson from "@/data/static/discover-cities.json";
import type { DiscoverCity } from "@/lib/types";

/** Static shortlist of ~500 major world cities Discover mode can scan.
 *  Not exhaustive — this is the "candidate list" until a real database of
 *  cities/neighbourhoods exists (see the Discover mode proposal). */
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
