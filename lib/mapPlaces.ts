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
 *  Care homes aren't in the tiles: they keep the dataset's nearest 6.
 *  `drawn`: what the map draws itself from the tiles when it differs - bus
 *  stops only, the stations being in the city's own list (2026-11-11,
 *  owner: "Bus" counts stops now, London has ~24,000). */
const OSM_POI: Partial<Record<NearbyKind, { cls: string; subclasses?: string[]; drawn?: string[]; always?: boolean }>> = {
  train: { cls: "railway", subclasses: ["station", "halt"] },
  metro: { cls: "railway", subclasses: ["subway"] },
  tram: { cls: "railway", subclasses: ["tram_stop"] },
  bus: { cls: "bus", subclasses: ["bus_station", "bus_stop"], drawn: ["bus_stop"], always: true },
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
  const subclasses = want.drawn ?? want.subclasses;
  return [
    "all",
    ["==", ["get", "class"], want.cls],
    ...(subclasses ? [["in", ["get", "subclass"], ["literal", subclasses]]] : []),
  ];
}

/** Kinds whose tile places the map draws even when the city has its own
 *  list - bus stops, which the list (stations) leaves out. */
export function drawsTilesAlways(kind: NearbyKind): boolean {
  return !!OSM_POI[kind]?.always;
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

/* ------------------------------------------------------------------ */
/* Names in the tiles: the address search's fallback                   */
/* ------------------------------------------------------------------ */

/** A named street, place or place of interest read from a detailed tile. */
interface TileName {
  name: string;
  /** "street", or the place's class ("school", "bus", "suburb"...). */
  kind: string;
  lng: number;
  lat: number;
}

/** The named streets, places and places of interest in one tile, kept for
 *  the most recent tiles. */
const nameTiles = new Map<string, Promise<TileName[]>>();

function tileNames(x: number, y: number, signal: AbortSignal): Promise<TileName[]> {
  const key = `${x}/${y}`;
  const hit = nameTiles.get(key);
  if (hit) return hit;
  const promise = tileTemplate()
    .then((template) => fetch(template.replace("{z}", String(ZOOM)).replace("{x}", String(x)).replace("{y}", String(y)), { signal }))
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`tile ${key}: ${r.status}`))))
    .then((buffer) => {
      const tile = new VectorTile(new Pbf(buffer));
      const out: TileName[] = [];
      for (const [layerName, kindOf] of [
        ["transportation_name", () => "street"],
        ["poi", (p: Record<string, unknown>) => String(p.class ?? "place")],
        ["place", (p: Record<string, unknown>) => String(p.class ?? "place")],
      ] as const) {
        const layer = tile.layers[layerName];
        for (let i = 0; layer && i < layer.length; i++) {
          const feature = layer.feature(i);
          const name = String(feature.properties["name:latin"] ?? feature.properties.name ?? "");
          if (!name) continue;
          const geometry = feature.toGeoJSON(x, y, ZOOM).geometry;
          // A street: the middle of its line; a place: its point.
          const line = geometry.type === "LineString" ? geometry.coordinates : geometry.type === "MultiLineString" ? geometry.coordinates[0] : null;
          const at = line ? line[Math.floor(line.length / 2)] : geometry.type === "Point" ? geometry.coordinates : null;
          if (!at) continue;
          out.push({ name, kind: kindOf(feature.properties as Record<string, unknown>), lng: at[0], lat: at[1] });
        }
      }
      return out;
    });
  nameTiles.set(key, promise);
  promise.catch(() => nameTiles.delete(key));
  if (nameTiles.size > KEEP_TILES) nameTiles.delete(nameTiles.keys().next().value!);
  return promise;
}

const plainText = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Streets, places and places of interest whose name holds every word of
 *  `text` (house numbers left out), within `radiusKm` of the centre - the
 *  map's own tiles, when the address service doesn't answer (2026-11-12:
 *  Photon went quiet for minutes). Exact starts first, then the nearest;
 *  one per name. No house numbers: the tiles don't carry them. */
export async function searchMapNames(
  text: string,
  center: { lat: number; lng: number },
  radiusKm: number,
  signal: AbortSignal,
  limit = 6
): Promise<{ name: string; kind: string; lng: number; lat: number; km: number }[]> {
  const words = plainText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !/^\d+[a-z]?$/.test(w));
  if (!words.length) return [];
  const dLat = radiusKm / 111.2;
  const dLng = radiusKm / (111.32 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.05));
  const queue: { x: number; y: number }[] = [];
  for (let x = tileX(center.lng - dLng); x <= tileX(center.lng + dLng); x++)
    for (let y = tileY(center.lat + dLat); y <= tileY(center.lat - dLat); y++) queue.push({ x, y });
  const found = new Map<string, { name: string; kind: string; lng: number; lat: number; km: number; starts: boolean }>();
  let next = 0;
  const worker = async () => {
    while (next < queue.length && !signal.aborted) {
      const { x, y } = queue[next++];
      const names = await tileNames(x, y, signal).catch(() => []);
      for (const n of names) {
        const plain = plainText(n.name);
        if (!words.every((w) => plain.includes(w))) continue;
        const km = haversineKm(center.lat, center.lng, n.lat, n.lng);
        if (km > radiusKm) continue;
        const key = `${plain}|${n.kind === "street" ? "street" : n.kind}`;
        const had = found.get(key);
        if (!had || km < had.km) found.set(key, { ...n, km, starts: plain.startsWith(words[0]) });
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  return [...found.values()]
    .sort((a, b) => Number(b.starts) - Number(a.starts) || a.km - b.km)
    .slice(0, limit)
    .map(({ starts: _starts, ...rest }) => rest);
}
