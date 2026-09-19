/**
 * Mapbox — free tier (needs NEXT_PUBLIC_MAPBOX_TOKEN, Phase 3.1 / 1.7).
 * Used for: city search geocoding (Explore landing suggestions) and
 * point-to-point travel times in Pin mode.
 * Docs: https://docs.mapbox.com/api/search/geocoding/ and /navigation/directions/
 */

import type { CitySearchResult } from "@/lib/types";
import { fetchWithTimeout } from "./fetchWithTimeout";

function requireToken(): string {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN is not set. See .env.example.");
  return token;
}

// Mapbox's `place` type is documented as "city, town, village, or other
// municipality relevant to a country's address format", but in practice it
// also picks up a handful of major landmarks that function as an address
// locality in their gazetteer - airports being the most common case (e.g.
// "Gatwick Airport" comes back as a `place` result, not just a `poi`,
// presumably because it's used as an address reference the way a town
// would be). No genuine city legitimately has "Airport"/"Intl"/
// "International Airport" as part of its actual name, so filtering these
// out by name is a safe, low-risk heuristic - not a fix for a Piltri bug,
// but a workaround for this specific Mapbox classification quirk.
const NON_CITY_NAME_PATTERN = /\b(airport|international airport|intl airport)\b/i;

/** Forward geocoding for the Explore search bar — city/region/country/continent. */
export async function searchPlaces(query: string, limit = 6): Promise<CitySearchResult[]> {
  const token = requireToken();
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?types=place,region,country&limit=${limit}&access_token=${token}`;

  const res = await fetchWithTimeout(url, {}, 5000);
  if (!res.ok) throw new Error(`Mapbox geocoding failed: ${res.status}`);
  const json = await res.json();

  return (json.features ?? [])
    .filter((f: any) => !NON_CITY_NAME_PATTERN.test(f.text ?? ""))
    .map((f: any) => {
      const context: any[] = f.context ?? [];
      const region = context.find((c) => c.id.startsWith("region"))?.text ?? null;
      const country = context.find((c) => c.id.startsWith("country"))?.text ?? f.text;
      const countryCode = (context.find((c) => c.id.startsWith("country"))?.short_code ?? "").toUpperCase();
      return {
        cityId: f.id,
        cityName: f.text,
        region,
        country,
        countryCode,
        lat: f.center[1],
        lng: f.center[0],
      } as CitySearchResult;
    });
}

/** Driving time in minutes between two points, used throughout Pin mode. */
export async function drivingMinutesBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<number | null> {
  const token = requireToken();
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}?access_token=${token}`;

  const res = await fetchWithTimeout(url, {}, 5000);
  if (!res.ok) return null;
  const json = await res.json();
  const durationSec = json?.routes?.[0]?.duration;
  return durationSec != null ? Math.round(durationSec / 60) : null;
}

/** Duration-only lookup (no geometry) for a given Mapbox Directions profile
 *  - used for the walking time shown alongside the driving route in Pin
 *  mode's directions (see PinPanel), where only the number is needed, not a
 *  second line drawn on the map. Returns null if the profile genuinely has
 *  no route between the two points (e.g. walking across water) or the call
 *  fails, same as drivingMinutesBetween. */
