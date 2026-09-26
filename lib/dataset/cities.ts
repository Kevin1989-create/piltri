import type { CityExploreData } from "@/lib/types";
import { assembleCityExploreData } from "./assemble";
import { loadFile, manifest, memo } from "./files";
import { cityChunk, decodeCity, type CityChunkFile, type CityRecord, type CountryRecord } from "./schema";

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
 *  longer matches - the country's city nearest the given point. */
async function findCity(countryCode: string, cityId: string | null, lat: number, lng: number): Promise<CityRecord | null> {
  const count = manifest.chunks[countryCode];
  if (!count) return null;
  if (cityId) {
    const hit = (await loadChunk(countryCode, cityChunk(cityId, count))).find((c) => c.id === cityId);
    if (hit) return hit;
  }
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

/** Everything a city page shows - two small cached files (the country list
 *  and the city's chunk), assembled in the browser. */
export async function getCityExploreData(countryCode: string, cityId: string | null, lat: number, lng: number): Promise<CityExploreData | null> {
  const cc = countryCode.toUpperCase();
  const [countries, city] = await Promise.all([getCountries(), findCity(cc, cityId, lat, lng)]);
  const country = countries[cc];
  if (!country || !city) return null;
  return assembleCityExploreData(cc, city, country, manifest.generatedAt, manifest.cityCount);
}
