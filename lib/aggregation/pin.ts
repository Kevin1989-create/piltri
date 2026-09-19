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
 *
 * `overpassTags` accepts multiple alternative tags (OR'd) for amenities that
 * don't map to one single consistent OSM tag - e.g. subway now covers both
 * underground (`station=subway`) and overground/light-rail metro.
 *
 * `optional` controls what "nothing found anywhere" resolves to: null
 * (amenity genuinely may not exist nearby, e.g. a subway system) rather
 * than a misleading 0 for the required amenities.
 */
async function resolveNearby(
  origin: { lat: number; lng: number },
  mapboxCategory: string,
  overpassTags: string | string[],
  optional = false,
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
  return { minutes: optional ? null : 0, name: null, lat: null, lng: null };
}

/** Tramway resolved via Overpass only, deliberately skipping Mapbox's
 *  category search - Mapbox's category taxonomy doesn't clearly separate
 *  "tram stop" from "metro/subway station" (both often fall under
 *  metro_station-style categories), which risks the same stop double-
 *  counting as both Subway and Tramway. Overpass's `railway=tram_stop` tag
 *  is unambiguous, so it's the sole source here even though that means no
 *  Mapbox-driven name fallback. */
async function resolveTramway(origin: { lat: number; lng: number }, radiusM?: number): Promise<NearbyPlace> {
  const nearby = await nearestFeatureWithDetails(origin.lat, origin.lng, '"railway"="tram_stop"', radiusM).catch(() => null);
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

/**
 * Builds the Pin mode payload for a dropped pin. Every "nearest X" field is
 * a NearbyPlace (minutes + name + coordinates) rather than a bare number,
 * so PinPanel can show what was actually matched and link to directions.
 * Real estate was removed (see lib/types.ts PinnedLocationData) - it was
 * never genuinely point-specific, just a flat placeholder shared with the
 * city-level page; real estate now lives at city level only, via Numbeo.
 */
// The general resolveNearby default (8km, via nearestFeatureWithDetails)
// undershoots for rail-based rapid transit specifically - a Subway search
// now also covers Overground/light-rail, which reaches much further into
// outer boroughs than the deep tube does, and a tram network's stops are
// naturally sparser than, say, schools. Widened so a pin further out in a
// large city doesn't wrongly come back empty just because the nearest
// station happens to be a bit past the generic radius.
const RAPID_TRANSIT_RADIUS_M = 25000;
// Every OSM tag combination plausibly used for "rapid transit metro-like
// station" - station=subway (deep underground, e.g. the Tube),
// station=light_rail (e.g. DLR), subway=yes (an alternate tagging some
// mappers use alongside railway=station), and railway=subway_entrance
// (already the established tag this app uses elsewhere for the city-level
// "has subway" flag - see getTransportPresence in overpass.ts - included
// here too so Pin mode and city-level scoring agree on what counts).
const SUBWAY_TAGS = ['"station"="subway"', '"station"="light_rail"', '"subway"="yes"', '"railway"="subway_entrance"'];

export async function aggregatePinData(lat: number, lng: number): Promise<PinnedLocationData> {
  const origin = { lat, lng };

  const [
    school,
    nursery,
    university,
    train,
    subway,
    tramway,
    highStreet,
    domesticAirport,
    intlAirport,
    beach,
    park,
    hospital,
    elderlyCare,
  ] = await Promise.all([
    resolveNearby(origin, "school", '"amenity"="school"'),
    resolveNearby(origin, "childcare", '"amenity"="kindergarten"'),
    resolveNearby(origin, "university", '"amenity"="university"'),
    resolveNearby(origin, "train_station", '"railway"="station"'),
    // Broadened from underground-only ("station"="subway") to also match
    // overground/light-rail metro systems (e.g. London Overground), on
    // request - a single "Subway" figure should cover the whole rapid-
    // transit network, not just deep-level tube lines.
    resolveNearby(origin, "metro_station", SUBWAY_TAGS, true, RAPID_TRANSIT_RADIUS_M),
    resolveTramway(origin, RAPID_TRANSIT_RADIUS_M),
    resolveNearby(origin, "shopping", '"shop"="mall"'),
    resolveNearby(origin, "airport", '"aeroway"="aerodrome"'),
    resolveNearby(origin, "airport", '"aeroway"="aerodrome"'),
    resolveBeach(origin),
    resolveNearby(origin, "park", '"leisure"="park"'),
    resolveNearby(origin, "hospital", '"amenity"="hospital"'),
    resolveNearby(origin, "nursing_home", '"amenity"="social_facility"'),
  ]);

  return {
    lat,
    lng,
    neighbourhoodName: null, // populate via reverse geocoding (Mapbox) if desired
    education: {
      nearestSchool: school,
      nearestNursery: nursery,
      nearestUniversity: university,
    },
    transport: {
      trainStation: train,
      subwayStation: subway,
      tramway,
      highStreet: highStreet,
      domesticAirport: domesticAirport,
      internationalAirport: intlAirport,
    },
    natureAndHealth: {
      beach,
      park,
      hospital,
      elderlyCare,
    },
  };
}
