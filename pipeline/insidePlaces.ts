import type KDBush from "kdbush";
import { around } from "geokdbush";
import { decodeBoundary, INSIDE_MARGIN_KM, INSIDE_NO_OUTLINE_KM, type EncodedBoundary, type NearbyPoint } from "@/lib/dataset/schema";

/**
 * Every place of a kind in a city - its outline, or within INSIDE_MARGIN_KM
 * of it (5 km of the centre for a place with no outline) - for the city
 * page's "School: Yes · 2,431" and its map, which shows all of them
 * (2026-10-29, on request: "we should see all schools... within the border
 * of the city", "border + 1 km"). Before, a Yes meant "within 5 km of the
 * centre", which in London stopped at zone 1.
 *
 * Distances are measured on a flat map centred on the city (km east and
 * north of its centre) - exact enough at a city's scale.
 */

const KM_PER_DEG = 111.32;
/** Points closer than this are one place from two sources. */
const DUP_KM = 0.15;

/** A source of places, as build.ts indexes them. */
export interface PlaceIndex {
  kd: KDBush;
  points: { lng: ArrayLike<number>; lat: ArrayLike<number>; names?: ArrayLike<string | null> | null };
  size: number;
}

/** A city's area on its flat map: the outline's rings as segment lists
 *  (x1, y1, x2, y2 in km), or a circle. */
export interface CityArea {
  lat: number;
  lng: number;
  kx: number;
  rings: Float64Array[] | null;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** How far from the centre anything inside can be (km). */
  reachKm: number;
}

export function cityArea(lat: number, lng: number, outline: EncodedBoundary | null): CityArea {
  const kx = KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  if (!outline) {
    const r = INSIDE_NO_OUTLINE_KM;
    return { lat, lng, kx, rings: null, minX: -r, maxX: r, minY: -r, maxY: r, reachKm: r };
  }
  const rings: Float64Array[] = [];
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const polygon of decodeBoundary(outline)) {
    for (const ring of polygon) {
      const xy = ring.map(([x, y]) => [(x - lng) * kx, (y - lat) * KM_PER_DEG]);
      const segments = new Float64Array(Math.max(0, xy.length - 1) * 4);
      for (let k = 0; k + 1 < xy.length; k++) {
        segments.set([xy[k][0], xy[k][1], xy[k + 1][0], xy[k + 1][1]], k * 4);
        minX = Math.min(minX, xy[k][0]);
        maxX = Math.max(maxX, xy[k][0]);
        minY = Math.min(minY, xy[k][1]);
        maxY = Math.max(maxY, xy[k][1]);
      }
      if (segments.length) rings.push(segments);
    }
  }
  const m = INSIDE_MARGIN_KM;
  const reachKm = Math.hypot(Math.max(-minX, maxX) + m, Math.max(-minY, maxY) + m);
  return { lat, lng, kx, rings, minX: minX - m, maxX: maxX + m, minY: minY - m, maxY: maxY + m, reachKm };
}

/** Inside the outline (even-odd over every ring, so holes count as
 *  outside), or within INSIDE_MARGIN_KM of its line; in the circle when
 *  there's no outline. */
function isInside(area: CityArea, x: number, y: number): boolean {
  if (x < area.minX || x > area.maxX || y < area.minY || y > area.maxY) return false;
  if (!area.rings) return x * x + y * y <= INSIDE_NO_OUTLINE_KM ** 2;
  let crossings = 0;
  let nearestSq = Infinity;
  const marginSq = INSIDE_MARGIN_KM ** 2;
  for (const s of area.rings) {
    for (let k = 0; k < s.length; k += 4) {
      const [x1, y1, x2, y2] = [s[k], s[k + 1], s[k + 2], s[k + 3]];
      if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) crossings++;
      if (nearestSq > marginSq) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
        nearestSq = Math.min(nearestSq, (x1 + t * dx - x) ** 2 + (y1 + t * dy - y) ** 2);
      }
    }
  }
  return crossings % 2 === 1 || nearestSq <= marginSq;
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Every place from `sources` in the area, nearest the centre first, one
 *  per spot (the named one where two sources have the same place).
 *  `accept` filters by index id (a mountain must rise above the city);
 *  `suffix` adds to a name (its height). */
export function placesInside(
  area: CityArea,
  sources: PlaceIndex[],
  accept?: (source: number, id: number) => boolean,
  suffix?: (source: number, id: number) => string
): NearbyPoint[] {
  const found: { x: number; y: number; km: number; lng: number; lat: number; name: string }[] = [];
  sources.forEach((index, s) => {
    if (index.size === 0) return;
    for (const id of around(index.kd, area.lng, area.lat, Infinity, area.reachKm, (i: number) => i < index.size) as number[]) {
      if (accept && !accept(s, id)) continue;
      const lng = index.points.lng[id];
      const lat = index.points.lat[id];
      const x = (lng - area.lng) * area.kx;
      const y = (lat - area.lat) * KM_PER_DEG;
      if (!isInside(area, x, y)) continue;
      const name = String(index.points.names?.[id] ?? "") + (suffix ? suffix(s, id) : "");
      found.push({ x, y, km: Math.hypot(x, y), lng, lat, name });
    }
  });
  found.sort((a, b) => a.km - b.km);
  // One per spot: a grid of DUP_KM cells, looking in the neighbouring ones.
  const cells = new Map<string, typeof found>();
  const kept: typeof found = [];
  for (const p of found) {
    const cx = Math.floor(p.x / DUP_KM);
    const cy = Math.floor(p.y / DUP_KM);
    let same: (typeof found)[number] | undefined;
    for (let dx = -1; dx <= 1 && !same; dx++) {
      for (let dy = -1; dy <= 1 && !same; dy++) {
        same = cells.get(`${cx + dx},${cy + dy}`)?.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < DUP_KM);
      }
    }
    if (same) {
      if (!same.name && p.name) same.name = p.name;
      continue;
    }
    const key = `${cx},${cy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(p);
    kept.push(p);
  }
  return kept.map((p) => [round4(p.lng), round4(p.lat), p.name.slice(0, 60)]);
}

/** Whether any of `index`'s points (a line's points - tram track) lies in
 *  the area. */
export function anyInside(area: CityArea, index: PlaceIndex): boolean {
  if (index.size === 0) return false;
  for (const id of around(index.kd, area.lng, area.lat, Infinity, area.reachKm, (i: number) => i < index.size) as number[]) {
    if (isInside(area, (index.points.lng[id] - area.lng) * area.kx, (index.points.lat[id] - area.lat) * KM_PER_DEG)) return true;
  }
  return false;
}