export async function travelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  profile: "driving" | "walking"
): Promise<number | null> {
  const token = requireToken();
  const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?access_token=${token}`;

  const res = await fetchWithTimeout(url, {}, 5000);
  if (!res.ok) return null;
  const json = await res.json();
  const durationSec = json?.routes?.[0]?.duration;
  return durationSec != null ? Math.round(durationSec / 60) : null;
}

export interface DrivingRouteResult {
  /** GeoJSON LineString geometry - drawn directly on our own map as a route
   *  line, instead of sending the user out to a Google Maps tab. */
  geometry: GeoJSON.LineString;
  km: number;
  minutes: number;
}

/** Full driving route (line geometry + distance/time) between two points -
 *  same Mapbox Directions endpoint as drivingMinutesBetween above, just
 *  additionally requesting the route geometry so it can be drawn on the
 *  map. Client-safe: NEXT_PUBLIC_MAPBOX_TOKEN is inlined into the browser
 *  bundle by Next.js, so this can run from a "use client" component (see
 *  MapView.tsx) exactly like the map's own tiles do. */
export async function drivingRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Promise<DrivingRouteResult | null> {
  const token = requireToken();
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}?geometries=geojson&overview=full&access_token=${token}`;

  const res = await fetchWithTimeout(url, {}, 8000);
  if (!res.ok) return null;
  const json = await res.json();
  const route = json?.routes?.[0];
  if (!route?.geometry) return null;
  return {
    geometry: route.geometry,
    km: Number((route.distance / 1000).toFixed(1)),
    minutes: Math.round(route.duration / 60),
  };
}

export interface NearestPoiResult {
  name: string | null;
  lat: number;
  lng: number;
  /** Driving minutes, or null if the Directions call itself failed (the
   *  place was still found - caller can fall back to a straight-line
   *  estimate using lat/lng rather than discarding the match entirely). */
  minutes: number | null;
}

/** Nearest POI of a given category via Mapbox's category search, plus
 *  driving time to it. Returns the place's name/coordinates too (not just
 *  a duration) so the caller can show what was actually matched and link
 *  to directions - previously this only returned a number.
 *
 *  HONEST CAVEAT: the exact field Mapbox's Search Box category response
 *  uses for a human-readable name isn't something I could verify from this
 *  sandbox (no live Mapbox access) - `properties.name` is the documented
 *  field, with `text`/`properties.name_preferred` as fallbacks in case the
 *  live response shape differs from the docs. Watch for a missing name the
 *  first time this runs against real traffic. */
export async function nearestPoi(origin: { lat: number; lng: number }, category: string): Promise<NearestPoiResult | null> {
  const token = requireToken();
  const url =
    `https://api.mapbox.com/search/searchbox/v1/category/${category}` +
    `?proximity=${origin.lng},${origin.lat}&limit=1&access_token=${token}`;

  const res = await fetchWithTimeout(url, {}, 5000);
  if (!res.ok) return null;
  const json = await res.json();
  const feature = json?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!coords) return null;

  const dest = { lat: coords[1], lng: coords[0] };
  const name = feature?.properties?.name ?? feature?.properties?.name_preferred ?? feature?.text ?? null;
  const minutes = await drivingMinutesBetween(origin, dest);
  return { name, lat: dest.lat, lng: dest.lng, minutes };
}

export interface ReverseGeocodedPoi {
  name: string;
  lat: number;
  lng: number;
}

/** Reverse-geocodes a clicked point to its nearest POI - used as a fallback
 *  when clicking a map feature to pick it as a directions destination (see
 *  MapView.tsx). Reading currently-*rendered* map labels via
 *  queryRenderedFeatures only sees what Mapbox's own label-collision logic
 *  actually chose to draw at the current zoom - real POIs whose labels got
 *  hidden to avoid overlapping another one are invisible to it even though
 *  they're still there. A reverse geocode isn't subject to that; it's a
 *  server-side lookup against the underlying place data, not the rendered
 *  screen. Not a substitute for the rendered-feature check (that one is
 *  instant and needs no network round trip when it works) - this is the
 *  fallback for when it doesn't. */
export async function reverseGeocodePoi(lat: number, lng: number): Promise<ReverseGeocodedPoi | null> {
  const token = requireToken();
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` + `?types=poi&limit=1&access_token=${token}`;

  const res = await fetchWithTimeout(url, {}, 5000);
  if (!res.ok) return null;
  const json = await res.json();
  const feature = json?.features?.[0];
  const center = feature?.center;
  if (!feature?.text || !center) return null;
  return { name: feature.text, lat: center[1], lng: center[0] };
}
