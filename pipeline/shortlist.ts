import { readFileSync } from "fs";
import path from "path";
import { cityIdFor, disambiguatedCityId } from "@/lib/dataset/schema";
import { sampleDensity } from "./population";
import { cached, downloadOnce, log, unzipOnce, WORK_DIR } from "./util";

/** The city shortlist: every GeoNames place with 1,000+ people (cities1000,
 *  CC BY 4.0; 5,000+ until 2026-09-30). Built fresh from GeoNames on each
 *  run, together with the per-country facts that come from the same
 *  download set (capital, currency) - replaces the old committed 14 MB
 *  data/static/discover-cities.json and scripts/generateDiscoverCities.mjs.
 *  City ids are `${name}-${cc}` slugs (cityIdFor), stable across runs; a
 *  smaller namesake in the same country gets a qualified id (see below). */

/** Smallest population kept - except capitals and first-level regional
 *  seats, kept whatever their size (as cities5000 did), so small
 *  territories still have their capital (Hamilton, Bermuda; The Bottom). */
export const MIN_POPULATION = 1000;
const ALWAYS_KEPT = new Set(["PPLC", "PPLA"]);
/** Two same-name entries in one region closer than this are one town. */
const SAME_TOWN_KM = 10;

export interface ShortlistCity {
  cityId: string;
  /** Set when cityId isn't the plain name-country slug (a smaller
   *  namesake of another town in the same country). */
  customId: string | null;
  geonameId: number;
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
  /** GeoNames' ASCII and alternate names (other spellings and languages) -
   *  used to find the city's outline (pipeline/boundaries.ts). */
  altNames: string[];
}

export interface CountryInfo {
  name: string;
  /** ISO 3166 alpha-3 (GeoNames; Kosovo is XKX, as World Bank uses) - the
   *  key for World Bank and WHO data. */
  iso3: string | null;
  currencyCode: string | null;
  currencyName: string | null;
  capital: { name: string; lat: number; lng: number } | null;
}

export interface Shortlist {
  cities: ShortlistCity[];
  countries: Record<string, CountryInfo>;
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function tsv(file: string): string[][] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.split("\t"));
}

