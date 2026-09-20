import { nearestPoi } from "@/lib/data-sources/mapbox";
import { isNearCoastOrLake, nearestFeatureWithDetails, nearestVerifiedBeach } from "@/lib/data-sources/overpass";
import type { NearbyPlace, PinnedLocationData } from "@/lib/types";

/** Rough km -> minutes fallback (assumes ~30km/h average local travel speed). */
function kmToMinutes(km: number): number {
  return Math.round((km / 30) * 60);
}

/** Straight-line (haversine) distance in km — used only as a last-resort
 *  travel-time estimate when Mapbox found a place but the Directions call
 *  itself failed, so we still show that same place's minutes rather than
 *  silently switching to a different place from the Overpass fallback. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Resolves a single "nearest X" Pin mode field. Mapbox's category search is
 * the primary source (gives a real place name); Overpass's nearest-tagged-
 * feature query is the fallback when Mapbox finds nothing. If Mapbox finds
 * a place but the separate Directions call fails, we still use that same
 * place (via a straight-line estimate) rather than falling through to
 * Overpass, which could return a completely different, unrelated place -
 * that would show a name that doesn't match the minutes figure.
 */
async function resolveNearby(
  origin: { lat: number; lng: number },
  mapboxCategory: string,
  overpassTags: string | string[],
  radiusM?: number
): Promise<NearbyPlace> {
  try {
    const poi = await nearestPoi(origin, mapboxCategory);
    if (poi) {
      const minutes = poi.minutes ?? kmToMinutes(haversineKm(origin, { lat: poi.lat, lng: poi.lng }));
      return { minutes, name: poi.name, lat: poi.lat, lng: poi.lng };
    }
  } catch {
    // fall through to Overpass
  }
  const nearby = await nearestFeatureWithDetails(origin.lat, origin.lng, overpassTags, radiusM).catch(() => null);
  if (nearby) {
    return { minutes: kmToMinutes(nearby.km), name: nearby.name, lat: nearby.lat, lng: nearby.lng };
  }
  return { minutes: null, name: null, lat: null, lng: null };
}

/** Nearest mountain/peak — Overpass only (`natural=peak`), no Mapbox
 *  category search maps cleanly onto "mountain peak". Wide radius since a
 *  genuine nearby mountain is routinely much further out than any other
 *  amenity checked here. */
async function resolveMountain(origin: { lat: number; lng: number }, radiusM: number): Promise<NearbyPlace> {
  const nearby = await nearestFeatureWithDetails(origin.lat, origin.lng, '"natural"="peak"', radiusM).catch(() => null);
  if (nearby) {
    return { minutes: kmToMinutes(nearby.km), name: nearby.name, lat: nearby.lat, lng: nearby.lng };
  }
  return { minutes: null, name: null, lat: null, lng: null };
}

/**
 * Nearest genuine beach - both the Mapbox POI and Overpass fallback paths
 * are cross-checked against isNearCoastOrLake (see overpass.ts) before
 * being accepted, since OSM's `natural=beach` tag alone doesn't distinguish
 * a real sea/lake beach from a small riverside sand patch in the middle of
 * a city (e.g. London's "Bermondsey Beach" on the tidal Thames - tagged
 * exactly like a real beach, but not one). If Mapbox's candidate fails
 * that check, we fall through to nearestVerifiedBeach, which vets several
 * Overpass candidates in distance order rather than just the single
 * nearest tag match.
 */
async function resolveBeach(origin: { lat: number; lng: number }): Promise<NearbyPlace> {
  try {
    const poi = await nearestPoi(origin, "beach");
    if (poi && (await isNearCoastOrLake(poi.lat, poi.lng))) {
      const minutes = poi.minutes ?? kmToMinutes(haversineKm(origin, { lat: poi.lat, lng: poi.lng }));
      return { minutes, name: poi.name, lat: poi.lat, lng: poi.lng };
    }
  } catch {
    // fall through to the vetted Overpass search
  }
  const verified = await nearestVerifiedBeach(origin.lat, origin.lng).catch(() => null);
  if (verified) {
    return { minutes: kmToMinutes(verified.km), name: verified.name, lat: verified.lat, lng: verified.lng };
  }
  return { minutes: null, name: null, lat: null, lng: null };
}

// Airports and mountains are both routinely much further from a dropped pin
// than a train station or beach - a wide shared radius avoids false
// negatives the default 8km window would produce for almost every pin.
const FAR_AMENITY_RADIUS_M = 40000;

/**
 * Builds the Pin mode payload for a dropped pin — deliberately just 4
 * fields (beach, mountain, airport, train station), down from an earlier
 * 13-field version that fired ~13 parallel lookups per pin and was the
 * single biggest source of slow/unreliable pins (see KNOWN-ISSUES.md
 * history). Every "nearest X" field is a NearbyPlace (minutes + name +
 * coordinates) rather than a bare number, so PinPanel can show what was
 * actually matched and link to directions.
 */
export async function aggregatePinData(lat: number, lng: number): Promise<PinnedLocationData> {
  const origin = { lat, lng };

  const [beach, mountain, trainStation, airport] = await Promise.all([
    resolveBeach(origin),
    resolveMountain(origin, FAR_AMENITY_RADIUS_M),
    resolveNearby(origin, "train_station", '"railway"="station"'),
    resolveNearby(origin, "airport", '"aeroway"="aerodrome"', FAR_AMENITY_RADIUS_M),
  ]);

  return {
    lat,
    lng,
    neighbourhoodName: null, // populate via reverse geocoding (Mapbox) if desired
    nearestBeach: beach,
    nearestMountain: mountain,
    nearestTrainStation: trainStation,
    nearestAirport: airport,
  };
}
