import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { tileKey } from "@/lib/dataset/schema";
import { log } from "./util";

/** Pin mode's "nearest X" lookups work for any coordinate, not just
 *  shortlisted cities - so the points themselves are published, split into
 *  5°x5° tiles. The browser loads only the tiles around a dropped pin and
 *  finds the nearest point locally (lib/dataset/pin.ts). */

type Source = { lng: ArrayLike<number>; lat: ArrayLike<number>; names: (string | null)[]; elev?: ArrayLike<number | null> };

/** Each point is [lng, lat, name] - plus elevation (m) for categories that
 *  carry one (peaks for the "rises 500 m+" rule; towns for local ground
 *  level). Returns the keys of the tiles written. */
export function buildPoiTiles(dir: string, sources: Record<string, Source>, coastStride = 5): string[] {
  mkdirSync(dir, { recursive: true });
  const tiles = new Map<string, Record<string, (string | number | null)[][]>>();
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
      const point: (string | number | null)[] = [Math.round(lng * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4, src.names[i] ?? ""];
      if (src.elev) {
        const e = src.elev[i];
        point.push(e == null ? null : Math.round(e));
      }
      (tile[category] ??= []).push(point);
    }
  }
  for (const [key, tile] of tiles) writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(tile));
  log("poi", `${tiles.size} POI tiles written`);
  return [...tiles.keys()].sort();
}
