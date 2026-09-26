import { gunzipSync } from "zlib";
import type { CityExploreData, PinnedLocationData } from "@/lib/types";
import { assembleCityExploreData } from "./assemble";
import {
  CITY_FIELDS,
  DATASET_SCHEMA_VERSION,
  decodeCity,
  type CityRecord,
  type CityRow,
  type CountryRecord,
  type CountryShard,
  type DatasetManifest,
} from "./schema";

/** The precomputed dataset lives in this public Supabase Storage bucket
 *  (published by pipeline/publish.ts). Reading it is a plain CDN GET - no
 *  database query, no third-party API, no key. */
export const DATA_BUCKET = "piltri-data";

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return `${url}/storage/v1/object/public/${DATA_BUCKET}`;
}

// Per-instance memory caches. Versioned files never change, so they can be
// held for the life of the server instance; only the manifest (which points
// at the current version) is re-checked.
const MANIFEST_TTL_MS = 5 * 60 * 1000;
let manifestCache: { value: Promise<DatasetManifest>; at: number } | null = null;
const fileCache = new Map<string, Promise<unknown>>();

export function getManifest(): Promise<DatasetManifest> {
  if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.value;
  const value = (async () => {
    const res = await fetch(`${baseUrl()}/manifest.json`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`Dataset manifest unavailable (${res.status})`);
    const manifest = (await res.json()) as DatasetManifest;
    if (manifest.schemaVersion !== DATASET_SCHEMA_VERSION) {
      throw new Error(`Dataset schema ${manifest.schemaVersion} does not match the site's schema ${DATASET_SCHEMA_VERSION}`);
    }
    return manifest;
  })();
  manifestCache = { value, at: Date.now() };
  value.catch(() => {
    manifestCache = null;
  });
  return value;
}

async function getVersionedFile<T>(relativePath: string): Promise<T> {
  const { version } = await getManifest();
  const key = `${version}/${relativePath}`;
  if (!fileCache.has(key)) {
    const promise = (async () => {
      const res = await fetch(`${baseUrl()}/${key}.gz`, { cache: "force-cache" });
      if (!res.ok) throw new Error(`Dataset file ${relativePath} unavailable (${res.status})`);
      return JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")) as T;
    })();
    promise.catch(() => fileCache.delete(key));
    fileCache.set(key, promise);
  }
  return fileCache.get(key) as Promise<T>;
}

const optionalCache = new Map<string, Promise<unknown | null>>();

/** Like getVersionedFile, but a missing file (404) is a normal, cached
 *  "nothing here" rather than an error - used for POI tiles, where most
 *  of the ocean simply has no tile. */
export async function getOptionalVersionedFile<T>(relativePath: string): Promise<T | null> {
  const { version } = await getManifest();
  const key = `${version}/${relativePath}`;
  if (!optionalCache.has(key)) {
    const promise = (async () => {
      const res = await fetch(`${baseUrl()}/${key}.gz`, { cache: "force-cache" });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Dataset file ${relativePath} unavailable (${res.status})`);
      return JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8")) as T;
    })();
    promise.catch(() => optionalCache.delete(key));
    optionalCache.set(key, promise);
  }
  return optionalCache.get(key) as Promise<T | null>;
}

export function getCountries(): Promise<Record<string, CountryRecord>> {
  return getVersionedFile("countries.json");
}

export async function getCountryCities(countryCode: string): Promise<CityRecord[]> {
  const shard = await getVersionedFile<CountryShard>(`cities/${countryCode.toUpperCase()}.json`).catch(() => null);
  return shard ? shard.rows.map(decodeCity) : [];
}

export interface AllCities {
  fields: readonly string[];
  countries: Record<string, CityRow[]>;
}

/** Every city in one file - only Advanced Search needs this. */
export async function getAllCities(): Promise<{ countryCode: string; record: CityRecord }[]> {
  const all = await getVersionedFile<AllCities>("all-cities.json");
  if (all.fields.join() !== CITY_FIELDS.join()) throw new Error("Dataset field layout mismatch");
  return Object.entries(all.countries).flatMap(([countryCode, rows]) => rows.map((row) => ({ countryCode, record: decodeCity(row) })));
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** The shortlisted city nearest to a point, within one country's shard.
 *  Every search result IS a shortlisted city (exact match, ~0 km); older
 *  shared links pointing at arbitrary places resolve to the nearest one. */
export async function findNearestCity(countryCode: string, lat: number, lng: number): Promise<{ record: CityRecord; km: number } | null> {
  const cities = await getCountryCities(countryCode);
  let best: { record: CityRecord; km: number } | null = null;
  for (const record of cities) {
    const km = haversineKm(lat, lng, record.lat, record.lng);
    if (!best || km < best.km) best = { record, km };
  }
  return best;
}

/** Rough straight-line km -> minutes (~30 km/h average local travel) -
 *  the same disclosed estimate pin mode uses; there's no routing engine. */
export function kmToMinutes(km: number | null): number | null {
  return km == null ? null : Math.round((km / 30) * 60);
}

/** Pin-mode-shaped "nearby" values for a city centre, derived from its
 *  stored distances - feeds Advanced Search's Nearby filters, which used to
 *  need a live pin lookup per candidate. */
export function nearbyFromRecord(record: CityRecord): PinnedLocationData {
  const place = (km: number | null) => ({ minutes: kmToMinutes(km), name: null, lat: null, lng: null });
  return {
    lat: record.lat,
    lng: record.lng,
    neighbourhoodName: null,
    nearestBeach: place(record.distanceToBeachKm),
    nearestMountain: place(record.distanceToMountainKm),
    nearestTrainStation: place(record.distanceToTrainStationKm),
    nearestAirport: place(record.distanceToAirportKm),
  };
}

export interface AssembledCity {
  countryCode: string;
  record: CityRecord;
  data: CityExploreData;
  nearby: PinnedLocationData;
}

let assembledCache: { version: string; value: Promise<AssembledCity[]> } | null = null;

/** Every city fully assembled - Advanced Search's working set. Built once
 *  per dataset version per server instance (~66k cities, a second or two),
 *  then every search is a pure in-memory filter. */
export async function getAllAssembledCities(): Promise<AssembledCity[]> {
  const manifest = await getManifest();
  if (assembledCache?.version === manifest.version) return assembledCache.value;
  const value = (async () => {
    const [countries, all] = await Promise.all([getCountries(), getAllCities()]);
    return all
      .filter(({ countryCode }) => countries[countryCode])
      .map(({ countryCode, record }) => ({
        countryCode,
        record,
        data: assembleCityExploreData(countryCode, record, countries[countryCode], manifest.generatedAt, manifest.cityCount),
        nearby: nearbyFromRecord(record),
      }));
  })();
  assembledCache = { version: manifest.version, value };
  value.catch(() => {
    assembledCache = null;
  });
  return value;
}

/** A known cityId wins; otherwise the nearest shortlisted city to the point
 *  (so a hand-edited or old link with approximate coordinates still opens
 *  the city it names, not whichever district happens to be closest). */
export async function getCityExploreData(countryCode: string, lat: number, lng: number, cityId?: string | null): Promise<CityExploreData | null> {
  const cc = countryCode.toUpperCase();
  const [manifest, countries, cities] = await Promise.all([getManifest(), getCountries(), getCountryCities(cc)]);
  const country = countries[cc];
  const record = (cityId && cities.find((c) => c.id === cityId)) || (await findNearestCity(cc, lat, lng))?.record;
  if (!country || !record) return null;
  return assembleCityExploreData(cc, record, country, manifest.generatedAt, manifest.cityCount);
}
