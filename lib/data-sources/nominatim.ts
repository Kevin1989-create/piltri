/**
 * OpenStreetMap Nominatim — free, no key required, but usage-policy limited
 * to ~1 request/second and requires identifying the app via a custom
 * User-Agent header (https://operations.osmfoundation.org/policies/nominatim/).
 * This is why it's called from our own API route (app/api/explore/boundary)
 * rather than directly from the browser.
 *
 * Used to get the *actual* administrative boundary polygon for whatever the
 * user searched (city, region, country, or continent), instead of a
 * fixed-radius circle — and its bounding box, so the map can zoom to fit the
 * whole area rather than sitting at a fixed zoom level regardless of how
 * large the place is.
 */

import turfArea from "@turf/area";
import { fetchWithTimeout } from "./fetchWithTimeout";

export interface PlaceBoundary {
  /** GeoJSON Polygon or MultiPolygon geometry for the searched place. */
  geometry: GeoJSON.Geometry;
  /** [west, south, east, north] — ready for mapbox-gl's fitBounds. */
  bbox: [number, number, number, number];
}

export async function getPlaceBoundary(query: string): Promise<PlaceBoundary | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=1` +
    `&q=${encodeURIComponent(query)}`;

  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        // Required by Nominatim's usage policy — identifies the calling app.
        "User-Agent": "Piltri (piltri.me) - Explore feature boundary lookup",
      },
      cache: "no-store",
    },
    5000
  );
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);

  const results = await res.json();
  const match = results?.[0];
  if (!match?.geojson || !match?.boundingbox) return null;

  // Nominatim returns boundingbox as [south, north, west, east] strings.
  const [south, north, west, east] = match.boundingbox.map(Number);

  return {
    geometry: match.geojson as GeoJSON.Geometry,
    bbox: [west, south, east, north],
  };
}

/**
 * City land area computed from Nominatim's real administrative boundary
 * polygon (geodesic area via @turf/area, m² -> km²) — added 2026-09-22 as
 * the preferred source over Wikidata's stated area (see
 * lib/data-sources/wikidata.ts getCityPopulationAndArea), which is a
 * single manually-entered number with no geometry behind it: no way to
 * tell if it's stale, uses a different definition (city proper vs. metro)
 * than another city's figure, or is simply wrong. A real boundary polygon
 * computed the same way for every city is a more accurate AND more
 * consistent source - Wikidata's area remains the fallback for the
 * ~35-40% of cities (tested against a live sample) where Nominatim has no
 * polygon at all, only a point/pin.
 *
 * Quality filter: Nominatim's `limit=1` returns its single best text
 * match regardless of what kind of place that turns out to be - a
 * landmark, a business, a neighbourhood, or the actual city. Only a
 * result tagged `category: "boundary"` + `type: "administrative"` is
 * accepted; anything else (including a real Polygon geometry attached to
 * the wrong kind of place) is treated the same as no match, rather than
 * risking silently computing the area of the wrong thing.
 */
export async function getCityLandAreaKm2(cityName: string, country: string): Promise<number | null> {
  const query = `${cityName}, ${country}`;
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=1` +
    `&q=${encodeURIComponent(query)}`;

  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        "User-Agent": "Piltri (piltri.me) - city land area backfill",
      },
      cache: "no-store",
    },
    8000
  );
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);

  const results = await res.json();
  const match = results?.[0];
  if (!match?.geojson) return null;
  if (match.category !== "boundary" || match.type !== "administrative") return null;
  if (match.geojson.type !== "Polygon" && match.geojson.type !== "MultiPolygon") return null;

  const areaM2 = turfArea(match.geojson as GeoJSON.Geometry);
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return null;

  return Number((areaM2 / 1_000_000).toFixed(2));
}