export async function loadShortlist(): Promise<Shortlist> {
  const dir = path.join(WORK_DIR, "geonames");
  unzipOnce(await downloadOnce("https://download.geonames.org/export/dump/cities1000.zip", "cities1000.zip"), dir, "cities1000.txt");
  const admin1File = await downloadOnce("https://download.geonames.org/export/dump/admin1CodesASCII.txt", "admin1CodesASCII.txt");
  const countryFile = await downloadOnce("https://download.geonames.org/export/dump/countryInfo.txt", "countryInfo.txt");

  return cached("shortlist-v7", async () => {
    const admin1 = new Map(tsv(admin1File).map(([code, name]) => [code, name]));
    // countryInfo.txt: ISO, ISO3, ISO-Numeric, fips, Country, Capital, Area,
    // Population, Continent, tld, CurrencyCode, CurrencyName, ...
    const countryRows = new Map(tsv(countryFile).map((c) => [c[0], c]));

    const bySlug = new Map<string, ShortlistCity[]>();
    const capitals = new Map<string, { name: string; lat: number; lng: number }>();
    // cities1000.txt: geonameid, name, asciiname, alternatenames, lat, lng,
    // feature class, feature code, country, cc2, admin1, admin2, admin3,
    // admin4, population, elevation, dem, timezone, modification date
    for (const cols of tsv(path.join(dir, "cities1000.txt"))) {
      const [geonameIdStr, name, asciiName, alternateNames, latStr, lngStr, , featureCode, cc, , admin1Code, , , , popStr, elevStr, demStr, timezone] = cols;
      const population = Number(popStr);
      const lat = Number(latStr);
      const lng = Number(lngStr);
      // The file also lists smaller seats of lower-level divisions: skipped.
      const kept = population >= MIN_POPULATION || (population > 0 && ALWAYS_KEPT.has(featureCode));
      if (!name || !cc || !kept || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      // PPLC = seat of a national capital.
      if (featureCode === "PPLC") capitals.set(cc, { name, lat, lng });
      const cityId = cityIdFor(name, cc);
      const elevation = elevStr ? Number(elevStr) : Number(demStr);
      if (!bySlug.has(cityId)) bySlug.set(cityId, []);
      bySlug.get(cityId)!.push({
        cityId,
        customId: null,
        geonameId: Number(geonameIdStr),
        cityName: name,
        region: admin1Code ? admin1.get(`${cc}.${admin1Code}`) ?? null : null,
        countryCode: cc,
        lat,
        lng,
        population,
        // -9999 is GeoNames' "no data" for dem.
        elevationM: Number.isFinite(elevation) && elevation > -1000 ? Math.round(elevation) : null,
        timezone: timezone || null,
        altNames: [...new Set([asciiName, ...(alternateNames ? alternateNames.split(",") : [])].filter((n) => n && n !== name))],
      });
    }
    // The same name more than once in one country (~12,000 entries at
    // 1,000+): either one town entered twice (e.g. a municipality's centre
    // point as well as the town) or genuinely different towns (Springfield,
    // MO and Springfield, IL). Entries are ranked towns first, then largest:
    // an entry is a town if 5,000+ people, or a fifth of its stated
    // population, live within 5 km of its point (GHS-POP) - "largest" alone
    // picked municipality points in empty land (Colombia's Buenaventura
    // resolved to the jungle, not the port city), "most people around" alone
    // picked dense suburbs over real cities. Best first, an entry repeats
    // one already kept - and is dropped - when it's in the same region and
    // within SAME_TOWN_KM of it, or isn't a town itself; otherwise it's a
    // different town and is kept. The best keeps the plain id (the one
    // picked before 2026-09-30, so links still work); the others get their
    // region in the id, or their GeoNames id when that isn't enough.
    const duplicates = [...bySlug.values()].filter((group) => group.length > 1).flat();
    const density = await sampleDensity(duplicates.map((c) => ({ lat: c.lat, lng: c.lng })));
    const around = new Map(duplicates.map((c, i) => [c, (density[i] ?? 0) * Math.PI * 25]));
    const isTown = (c: ShortlistCity) => (around.get(c) ?? 0) >= Math.min(5000, c.population * 0.2);
    const taken = new Set(bySlug.keys());
    const cities: ShortlistCity[] = [];
    let repeats = 0;
    let namesakes = 0;
    for (const group of bySlug.values()) {
      const ranked = group.length === 1 ? group : [...group].sort((a, b) => Number(isTown(b)) - Number(isTown(a)) || b.population - a.population);
      const kept: ShortlistCity[] = [];
      for (const c of ranked) {
        if (kept.some((k) => k.region === c.region && (!isTown(c) || distanceKm(k, c) < SAME_TOWN_KM))) {
          repeats++;
          continue;
        }
        if (kept.length) {
          let id = c.region ? disambiguatedCityId(c.cityName, c.region, c.countryCode) : null;
          if (!id || taken.has(id)) id = disambiguatedCityId(c.cityName, String(c.geonameId), c.countryCode);
          taken.add(id);
          c.cityId = id;
          c.customId = id;
          namesakes++;
        }
        kept.push(c);
      }
      cities.push(...kept);
    }
    cities.sort((a, b) => b.population - a.population);
    log("shortlist", `${duplicates.length} same-name entries: ${repeats} repeats of a town dropped, ${namesakes} namesakes kept with a qualified id`);

    const countries: Record<string, CountryInfo> = {};
    for (const cc of new Set(cities.map((c) => c.countryCode))) {
      const row = countryRows.get(cc);
      countries[cc] = {
        name: row?.[4] ?? cc,
        iso3: row?.[1] || null,
        currencyCode: row?.[10] || null,
        currencyName: row?.[11] || null,
        capital: capitals.get(cc) ?? null,
      };
    }
    log("shortlist", `${cities.length} cities in ${Object.keys(countries).length} countries`);
    return { cities, countries };
  });
}
