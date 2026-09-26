import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { log } from "./util";

/** Pin mode's "nearest X" lookups need arbitrary coordinates, not just
 *  shortlisted cities - so the points themselves are published, split
 *  into 5°x5° tiles. The pin API loads only the few tiles around a dropped
 *  pin and finds the nearest point locally (lib/dataset/pin.ts). */
export const POI_TILE_DEG = 5;

export function tileKey(lat: number, lng: number): string {
  return `${Math.floor(lat / POI_TILE_DEG)}_${Math.floor(lng / POI_TILE_DEG)}`;
}

type Source = { lng: ArrayLike<number>; lat: ArrayLike<number>; names: (string | null)[]; elev?: ArrayLike<number> };

/** Each point is [lng, lat, name] - plus elevation (m) for mountains, so pin
 *  mode can apply the same "rises 500 m+ above you" rule as city pages. */
export async function buildPoiTiles(dir: string, sources: Record<string, Source>, coastStride = 5): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const tiles = new Map<string, Record<string, (string | number)[][]>>();
  for (const [category, src] of Object.entries(sources)) {
    // Coastline is densified to ~1 km for accurate city distances; ~5 km
    // spacing is plenty for pin mode and keeps tiles small.
    const stride = category === "coast" ? coastStride : 1;
    for (let i = 0; i < src.lng.length; i += stride) {
      const lat = src.lat[i];
      const lng = src.lng[i];
      const key = tileKey(lat, lng);
      if (!tiles.has(key)) tiles.set(key, {});
      const tile = tiles.get(key)!;
      const point: (string | number)[] = [Math.round(lng * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4, src.names[i] ?? ""];
      if (src.elev) point.push(Math.round(src.elev[i]));
      (tile[category] ??= []).push(point);
    }
  }
  for (const [key, tile] of tiles) writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(tile));
  log("poi", `${tiles.size} POI tiles written`);
}
