/**
 * Country capital coordinates — static, from GeoNames' cities5000 export
 * (feature code PPLC), regenerated alongside the city shortlist itself
 * (see scripts/generateDiscoverCities.mjs). Pure geometry from here, not a
 * live lookup: distance to a country's own capital never needs an
 * external API call, so unlike distanceToBeachKm/distanceToMountainKm/
 * distanceToForestKm this one is never null except for the ~10 countries
 * GeoNames has no PPLC row for at all (disputed/unusual capital
 * arrangements - see the generation script's comment).
 */

import countryCapitals from "@/data/static/country-capitals.json";

interface CapitalEntry {
  name: string;
  lat: number;
  lng: number;
}

const CAPITALS = countryCapitals as Record<string, CapitalEntry>;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Snapped to exactly 0 under this threshold (2026-09-26, on request - a
// search on the capital itself was showing "0.2 km" instead of "0 km"):
// the searched city's own coordinate (from Mapbox geocoding) and this
// static table's GeoNames PPLC point are two independent geocodes of the
// same real-world city centre, so a small sub-km gap between them is
// noise from that mismatch, not a genuine distance.
const SAME_CITY_THRESHOLD_KM = 1;

/** Straight-line distance from (lat, lng) to countryCode's national
 *  capital - 0 for a search on the capital city itself (or anywhere within
 *  SAME_CITY_THRESHOLD_KM of it), null when GeoNames has no capital on
 *  file for that country code. */
export function distanceToCapitalKm(lat: number, lng: number, countryCode: string): number | null {
  const capital = CAPITALS[countryCode.toUpperCase()];
  if (!capital) return null;
  const km = haversineKm(lat, lng, capital.lat, capital.lng);
  return km < SAME_CITY_THRESHOLD_KM ? 0 : Number(km.toFixed(1));
}
