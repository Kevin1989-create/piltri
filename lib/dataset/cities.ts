import type { CityExploreData } from "@/lib/types";
import { assembleCityExploreData } from "./assemble";
import { loadFile, manifest, memo } from "./files";
import { cityChunk, decodeBoundary, decodeCity, type BoundaryChunkFile, type CityChunkFile, type CityRecord, type CountryRecord } from "./schema";

export function getCountries(): Promise<Record<string, CountryRecord>> {
  return loadFile("countries.json");
}

const decoded = new Map<string, Promise<CityRecord[]>>();

function loadChunk(countryCode: string, n: number): Promise<CityRecord[]> {
  const key = `${countryCode}-${n}`;
  return memo(decoded, key, async () => (await loadFile<CityChunkFile>(`cities/${key}.json`)).rows.map((row) => decodeCity(row, countryCode)));
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** A city by id (one small chunk file), or - for old links whose id no
 *  longer matches, when they carry a point - the country's city nearest
 *  that point. */
async function findCity(countryCode: string, cityId: string | null, lat: number | null, lng: number | null): Promise<CityRecord | null> {
  const count = manifest.chunks[countryCode];
  if (!count) return null;
  if (cityId) {
    const hit = (await loadChunk(countryCode, cityChunk(cityId, count))).find((c) => c.id === cityId);
    if (hit) return hit;
  }
  if (lat == null || lng == null) return null;
  const all = (await Promise.all(Array.from({ length: count }, (_, n) => loadChunk(countryCode, n)))).flat();
  let best: CityRecord | null = null;
  let bestKm = Infinity;
  for (const c of all) {
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return best;
}

const boundaryChunks = new Set(manifest.boundaryChunks ?? []);
const builtUpChunks = new Set(manifest.builtUpChunks ?? []);

export interface CityOutline {
  geometry: GeoJSON.MultiPolygon;
  /** The town's built-up area (pipeline/builtup.ts), not a border. */
  builtUp: boolean;
}

/** The city's outline for the map: its border (its chunk's bounds file),
 *  or else its built-up area (builtup file), or null when the dataset has
 *  neither - the map then draws the 5 km circle. */
export async function getCityBoundary(countryCode: string, cityId: string): Promise<CityOutline | null> {
  const cc = countryCode.toUpperCase();
  const count = manifest.chunks[cc];
  if (!count) return null;
  const key = `${cc}-${cityChunk(cityId, count)}`;
  for (const [set, folder, builtUp] of [[boundaryChunks, "bounds", false], [builtUpChunks, "builtup", true]] as const) {
    if (!set.has(key)) continue;
    const encoded = (await loadFile<BoundaryChunkFile>(`${folder}/${key}.json`))[cityId];
    if (encoded) return { geometry: { type: "MultiPolygon", coordinates: decodeBoundary(encoded) }, builtUp };
  }
  return null;
}

/** Everything a city page shows - two small cached files (the country list
 *  and the city's chunk), assembled in the browser. */
export async function getCityExploreData(
  countryCode: string,
  cityId: string | null,
  lat: number | null = null,
  lng: number | null = null
): Promise<CityExploreData | null> {
  const cc = countryCode.toUpperCase();
  const [countries, city] = await Promise.all([getCountries(), findCity(cc, cityId, lat, lng)]);
  const country = countries[cc];
  if (!country || !city) return null;
  return assembleCityExploreData(cc, city, country, manifest.generatedAt, manifest.cityCount);
}
