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
      next: { revalidate: 60 * 60 * 24 * 30 },
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
