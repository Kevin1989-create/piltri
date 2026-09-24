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

/** Straight-line distance from (lat, lng) to countryCode's national
 *  capital - 0 for a search on the capital city itself, null when
 *  GeoNames has no capital on file for that country code. */
export function distanceToCapitalKm(lat: number, lng: number, countryCode: string): number | null {
  const capital = CAPITALS[countryCode.toUpperCase()];
  if (!capital) return null;
  return Number(haversineKm(lat, lng, capital.lat, capital.lng).toFixed(1));
}
