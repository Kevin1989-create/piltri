import type { NearbyPlace, PinnedLocationData } from "@/lib/types";
import { kmToMinutes } from "./assemble";
import { loadFile, manifest } from "./files";
import { POI_TILE_DEG } from "./schema";

/** Pin mode, in the browser: the nearest beach/coast, mountain, train
 *  station and airport to any dropped pin, from the published 5°x5° point
 *  tiles (pipeline/poiTiles.ts). Starts with the pin's own tile and only
 *  widens while something farther away could still be closer. Travel times
 *  are straight-line estimates (~30 km/h), labelled as such in the UI. */

/** [lng, lat, name, elevation?] */
type Point = [number, number, string, (number | null)?];
type Category = "airport" | "train" | "beach" | "coast" | "mountain" | "city";
type Tile = Partial<Record<Category, Point[]>>;

// Same rule as city pages: a mountain is 1,000 m+ AND 500 m+ above the ground.
const MOUNTAIN_MIN_ELEVATION_M = 1000;
const MOUNTAIN_MIN_RISE_M = 500;
const MAX_RING = 8;
const existing = new Set(manifest.tiles);

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function ringKeys(ty: number, tx: number, ring: number): string[] {
  const keys: string[] = [];
  const cols = 360 / POI_TILE_DEG;
  for (let dy = -ring; dy <= ring; dy++) {
    for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const y = ty + dy;
      if (y < -90 / POI_TILE_DEG || y >= 90 / POI_TILE_DEG) continue;
      const x = ((((tx + dx) % cols) + cols + cols / 2) % cols) - cols / 2; // wrap the antimeridian
      keys.push(`${y}_${x}`);
    }
  }
  return keys;
}

interface Hit {
  p: Point;
  km: number;
  category: Category;
}

async function nearest(lat: number, lng: number, categories: Category[], accept: (p: Point) => boolean = () => true): Promise<Hit | null> {
  const ty = Math.floor(lat / POI_TILE_DEG);
  const tx = Math.floor(lng / POI_TILE_DEG);
  let best = null as Hit | null;
  for (let ring = 0; ring <= MAX_RING; ring++) {
    const keys = ringKeys(ty, tx, ring).filter((k) => existing.has(k));
    const tiles = await Promise.all(keys.map((k) => loadFile<Tile>(`poi/${k}.json`)));
    for (const tile of tiles) {
      for (const category of categories) {
        for (const p of tile[category] ?? []) {
          if (!accept(p)) continue;
          const km = haversineKm(lat, lng, p[1], p[0]);
          if (!best || km < best.km) best = { p, km, category };
        }
      }
    }
    // Anything not yet loaded lies outside this block of tiles, so it's at
    // least as far as the block's nearest edge.
    const south = (ty - ring) * POI_TILE_DEG;
    const north = (ty + ring + 1) * POI_TILE_DEG;
    const west = (tx - ring) * POI_TILE_DEG;
    const east = (tx + ring + 1) * POI_TILE_DEG;
    const edgeLat = Math.min(89, Math.max(Math.abs(south), Math.abs(north)));
    const margin = Math.min(
      Math.min(lat - south, north - lat) * 111.2,
      Math.min(lng - west, east - lng) * 111.32 * Math.cos((edgeLat * Math.PI) / 180)
    );
    if (best && best.km <= margin) break;
  }
  return best;
}

const toPlace = (hit: { p: Point; km: number } | null, fallbackName: string | null = null): NearbyPlace =>
  hit ? { minutes: kmToMinutes(hit.km), name: hit.p[2] || fallbackName, lat: hit.p[1], lng: hit.p[0] } : { minutes: null, name: null, lat: null, lng: null };

export async function getPinnedLocationData(lat: number, lng: number): Promise<PinnedLocationData> {
  // The nearest town gives the "near <town>" label and the local ground
  // level for the mountain rule.
  const town = await nearest(lat, lng, ["city"]);
  const ground = town && town.km <= 50 ? (town.p[3] ?? 0) : 0;
  const minPeak = Math.max(MOUNTAIN_MIN_ELEVATION_M, ground + MOUNTAIN_MIN_RISE_M);
  const [beach, mountain, train, airport] = await Promise.all([
    nearest(lat, lng, ["beach", "coast"]),
    nearest(lat, lng, ["mountain"], (p) => (p[3] ?? 0) >= minPeak),
    nearest(lat, lng, ["train"]),
    nearest(lat, lng, ["airport"], (p) => !/heli(port|stop|pad)/i.test(p[2])),
  ]);
  return {
    lat,
    lng,
    neighbourhoodName: town && town.km <= 25 ? town.p[2] : null,
    nearestBeach: toPlace(beach, beach?.category === "coast" ? "Nearby coast" : null),
    nearestMountain: toPlace(mountain),
    nearestTrainStation: toPlace(train),
    nearestAirport: toPlace(airport),
  };
}
