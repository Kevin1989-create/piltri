/**
 * Road routes for the city map's distance figures, from the OpenStreetMap
 * community's routing server (OSRM, run by FOSSGIS - routing.openstreetmap.de).
 * The one live service the site calls (2026-10-16, on request): only when
 * someone taps a distance, one request per tap. Its usage policy: credit
 * it with a "fix the map" link (ROUTE_ATTRIBUTION), at most one request a
 * second, no heavy use. When it's down or slow, the map keeps the
 * straight line - nothing else depends on it.
 */

const BASE = "https://routing.openstreetmap.de";
/** Walk up to this far; drive beyond. */
export const WALK_MAX_KM = 2;
const TIMEOUT_MS = 6000;

export const ROUTE_ATTRIBUTION =
  'Routes: <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">OSRM / FOSSGIS</a> · ' +
  '<a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Fix the map</a>';

export interface Route {
  /** [lng, lat] along the roads. */
  coordinates: [number, number][];
  km: number;
  minutes: number;
  mode: "car" | "foot";
}

type Point = { lng: number; lat: number };

const cache = new Map<string, Promise<Route | null>>();
let nextSlot = 0;

/** The road route between two points, or null if the server can't give
 *  one in time. Repeated taps reuse the answer. */
export function fetchRoute(from: Point, to: Point, mode: Route["mode"]): Promise<Route | null> {
  const key = [mode, from.lng.toFixed(4), from.lat.toFixed(4), to.lng.toFixed(4), to.lat.toFixed(4)].join(",");
  const hit = cache.get(key);
  if (hit) return hit;
  const request = (async (): Promise<Route | null> => {
    // At most one request a second (the server's policy).
    const wait = Math.max(0, nextSlot - Date.now());
    nextSlot = Date.now() + wait + 1000;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const profile = mode === "foot" ? "routed-foot" : "routed-car";
    const straightKm = Math.hypot((to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180), to.lat - from.lat) * 111;
    // Long drives: a simplified line is plenty at that zoom, and lighter.
    const overview = straightKm > 50 ? "simplified" : "full";
    const url = `${BASE}/${profile}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=${overview}&geometries=geojson`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const json = await res.json();
      const route = json?.code === "Ok" ? json.routes?.[0] : null;
      if (!route?.geometry?.coordinates?.length) return null;
      return { coordinates: route.geometry.coordinates, km: route.distance / 1000, minutes: route.duration / 60, mode };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  cache.set(key, request);
  // A failure may be passing - let a later tap try again.
  request.then((r) => r || cache.delete(key));
  return request;
}
