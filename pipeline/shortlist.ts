import { readFileSync } from "fs";
import path from "path";
import { cityIdFor } from "@/lib/dataset/schema";
import { cached, downloadOnce, log, unzipOnce, WORK_DIR } from "./util";

/** The city shortlist: every GeoNames place with 5,000+ people (cities5000,
 *  CC BY 4.0), one per name per country. Built fresh from GeoNames on each
 *  run, together with the per-country facts that come from the same
 *  download set (capital, currency) - replaces the old committed 14 MB
 *  data/static/discover-cities.json and scripts/generateDiscoverCities.mjs.
 *  City ids are `${name}-${cc}` slugs (cityIdFor), stable across runs. */

export interface ShortlistCity {
  cityId: string;
  cityName: string;
  region: string | null;
  countryCode: string;
  lat: number;
  lng: number;
  population: number;
  /** GeoNames elevation, or its SRTM-derived "dem" column when missing. */
  elevationM: number | null;
  /** IANA time zone, e.g. "Europe/Lisbon". */
  timezone: string | null;
}

export interface CountryInfo {
  name: string;
  currencyCode: string | null;
  currencyName: string | null;
  capital: { name: string; lat: number; lng: number } | null;
}

export interface Shortlist {
  cities: ShortlistCity[];
  countries: Record<string, CountryInfo>;
}

function tsv(file: string): string[][] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.split("\t"));
}

export async function loadShortlist(): Promise<Shortlist> {
  const dir = path.join(WORK_DIR, "geonames");
  unzipOnce(await downloadOnce("https://download.geonames.org/export/dump/cities5000.zip", "cities5000.zip"), dir, "cities5000.txt");
  const admin1File = await downloadOnce("https://download.geonames.org/export/dump/admin1CodesASCII.txt", "admin1CodesASCII.txt");
  const countryFile = await downloadOnce("https://download.geonames.org/export/dump/countryInfo.txt", "countryInfo.txt");

  return cached("shortlist", async () => {
    const admin1 = new Map(tsv(admin1File).map(([code, name]) => [code, name]));
    // countryInfo.txt: ISO, ISO3, ISO-Numeric, fips, Country, Capital, Area,
    // Population, Continent, tld, CurrencyCode, CurrencyName, ...
    const countryRows = new Map(tsv(countryFile).map((c) => [c[0], c]));

    const bySlug = new Map<string, ShortlistCity>();
    const capitals = new Map<string, { name: string; lat: number; lng: number }>();
    // cities5000.txt: geonameid, name, asciiname, alternatenames, lat, lng,
    // feature class, feature code, country, cc2, admin1, admin2, admin3,
    // admin4, population, elevation, dem, timezone, modification date
    for (const cols of tsv(path.join(dir, "cities5000.txt"))) {
      const [, name, , , latStr, lngStr, , featureCode, cc, , admin1Code, , , , popStr, elevStr, demStr, timezone] = cols;
      const population = Number(popStr);
      const lat = Number(latStr);
      const lng = Number(lngStr);
      if (!name || !cc || !(population > 0) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      // PPLC = seat of a national capital.
      if (featureCode === "PPLC") capitals.set(cc, { name, lat, lng });
      const cityId = cityIdFor(name, cc);
      // Same name twice in one country: keep the larger place.
      const existing = bySlug.get(cityId);
      if (existing && existing.population >= population) continue;
      const elevation = elevStr ? Number(elevStr) : Number(demStr);
      bySlug.set(cityId, {
        cityId,
        cityName: name,
        region: admin1Code ? admin1.get(`${cc}.${admin1Code}`) ?? null : null,
        countryCode: cc,
        lat,
        lng,
        population,
        // -9999 is GeoNames' "no data" for dem.
        elevationM: Number.isFinite(elevation) && elevation > -1000 ? Math.round(elevation) : null,
        timezone: timezone || null,
      });
    }
    const cities = [...bySlug.values()].sort((a, b) => b.population - a.population);

    const countries: Record<string, CountryInfo> = {};
    for (const cc of new Set(cities.map((c) => c.countryCode))) {
      const row = countryRows.get(cc);
      countries[cc] = {
        name: row?.[4] ?? cc,
        currencyCode: row?.[10] || null,
        currencyName: row?.[11] || null,
        capital: capitals.get(cc) ?? null,
      };
    }
    log("shortlist", `${cities.length} cities in ${Object.keys(countries).length} countries`);
    return { cities, countries };
  });
}
