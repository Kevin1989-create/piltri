import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { gzipSync } from "zlib";
import { aggregateForCountry, CRITERIA, kindForScope } from "@/lib/advancedSearch/criteria";
import {
  CITY_CHUNK_SIZE,
  cityChunk,
  DATASET_SCHEMA_VERSION,
  encodeCity,
  normaliseSearchText,
  SEARCH_TOP_PER_LETTER,
  searchKey,
  type AdvCountries,
  type AdvPlaces,
  type AdvScores,
  type CityRecord,
  type CountryRecord,
  type DatasetManifest,
  type SearchEntry,
} from "@/lib/dataset/schema";
import type { CityExploreData, CriterionValue } from "@/lib/types";
import { buildPoiTiles } from "./poiTiles";
import { log } from "./util";

/**
 * Writes a built dataset in the layout the site reads in the browser:
 *
 *   manifest.json            version, counts, chunk counts, tile list
 *   countries.json           every country's record (~20 KB compressed)
 *   cities/<CC>-<n>.json     city rows, ~250 per chunk (a city page = 1 chunk)
 *   search/<xx>.json         search-as-you-type index by a word's first 2 characters
 *   search/<x>.json          the 300 largest places per first letter (first keystroke)
 *   adv/scores.json          Advanced Search: every city's section scores
 *   adv/places.json          Advanced Search: names and positions (for results)
 *   adv/col/<key>.json       one per-city column per criterion that varies by city
 *   adv/countries.json       country-level criteria + country-scope roll-ups
 *   poi/<tile>.json          pin mode points, 5°x5° tiles
 *
 * plus bundle.json.gz - every file above in one download, which is what
 * the site's build step (scripts/sync-dataset.mjs) fetches.
 */

export interface DatasetToWrite {
  version: string;
  generatedAt: string;
  countries: Record<string, CountryRecord>;
  /** Largest first. */
  cities: { cc: string; record: CityRecord; data: CityExploreData }[];
  poi: Parameters<typeof buildPoiTiles>[1];
  sources: Record<string, string>;
}

