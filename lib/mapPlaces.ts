import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import type { NearbyKind } from "@/lib/dataset/schema";

/**
 * Every place of a kind around a city - all its schools, stations... - for
 * a Yes figure on the map, from the map's own OpenStreetMap tiles
 * (OpenFreeMap, OpenMapTiles schema). The dataset keeps only the 6 nearest
 * of each kind (nearby/), which in London is a handful out of hundreds
 * (2026-10-28, on request). Schools and the like are only in the most
 * detailed tiles (zoom 14, ~1.5-2.5 km across), so those are read for the
 * whole circle - nearest first, reported as they arrive - and kept, so
 * another figure in the same place needs no new download. The browser
 * caches the tiles too, and the map reuses them when zoomed in.
 */

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const ZOOM = 14;
const PARALLEL = 6;

/** OpenMapTiles' poi class (and subclasses) for each kind a Yes shows.
 *  Care homes aren't in the tiles: they keep the dataset's nearest 6. */
const OSM_POI: Partial<Record<NearbyKind, { cls: string; subclasses?: string[] }>> = {
  train: { cls: "railway", subclasses: ["station", "halt"] },
  metro: { cls: "railway", subclasses: ["subway"] },
  tram: { cls: "railway", subclasses: ["tram_stop"] },
  bus: { cls: "bus", subclasses: ["bus_station"] },
  port: { cls: "ferry_terminal" },
  nursery: { cls: "school", subclasses: ["kindergarten"] },
  school: { cls: "school", subclasses: ["school"] },
  university: { cls: "college", subclasses: ["university"] },
  hospital: { cls: "hospital", subclasses: ["hospital"] },
};
const CLASSES = new Set(Object.values(OSM_POI).map((p) => p!.cls));

/** The kinds the map can show from its own tiles: a Yes's, or any of them
 *  ticked in the map's layer list (2026-10-28, on request). */
export const MAP_LAYER_KINDS = Object.keys(OSM_POI) as NearbyKind[];

/** A kind's places on the tiles' poi layer, as a map style filter - the
 *  map draws them itself once it shows the detailed tiles (zoom 14+). */
export function osmPoiFilter(kind: NearbyKind): unknown[] {
  const want = OSM_POI[kind]!;
  return [
    "all",
    ["==", ["get", "class"], want.cls],
    ...(want.subclasses ? [["in", ["get", "subclass"], ["literal", want.subclasses]]] : []),
  ];
}

/** A Yes is "within 5 km of the centre" (10 km for a port) - the same
 *  radii as the figures themselves (lib/kpiRows.ts presenceRows). */
export function yesRadiusKm(kind: NearbyKind): number {
  return kind === "port" ? 10 : 5;
}

export function hasMapPlaces(kind: NearbyKind): boolean {
  return kind in OSM_POI;
}

export interface MapPlace {
  lng: number;
  lat: number;
  name: string;
  km: number;
}

interface TilePoi {
  cls: string;
  subclass: string;
  name: string;
  lng: number;
  lat: number;
}

let templatePromise: Promise<string> | null = null;
function tileTemplate(): Promise<string> {
  templatePromise ??= fetch(TILEJSON_URL)
    .then((r) => r.json())
    .then((j: { tiles: string[] }) => j.tiles[0]);
  templatePromise.catch(() => (templatePromise = null));
  return templatePromise;
}

/** The kinds' places in one tile (only the classes any kind uses), kept
 *  for the most recent tiles. */
const tiles = new Map<string, Promise<TilePoi[]>>();
const KEEP_TILES = 150;

