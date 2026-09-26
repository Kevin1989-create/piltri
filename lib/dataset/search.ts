import capitals from "@/data/static/country-capitals.json";
import { getDiscoverCities } from "@/lib/discoverCities";
import type { CitySearchResult, DiscoverCity } from "@/lib/types";

/** Search-as-you-type over the city shortlist bundled with the site
 *  (data/static/discover-cities.json, every place with 5,000+ people) -
 *  replaces a Mapbox geocoding call on every keystroke. Every result is a
 *  city the dataset has full data for, by construction. */

function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface IndexedCity {
  city: DiscoverCity;
  name: string;
  words: string[];
  country: string;
}

let index: IndexedCity[] | null = null;

function getIndex(): IndexedCity[] {
  if (!index) {
    // The shortlist is already sorted by population, largest first - so a
    // plain in-order scan returns the most prominent matches first.
    index = getDiscoverCities().map((city) => {
      const name = normalise(city.cityName);
      return { city, name, words: name.split(" "), country: normalise(city.country) };
    });
  }
  return index;
}

function toResult(city: DiscoverCity): CitySearchResult {
  return {
    cityId: city.cityId,
    cityName: city.cityName,
    region: city.region,
    country: city.country,
    countryCode: city.countryCode,
    lat: city.lat,
    lng: city.lng,
  };
}

const CAPITALS = capitals as Record<string, { name: string; lat: number; lng: number }>;

export function searchCities(rawQuery: string, limit = 6): CitySearchResult[] {
  const [cityPart, countryPart] = rawQuery.split(",").map((s) => normalise(s ?? ""));
  if (!cityPart) return [];
  const all = getIndex();
  const results: DiscoverCity[] = [];
  const seen = new Set<string>();
  const push = (city: DiscoverCity) => {
    if (results.length < limit && !seen.has(city.cityId)) {
      seen.add(city.cityId);
      results.push(city);
    }
  };
  const countryOk = (c: IndexedCity) => !countryPart || c.country.startsWith(countryPart);

  // A country name typed in full ("france") surfaces its capital first.
  if (!countryPart) {
    const countryMatch = all.find((c) => c.country === cityPart);
    const capital = countryMatch ? CAPITALS[countryMatch.city.countryCode] : undefined;
    if (capital) {
      const capitalCity = all.find((c) => c.city.countryCode === countryMatch!.city.countryCode && c.city.cityName === capital.name);
      if (capitalCity) push(capitalCity.city);
    }
  }
  for (const c of all) {
    if (results.length >= limit) break;
    if (c.name === cityPart && countryOk(c)) push(c.city);
  }
  for (const c of all) {
    if (results.length >= limit) break;
    if (c.name.startsWith(cityPart) && countryOk(c)) push(c.city);
  }
  for (const c of all) {
    if (results.length >= limit) break;
    if (c.words.some((w) => w.startsWith(cityPart)) && countryOk(c)) push(c.city);
  }
  return results.map(toResult);
}