function writeJson(dir: string, rel: string, value: unknown) {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
const mean = (values: number[]) => (values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : 0);

export function writeDataset(outDir: string, ds: DatasetToWrite): DatasetManifest {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeJson(outDir, "countries.json", ds.countries);

  // ---- City chunks ---------------------------------------------------------
  const byCountry = new Map<string, DatasetToWrite["cities"]>();
  for (const city of ds.cities) {
    if (!byCountry.has(city.cc)) byCountry.set(city.cc, []);
    byCountry.get(city.cc)!.push(city);
  }
  const countryCodes = [...byCountry.keys()].sort();
  const chunks: Record<string, number> = {};
  for (const cc of countryCodes) {
    const group = byCountry.get(cc)!;
    const count = Math.max(1, Math.ceil(group.length / CITY_CHUNK_SIZE));
    chunks[cc] = count;
    const files: CityRecord[][] = Array.from({ length: count }, () => []);
    for (const { record } of group) files[cityChunk(record.id, count)].push(record);
    files.forEach((records, n) => writeJson(outDir, `cities/${cc}-${n}.json`, { rows: records.map(encodeCity) }));
  }

  // ---- Search index --------------------------------------------------------
  const letters = new Map<string, SearchEntry[]>();
  const add = (key: string, entry: SearchEntry) => {
    if (!letters.has(key)) letters.set(key, []);
    letters.get(key)!.push(entry);
  };
  for (const { cc, record } of ds.cities) {
    const words = normaliseSearchText(record.name).split(" ").filter(Boolean);
    const entry: SearchEntry = [record.name, record.region, cc, round4(record.lat), round4(record.lng)];
    for (const key of new Set(words.map(searchKey))) add(key, entry);
    for (const first of new Set(words.map((w) => w[0]))) {
      if ((letters.get(first)?.length ?? 0) < SEARCH_TOP_PER_LETTER) add(first, entry);
    }
  }
  for (const [key, entries] of letters) writeJson(outDir, `search/${key}.json`, entries);

  // ---- Advanced Search -----------------------------------------------------
  const ordered = countryCodes.flatMap((cc) => byCountry.get(cc)!);
  const base: AdvScores = {
    countryCodes,
    countryCounts: countryCodes.map((cc) => byCountry.get(cc)!.length),
    economy: ordered.map((c) => c.data.sectionScores.economy),
    safetyStability: ordered.map((c) => c.data.sectionScores.safetyStability),
    climate: ordered.map((c) => c.data.sectionScores.climate),
    liveability: ordered.map((c) => c.data.sectionScores.liveability),
  };
  writeJson(outDir, "adv/scores.json", base);
  // ~100 m precision is plenty for result links and map markers.
  const round3 = (v: number) => Math.round(v * 1e3) / 1e3;
  const places: AdvPlaces = {
    name: ordered.map((c) => c.record.name),
    region: ordered.map((c) => c.record.region),
    lat: ordered.map((c) => round3(c.record.lat)),
    lng: ordered.map((c) => round3(c.record.lng)),
  };
  writeJson(outDir, "adv/places.json", places);

  const countries: AdvCountries = { countryLevel: {}, rollups: {} };
  const advCityColumns: string[] = [];
  const valuesByKey = new Map<string, CriterionValue[]>();
  for (const def of CRITERIA) {
    const values = ordered.map((c) => def.getCityValue(c.data));
    valuesByKey.set(def.key, values);
    if (def.fromScores) continue;
    // Stored once per country when every city in each country shares it.
    let offset = 0;
    let perCountry: Record<string, CriterionValue> | null = {};
    for (const [i, cc] of countryCodes.entries()) {
      const slice = values.slice(offset, offset + base.countryCounts[i]);
      offset += base.countryCounts[i];
      if (perCountry && slice.every((v) => v === slice[0])) perCountry[cc] = slice[0];
      else perCountry = null;
    }
    if (perCountry) {
      countries.countryLevel[def.key] = perCountry;
    } else {
      advCityColumns.push(def.key);
      writeJson(outDir, `adv/col/${def.key}.json`, values);
    }
  }
  let offset = 0;
  for (const [i, cc] of countryCodes.entries()) {
    const n = base.countryCounts[i];
    const range = ordered.slice(offset, offset + n);
    const values: Record<string, CriterionValue> = {};
    for (const def of CRITERIA) {
      values[def.key] = aggregateForCountry(valuesByKey.get(def.key)!.slice(offset, offset + n), def.kind, kindForScope(def, "country"));
    }
    countries.rollups[cc] = {
      citiesTracked: n,
      lat: round4(range.reduce((s, c) => s + c.record.lat, 0) / n),
      lng: round4(range.reduce((s, c) => s + c.record.lng, 0) / n),
      sectionScores: {
        economy: mean(range.map((c) => c.data.sectionScores.economy)),
        safetyStability: mean(range.map((c) => c.data.sectionScores.safetyStability)),
        climate: mean(range.map((c) => c.data.sectionScores.climate)),
        liveability: mean(range.map((c) => c.data.sectionScores.liveability)),
      },
      values,
    };
    offset += n;
  }
  writeJson(outDir, "adv/countries.json", countries);

  // ---- Pin mode tiles --------------------------------------------------------
  const tiles = buildPoiTiles(path.join(outDir, "poi"), ds.poi);

  const manifest: DatasetManifest = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    version: ds.version,
    generatedAt: ds.generatedAt,
    cityCount: ds.cities.length,
    countryCount: countryCodes.length,
    countryNames: Object.fromEntries(countryCodes.map((cc) => [cc, ds.countries[cc].name])),
    chunks,
    tiles,
    searchFiles: [...letters.keys()].sort(),
    advCityColumns,
    sources: ds.sources,
  };
  writeJson(outDir, "manifest.json", manifest);
  writeBundle(outDir);
  log("output", `${chunks ? Object.values(chunks).reduce((a, b) => a + b, 0) : 0} city chunks, ${letters.size} search files, ${advCityColumns.length} Advanced Search columns, ${tiles.length} tiles`);
  return manifest;
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

/** Every file in one gzipped JSON map {path: contents} - one download for
 *  the site build instead of ~2,000. */
function writeBundle(dir: string) {
  const files: Record<string, string> = {};
  for (const rel of listFiles(dir)) {
    if (rel === "bundle.json.gz") continue;
    files[rel] = readFileSync(path.join(dir, rel), "utf8");
  }
  const bundle = gzipSync(JSON.stringify({ files }), { level: 9 });
  writeFileSync(path.join(dir, "bundle.json.gz"), bundle);
  log("output", `bundle.json.gz: ${Object.keys(files).length} files, ${(bundle.length / 1e6).toFixed(1)} MB`);
}