function tilePois(x: number, y: number, signal: AbortSignal): Promise<TilePoi[]> {
  const key = `${x}/${y}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const promise = tileTemplate()
    .then((template) => fetch(template.replace("{z}", String(ZOOM)).replace("{x}", String(x)).replace("{y}", String(y)), { signal }))
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`tile ${key}: ${r.status}`))))
    .then((buffer) => {
      const layer = new VectorTile(new Pbf(buffer)).layers.poi;
      const out: TilePoi[] = [];
      for (let i = 0; layer && i < layer.length; i++) {
        const feature = layer.feature(i);
        const cls = String(feature.properties.class ?? "");
        if (!CLASSES.has(cls)) continue;
        const geometry = feature.toGeoJSON(x, y, ZOOM).geometry;
        const coords = geometry.type === "Point" ? [geometry.coordinates] : geometry.type === "MultiPoint" ? geometry.coordinates : [];
        for (const [lng, lat] of coords) {
          out.push({ cls, subclass: String(feature.properties.subclass ?? ""), name: String(feature.properties.name ?? ""), lng, lat });
        }
      }
      return out;
    });
  tiles.set(key, promise);
  // An interrupted or failed download is tried again next time.
  promise.catch(() => tiles.delete(key));
  if (tiles.size > KEEP_TILES) tiles.delete(tiles.keys().next().value!);
  return promise;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

const tileX = (lng: number) => Math.floor(((lng + 180) / 360) * 2 ** ZOOM);
const tileY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM);
};
const tileLng = (x: number) => (x / 2 ** ZOOM) * 360 - 180;
const tileLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** ZOOM))) * 180) / Math.PI;

/** All `kind` places within its Yes radius of the centre, nearest first.
 *  `onUpdate` gets the list so far after each tile, and `done` once every
 *  tile is in. Tiles that fail are skipped. */
export async function loadMapPlaces(
  kind: NearbyKind,
  center: { lat: number; lng: number },
  signal: AbortSignal,
  onUpdate: (places: MapPlace[], done: boolean) => void
): Promise<void> {
  const want = OSM_POI[kind];
  if (!want) return;
  const radiusKm = yesRadiusKm(kind);
  const dLat = radiusKm / 111.2;
  const dLng = radiusKm / (111.32 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.05));
  const [x0, x1] = [tileX(center.lng - dLng), tileX(center.lng + dLng)];
  const [y0, y1] = [tileY(center.lat + dLat), tileY(center.lat - dLat)];

  // Tiles touching the circle, nearest first.
  const queue: { x: number; y: number; km: number }[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const lng = Math.min(Math.max(center.lng, tileLng(x)), tileLng(x + 1));
      const lat = Math.min(Math.max(center.lat, tileLat(y + 1)), tileLat(y));
      const km = haversineKm(center.lat, center.lng, lat, lng);
      if (km <= radiusKm) queue.push({ x, y, km });
    }
  }
  queue.sort((a, b) => a.km - b.km);

  const found: MapPlace[] = [];
  // Tiles overlap a little at their edges, and a station can be mapped
  // twice (a point and a building): one per name within 200 m, and one per
  // spot for unnamed places.
  const seen = new Map<string, MapPlace[]>();
  const add = (p: TilePoi) => {
    if (p.cls !== want.cls || (want.subclasses && !want.subclasses.includes(p.subclass))) return;
    const km = haversineKm(center.lat, center.lng, p.lat, p.lng);
    if (km > radiusKm) return;
    const key = p.name || `${p.lng.toFixed(4)},${p.lat.toFixed(4)}`;
    const same = seen.get(key) ?? [];
    if (same.some((q) => haversineKm(q.lat, q.lng, p.lat, p.lng) < 0.2)) return;
    const place = { lng: p.lng, lat: p.lat, name: p.name, km };
    same.push(place);
    seen.set(key, same);
    found.push(place);
  };

  let next = 0;
  const worker = async () => {
    while (next < queue.length && !signal.aborted) {
      const { x, y } = queue[next++];
      const pois = await tilePois(x, y, signal).catch(() => []);
      if (signal.aborted) return;
      pois.forEach(add);
      found.sort((a, b) => a.km - b.km);
      onUpdate(found.slice(), false);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (!signal.aborted) onUpdate(found.slice(), true);
}
