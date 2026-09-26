import { readFileSync } from "fs";
import path from "path";
import { cityIdFor } from "@/lib/dataset/schema";
import { sampleDensity } from "./population";
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

  return cached("shortlist-v3", async () => {
    const admin1 = new Map(tsv(admin1File).map(([code, name]) => [code, name]));
    // countryInfo.txt: ISO, ISO3, ISO-Numeric, fips, Country, Capital, Area,
    // Population, Continent, tld, CurrencyCode, CurrencyName, ...
    const countryRows = new Map(tsv(countryFile).map((c) => [c[0], c]));

    const bySlug = new Map<string, ShortlistCity[]>();
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
      const elevation = elevStr ? Number(elevStr) : Number(demStr);
      if (!bySlug.has(cityId)) bySlug.set(cityId, []);
      bySlug.get(cityId)!.push({
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
    // The same name twice in one country (~2,400 cases): keep the largest
    // entry whose point is actually a town. "Largest" alone picked
    // municipality centre points in empty land (Colombia's Buenaventura
    // resolved to the jungle, not the port city); "most people around the
    // point" alone picked dense suburbs over real cities (Springfield, PA
    // over Springfield, MO). An entry is a town if 5,000+ people, or a fifth
    // of its stated population, live within 5 km of its point (GHS-POP).
    const duplicates = [...bySlug.values()].filter((group) => group.length > 1).flat();
    const density = await sampleDensity(duplicates.map((c) => ({ lat: c.lat, lng: c.lng })));
    const around = new Map(duplicates.map((c, i) => [c, (density[i] ?? 0) * Math.PI * 25]));
    const isTown = (c: ShortlistCity) => (around.get(c) ?? 0) >= Math.min(5000, c.population * 0.2);
    const pick = (group: ShortlistCity[]) => {
      const towns = group.filter(isTown);
      const pool = towns.length ? towns : group;
      return pool.reduce((best, c) => (c.population > best.population ? c : best));
    };
    const cities = [...bySlug.values()].map((group) => (group.length === 1 ? group[0] : pick(group))).sort((a, b) => b.population - a.population);
    log("shortlist", `${duplicates.length} same-name entries: kept the largest whose point is a town`);

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
