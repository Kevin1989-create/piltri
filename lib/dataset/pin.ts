import KDBush from "kdbush";
import { around } from "geokdbush";
import { getDiscoverCities } from "@/lib/discoverCities";
import type { NearbyPlace, PinnedLocationData } from "@/lib/types";
import { getCountryCities, getOptionalVersionedFile, kmToMinutes } from "./load";

/** Pin mode, entirely from published data: the nearest beach/coast,
 *  mountain (1,000 m+ peak), train station and airport to any dropped pin,
 *  found in the 5°x5° POI tiles around it (pipeline/poiTiles.ts). Travel
 *  time is a straight-line estimate (~30 km/h), labelled as such in the UI -
 *  there's no routing engine, by design (no live API calls). */

const TILE_DEG = 5;
/** [lng, lat, name] - mountains carry a 4th element, elevation in metres. */
type Point = [number, number, string, number?];
type Tile = Partial<Record<"airport" | "train" | "beach" | "coast" | "mountain", Point[]>>;
// Same rule as city pages (pipeline/geonames.ts): a "mountain" is 1,000 m+
// AND rises 500 m+ above the local ground.
const MOUNTAIN_MIN_ELEVATION_M = 1000;
const MOUNTAIN_MIN_RISE_M = 500;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function tilesAround(lat: number, lng: number, ring: number): Promise<Tile[]> {
  const ty = Math.floor(lat / TILE_DEG);
  const tx = Math.floor(lng / TILE_DEG);
  const keys: string[] = [];
  for (let dy = -ring; dy <= ring; dy++) {
    for (let dx = -ring; dx <= ring; dx++) {
      const y = ty + dy;
      if (y < -18 || y > 17) continue;
      const x = ((((tx + dx) % 72) + 72 + 36) % 72) - 36; // wrap across the antimeridian
      keys.push(`${y}_${x}`);
    }
  }
  const tiles = await Promise.all(keys.map((k) => getOptionalVersionedFile<Tile>(`poi/${k}.json`).catch(() => null)));
  return tiles.filter((t): t is Tile => t != null);
}

/** Nearest point of the given categories. Widens the tile ring until the
 *  best match found is provably closer than anything an outer ring could
 *  hold (each ring adds at least ~5° ≈ 550 km of margin at the equator). */
async function nearest(
  lat: number,
  lng: number,
  categories: (keyof Tile)[],
  fallbackName: Record<string, string> = {},
  accept: (p: Point) => boolean = () => true
): Promise<NearbyPlace> {
  for (let ring = 1; ring <= 4; ring++) {
    const tiles = await tilesAround(lat, lng, ring);
    let best: { km: number; p: Point; cat: string } | null = null;
    for (const tile of tiles) {
      for (const cat of categories) {
        for (const p of tile[cat] ?? []) {
          if (!accept(p)) continue;
          const km = haversineKm(lat, lng, p[1], p[0]);
          if (!best || km < best.km) best = { km, p, cat };
        }
      }
    }
    const marginKm = ring * TILE_DEG * 111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    if (best && best.km <= marginKm) {
      return {
        minutes: kmToMinutes(best.km),
        name: best.p[2] || fallbackName[best.cat] || null,
        lat: best.p[1],
        lng: best.p[0],
      };
    }
  }
  return { minutes: null, name: null, lat: null, lng: null };
}

let cityIndex: { kd: KDBush; cities: ReturnType<typeof getDiscoverCities> } | null = null;

/** The closest shortlisted place (every town of 5,000+ people, including
 *  big-city districts) - gives pin mode a "near <town>" label (replacing a
 *  live reverse-geocoding call) and a local ground elevation. */
function nearestShortlistedCity(lat: number, lng: number, maxKm: number) {
  if (!cityIndex) {
    const cities = getDiscoverCities();
    const kd = new KDBush(cities.length);
    for (const c of cities) kd.add(c.lng, c.lat);
    kd.finish();
    cityIndex = { kd, cities };
  }
  const [id] = around(cityIndex.kd, lng, lat, 1, maxKm);
  return id != null ? cityIndex.cities[id] : null;
}

async function localGroundElevation(lat: number, lng: number): Promise<number> {
  const city = nearestShortlistedCity(lat, lng, 50);
  if (!city) return 0;
  const record = (await getCountryCities(city.countryCode)).find((r) => r.id === city.cityId);
  return record?.elevationM ?? 0;
}

export async function getPinnedLocationData(lat: number, lng: number): Promise<PinnedLocationData> {
  const minPeak = Math.max(MOUNTAIN_MIN_ELEVATION_M, (await localGroundElevation(lat, lng)) + MOUNTAIN_MIN_RISE_M);
  const [nearestBeach, nearestMountain, nearestTrainStation, nearestAirport] = await Promise.all([
    nearest(lat, lng, ["beach", "coast"], { coast: "Nearby coast" }),
    nearest(lat, lng, ["mountain"], {}, (p) => (p[3] ?? 0) >= minPeak),
    nearest(lat, lng, ["train"]),
    nearest(lat, lng, ["airport"], {}, (p) => !/heli(port|stop|pad)|helipad/i.test(p[2])),
  ]);
  const place = nearestShortlistedCity(lat, lng, 25);
  return { lat, lng, neighbourhoodName: place?.cityName ?? null, nearestBeach, nearestMountain, nearestTrainStation, nearestAirport };
}
