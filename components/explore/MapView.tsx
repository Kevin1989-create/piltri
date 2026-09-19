"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { PlaceBoundary } from "@/lib/data-sources/nominatim";
import { drivingRoute, reverseGeocodePoi, travelMinutes } from "@/lib/data-sources/mapbox";
import type { TravelTimes } from "@/lib/types";

interface MapViewProps {
  lat: number;
  lng: number;
  zoom?: number;
  /** Human-readable place name (e.g. "London, United Kingdom") used to look
   *  up its real administrative boundary — falls back to a fixed-radius
   *  circle around lat/lng if no boundary is found. */
  boundaryQuery: string;
  /** A click on the map while NOT in pickingDestination mode - drops/moves
   *  the main pin. Like onDestinationPick below, `name` carries a nearby
   *  labelled map feature's name (POI, transit stop, neighbourhood) when
   *  the click landed on or near one, so the very first pin gets the same
   *  "snap to what you actually clicked, and show what it is" treatment as
   *  the second one - not just raw coordinates with no confirmation of
   *  what's there. */
  onMapClick: (coords: { lat: number; lng: number }, name: string | null) => void;
  /** `label`, if given, is shown in an always-open popup on the main pin's
   *  marker, the same highlight treatment the destination marker gets. */
  pinnedCoords: { lat: number; lng: number; label?: string } | null;
  /** Second pin, for point-to-point directions - drawn as a route line
   *  between pinnedCoords and this, on our own map, rather than sending the
   *  user out to an external Google Maps tab. `label`, if given, is shown
   *  in an always-open popup on the marker so it's obvious what got
   *  selected (see the destination marker effect). */
  destinationCoords: { lat: number; lng: number; label?: string } | null;
  /** True while waiting for the user to click the map to place the second
   *  (destination) pin - shows a hint overlay and routes the next click to
   *  onDestinationPick instead of onMapClick. */
  pickingDestination?: boolean;
  /** A click on the map while pickingDestination is true. If the click
   *  landed on a labelled map feature (a POI icon/label, transit stop, or
   *  neighbourhood label from the Streets style), `name` carries that
   *  feature's own name and the coordinates snap to its exact point rather
   *  than the raw click location - so picking "the coffee shop" actually
   *  pins the coffee shop, not just wherever the cursor happened to land.
   *  `name` is null when the click didn't hit anything labelled, falling
   *  back to the plain clicked coordinates. */
  onDestinationPick?: (coords: { lat: number; lng: number }, name: string | null) => void;
  /** Called with the computed route's distance/time whenever both pins are
   *  set (or with null once either pin is missing / the route can't be
   *  computed), so the parent can show it in PinPanel. */
  onRouteInfo?: (info: TravelTimes | null) => void;
  /** Live-measured height (px) of the PinPanel bar sitting at the bottom of
   *  the screen, so a route's fitBounds can reserve enough space to clear
   *  it - PinPanel's height varies with content (loading vs. loaded, how
   *  many place names got matched, etc.), so this is measured in the
   *  parent via ResizeObserver rather than guessed as a fixed constant. */
  reservedBottomPx?: number;
}

const AREA_SOURCE_ID = "piltri-research-area";
const ROUTE_SOURCE_ID = "piltri-route";
// Fallback circle radius when no real boundary is found — matches the 5km
// radius the backend actually uses for local amenity density queries (see
// RADIUS_M in lib/data-sources/overpass.ts).
const FALLBACK_RADIUS_KM = 5;

/** Custom marker element for the main dropped pin - white teardrop body with
 *  an amber outline and a small amber dot in the centre, the reverse of the
 *  old solid-amber default Marker (which only supports a single flat fill
 *  colour via its `color` option, not a two-tone design like this). A fresh
 *  element is needed per Marker instance since mapboxgl takes ownership of
 *  whatever element it's given. `anchor: "bottom"` on the Marker (set where
 *  this is used) makes the tip of the teardrop - not its centre - the point
 *  that lands on the actual coordinate. */
/** White teardrop body, coloured outline + centre dot - the shared pin
 *  design used for both the main pin (amber, #BA7517) and the second/
 *  destination pin (blue, #3B6E8F), so picking a second pin reads as "the
 *  same kind of thing, different colour" rather than a completely different
 *  marker style (the destination pin used to be Mapbox's plain solid-fill
 *  default). A fresh element is needed per Marker instance since mapboxgl
 *  takes ownership of whatever element it's given. `anchor: "bottom"` on
 *  the Marker (set where this is used) makes the tip of the teardrop - not
 *  its centre - the point that lands on the actual coordinate. */
function createPinElement(color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "28px";
  el.style.height = "36px";
  el.style.filter = "drop-shadow(0 1px 2px rgba(30,26,22,0.35))";
  // Bug (fixed): the old viewBox ("0 0 24 32") matched the path's own
  // bounding box exactly, with zero margin - the SVG canvas clips anything
  // drawn outside its viewBox, so the stroke got cut off flush along the
  // left, right, and top edges instead of rendering a clean rounded
  // outline. Padding the viewBox by 2 units on every side gives the stroke
  // room to actually render in full; the path's own coordinates are
  // unchanged.
  el.innerHTML =
    '<svg viewBox="-2 -2 28 36" width="28" height="36" xmlns="http://www.w3.org/2000/svg">' +
    `<path d="M12 0C5.383 0 0 5.383 0 12c0 9 12 20 12 20s12-11 12-20C24 5.383 18.617 0 12 0z" fill="#FFFFFF" stroke="${color}" stroke-width="1.75" stroke-linejoin="round"/>` +
    `<circle cx="12" cy="12" r="5" fill="${color}"/>` +
    "</svg>";
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** HTML for a pin's highlight popup — the resolved name, plus (only when
 *  there actually is a genuine resolved name, not a generic "Second pin"
 *  fallback) a "View on Google Maps" link that opens in a new tab, so the
 *  user can check ratings/reviews for whatever they just selected without
 *  leaving this page. Built as an HTML string for Popup.setHTML rather than
 *  setText, since a plain text popup can't hold a link - the place name
 *  comes from Mapbox feature properties/reverse-geocoding (external data),
 *  so it's escaped before being inserted. */
// The standard "open in new" glyph (Material Design's open_in_new) - a
// square outline with an arrow breaking out of its top-right corner. This
// is the universally recognised "opens elsewhere" icon, more legible at 11px
// than a bare "↗" character (which renders inconsistently thin/off-baseline
// across fonts) and matches what the request asked for specifically.
const OPEN_IN_NEW_SVG =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;">' +
  '<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>' +
  "</svg>";

// Same font stack as the app's body/UI text (tailwind.config.ts fontFamily.sans)
// so the popup reads as part of the app, not a browser-default fallback.
const POPUP_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";

function popupHtml(label: string | undefined, fallbackText: string): string {
  const text = escapeHtml(label ?? fallbackText);
  if (!label) return `<div style="font:12px ${POPUP_FONT};">${text}</div>`;
  // The link uses the .piltri-popup-link class (globals.css) rather than
  // inline styles for its colour/hover state - Tailwind's hover: variant
  // isn't available inside a plain HTML string, so this reproduces the same
  // font/colour/hover-underline look as PinPanel's place-name buttons via a
  // real CSS rule instead.
  return (
    `<div style="font:12px ${POPUP_FONT}; max-width:170px;">` +
    `<div style="font-weight:600; margin-bottom:3px;">${text}</div>` +
    `<a href="${googleMapsSearchUrl(label)}" target="_blank" rel="noopener noreferrer" class="piltri-popup-link" ` +
    `style="display:inline-flex; align-items:center; gap:4px;">` +
    `Google Maps${OPEN_IN_NEW_SVG}</a>` +
    `</div>`
  );
}

function circlePolygon(centerLat: number, centerLng: number, radiusKm: number, points = 64): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const earthRadiusKm = 6371;
  const latRad = (centerLat * Math.PI) / 180;
  const lngRad = (centerLng * Math.PI) / 180;
  const angularDistance = radiusKm / earthRadiusKm;

  for (let i = 0; i <= points; i++) {
    const bearing = ((i * 360) / points) * (Math.PI / 180);
    const pointLatRad = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const pointLngRad =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLatRad)
      );
    coords.push([(pointLngRad * 180) / Math.PI, (pointLatRad * 180) / Math.PI]);
  }

  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
}

/**
 * Mapbox map, minimal style. Sits behind the score panel / pin panel;
 * clicking anywhere on it drops a pin and triggers pin mode.
 *
 * Rendered exactly once by the parent (never remounted when toggling pin
 * mode) — the parent only changes this component's *container* width via
 * CSS, and the ResizeObserver below handles telling Mapbox to resize and
 * recentre itself. Remounting on every pin toggle was the earlier cause of
 * the dropped-pin marker seeming to disappear and the map view resetting.
 */
export function MapView({
  lat,
  lng,
  zoom = 10,
  boundaryQuery,
  onMapClick,
  pinnedCoords,
  destinationCoords,
  pickingDestination = false,
  onDestinationPick,
  onRouteInfo,
  reservedBottomPx = 0,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null);
  // Whether a route was actually drawn on the last pass through the route
  // effect below - lets it tell "destination just got cleared" apart from
  // "no destination has ever been set yet" so it only flies back to the pin
  // focus in the former case.
  const hadRouteRef = useRef(false);
  const mapLoadedRef = useRef(false);
  // Camera position from just before a pin was dropped, so closing the pin
  // can fly back to the same view rather than staying zoomed in on it.
  const preDropCameraRef = useRef<{ center: mapboxgl.LngLat; zoom: number } | null>(null);
  // The map's own click listener is registered once, in the mount-only
  // effect below, so it can't close over fresh props on every render - kept
  // up to date via this ref instead (updated by its own effect further
  // down) so a click always sees the latest onMapClick from the parent.
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);
  const onDestinationPickRef = useRef(onDestinationPick);
  useEffect(() => {
    onDestinationPickRef.current = onDestinationPick;
  }, [onDestinationPick]);
  const pickingDestinationRef = useRef(pickingDestination);
  useEffect(() => {
    pickingDestinationRef.current = pickingDestination;
  }, [pickingDestination]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.warn("NEXT_PUBLIC_MAPBOX_TOKEN is not set — map will not render.");
      return;
    }
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12", // trial: richer style with POI icons (was light-v11, the minimal "design spec" style)
      center: [lng, lat],
      zoom,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    // Shared by both click branches below (main pin and destination pin) -
    // resolves whatever labelled map feature (if any) sits at/near a click,
    // so either pin can snap to "the coffee shop" itself rather than just
    // the raw pixel the cursor happened to land on. Previously this only
    // ran for the destination/second-pin branch; the main pin got no
    // snapping or name resolution at all, which is what this unifies.
    async function resolveClickedFeature(
      e: mapboxgl.MapMouseEvent
    ): Promise<{ point: { lat: number; lng: number }; name: string | null }> {
      const clickPoint = { lat: e.lngLat.lat, lng: e.lngLat.lng };

      // Attempt 1: whatever labelled feature is directly under the click -
      // a POI icon/label, a transit stop, a neighbourhood name. Restricted
      // to `symbol` layers, since that's how Mapbox styles render every
      // POI/place/transit label - naturally excludes things like the filled
      // research-area polygon or the route line. A small box around the
      // click (not just the single pixel) gives real clicks some hit-test
      // tolerance.
      //
      // Guarded on mapLoadedRef + try/catch: queryRenderedFeatures throws
      // ("Style is not done loading") if called before the style has
      // finished loading, which a click can easily beat on a slow
      // connection or right after navigating in. Before this click handler
      // was unified across both pins, the main/first pin never called this
      // at all, so it was immune - now every click does, which is what
      // turned a rare edge case into "the very first pin doesn't appear
      // anymore" (that first click is exactly the one most likely to land
      // before the style is ready). Falling through to attempt 2 (or the
      // plain click) instead of letting this throw is the actual fix.
      if (mapLoadedRef.current) {
        try {
          const HIT_TOLERANCE_PX = 8;
          const hitBox: [mapboxgl.PointLike, mapboxgl.PointLike] = [
            [e.point.x - HIT_TOLERANCE_PX, e.point.y - HIT_TOLERANCE_PX],
            [e.point.x + HIT_TOLERANCE_PX, e.point.y + HIT_TOLERANCE_PX],
          ];
          const hit = map
            .queryRenderedFeatures(hitBox)
            .find((f) => f.layer?.type === "symbol" && typeof f.properties?.name === "string" && f.properties.name.trim());
          if (hit) {
            const name = (hit.properties?.name as string | undefined) ?? null;
            const point =
              hit.geometry.type === "Point" ? { lat: hit.geometry.coordinates[1], lng: hit.geometry.coordinates[0] } : clickPoint;
            return { point, name };
          }
        } catch {
          // Style genuinely not ready, or the query itself failed for some
          // other reason - fall through to attempt 2 rather than losing the
          // click entirely.
        }
      }

      // Attempt 2 (fallback): reverse-geocode the click. queryRenderedFeatures
      // only sees labels Mapbox's own collision/decluttering logic actually
      // chose to draw at the current zoom - a real POI can exist right at
      // the click point with its label hidden because it overlapped a
      // neighbour, which attempt 1 would miss entirely. Reverse geocoding
      // looks up the underlying place data directly, not the rendered
      // screen, so it isn't subject to that. A reverse geocode always
      // returns *something* even when nothing is truly close, so the match
      // is only accepted within 150m of the actual click - otherwise this
      // falls through to the plain-coordinates case rather than mislabelling
      // the spot with an unrelated, far-off POI.
      try {
        const poi = await reverseGeocodePoi(clickPoint.lat, clickPoint.lng);
        if (poi) {
          const dLat = ((poi.lat - clickPoint.lat) * Math.PI) / 180;
          const dLng = ((poi.lng - clickPoint.lng) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((clickPoint.lat * Math.PI) / 180) * Math.cos((poi.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
          const distanceM = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (distanceM <= 150) {
            return { point: { lat: poi.lat, lng: poi.lng }, name: poi.name };
          }
        }
      } catch {
        // fall through to the plain click below
      }

      return { point: clickPoint, name: null };
    }

    map.on("click", async (e) => {
      // Belt-and-braces fallback: whatever goes wrong inside feature
      // resolution (network hiccup, an unforeseen Mapbox error, etc.), the
      // click itself should never be silently dropped - worst case, the pin
      // just lands on the raw coordinates with no resolved name, exactly
      // like it always did before snap-to-label existed.
      const clickPoint = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      const { point, name } = await resolveClickedFeature(e).catch(() => ({ point: clickPoint, name: null }));
      if (!pickingDestinationRef.current) {
        onMapClickRef.current(point, name);
      } else {
        onDestinationPickRef.current?.(point, name);
      }
    });

    // Streets gives us the POI icons/labels the minimal Light style lacked,
    // but its default colours are more saturated than fits the "elegant,
    // book cover" tone. Rather than hand-recolouring every layer (a Mapbox
    // Studio job), desaturating the rendered canvas itself gets a pastel
    // look while keeping all the same detail. Applied to the canvas
    // specifically (not the container) so the zoom control buttons aren't
    // affected.
    map.getCanvas().style.filter = "saturate(0.45) brightness(1.08) contrast(0.95)";
    // Pointer (hand) cursor everywhere on the map, not Mapbox's default
    // grab/drag cursor - clicking the map is always a meaningful action
    // here (drop a pin, or pick a directions target), so it should read as
    // clickable the same way the place-name buttons in PinPanel do, rather
    // than implying it's just a pannable surface.
    map.getCanvas().style.cursor = "pointer";

    map.on("load", () => {
      mapLoadedRef.current = true;
      // Start with an empty source rather than the fallback circle — the
      // boundary effect below fills it in as soon as it knows the real
      // shape (or, failing that, the circle). Pre-drawing the circle here
      // caused a visible flash of the old small circle before the real
      // boundary (or a correctly-sized fallback) replaced it.
      map.addSource(AREA_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${AREA_SOURCE_ID}-fill`,
        type: "fill",
        source: AREA_SOURCE_ID,
        paint: { "fill-color": "#E3B27A", "fill-opacity": 0.22 },
      });
      // A wider, semi-transparent white line underneath the main border acts
      // as a halo so the border reads clearly against the Streets style's
      // busy, colourful basemap (it barely showed up at the old thin/light
      // settings tuned for the plainer Light style).
      map.addLayer({
        id: `${AREA_SOURCE_ID}-line-halo`,
        type: "line",
        source: AREA_SOURCE_ID,
        paint: { "line-color": "#FFFFFF", "line-width": 5, "line-opacity": 0.7 },
      });
      map.addLayer({
        id: `${AREA_SOURCE_ID}-line`,
        type: "line",
        source: AREA_SOURCE_ID,
        paint: { "line-color": "#96600F", "line-width": 3, "line-opacity": 0.95 },
      });

      // Directions route line - empty until both a main pin and a
      // destination pin exist (see the route effect below).
      map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${ROUTE_SOURCE_ID}-line`,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#BA7517", "line-width": 4, "line-opacity": 0.85 },
      });
    });

    // Mapbox sizes its internal canvas from the container's dimensions at
    // init time and doesn't notice later layout changes on its own — e.g.
    // the bottom score panel growing once data loads, or the container
    // shrinking to half-width when pin mode opens. Without this, the map
    // renders off-centre / cropped relative to its actual visible area.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    mapRef.current = map;

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recentre and redraw the researched-area outline whenever the searched
  // place changes. Prefers the place's real boundary (Nominatim); falls
  // back to a fixed-radius circle if no boundary was found.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    function applyFallbackCircle() {
      if (!map || cancelled) return;
      const source = map.getSource(AREA_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      source?.setData(circlePolygon(lat, lng, FALLBACK_RADIUS_KM) as any);
      // Shift the point of interest right on screen (rather than dead
      // centre) so it isn't sitting behind the floating left column. Biased
      // toward the column's *expanded* width (620px), not just its 320px
      // collapsed width, so opening a section never has to re-centre the
      // map underneath it — the researched area already sits clear of
      // where the panel will grow into. Nudged a little further right still
      // on top of that, on request.
      map.flyTo({ center: [lng, lat], zoom, offset: [325, 0] });
    }

    async function applyBoundary() {
      try {
        const res = await fetch(`/api/explore/boundary?q=${encodeURIComponent(boundaryQuery)}`);
        const body: { geometry: GeoJSON.Geometry | null; bbox: PlaceBoundary["bbox"] | null } = await res.json();
        if (cancelled || !map) return;

        if (!body.geometry || !body.bbox) {
          applyFallbackCircle();
          return;
        }

        const source = map.getSource(AREA_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        source?.setData({ type: "Feature", geometry: body.geometry, properties: {} } as any);

        const [west, south, east, north] = body.bbox;
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          // Asymmetric padding — extra room on the left accounts for the
          // floating column, so the researched area gets fitted into the
          // space actually visible to the right of it, rather than centred
          // under it. Sized to the column's *expanded* width (620px + 16px
          // inset + a little breathing room), not just its 320px collapsed
          // width, so expanding a section never needs its own re-centre.
          // Nudged a little further still on request.
          { padding: { top: 60, bottom: 60, left: 700, right: 60 }, duration: 800 }
        );
      } catch {
        applyFallbackCircle();
      }
    }

    if (mapLoadedRef.current) {
      applyBoundary();
    } else {
      map.once("load", applyBoundary);
    }

    return () => {
      cancelled = true;
    };
  }, [lat, lng, zoom, boundaryQuery]);

  // Show/hide the dropped pin marker — persists correctly now that MapView
  // is never remounted when pin mode toggles. Also zooms in on the pinned
  // spot so its immediate surroundings are visible, then flies back to the
  // view from just before the pin was dropped once it's closed again.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    if (pinnedCoords) {
      const marker = new mapboxgl.Marker({ element: createPinElement("#BA7517"), anchor: "bottom" }).setLngLat([
        pinnedCoords.lng,
        pinnedCoords.lat,
      ]);
      // Only show a highlight popup when a label was actually resolved (the
      // click landed on/near a named map feature) - unlike the destination
      // marker, a plain manual pin drop is the normal/common case here and
      // shouldn't get a generic "Second pin"-style fallback label cluttering
      // every ordinary click.
      if (pinnedCoords.label) {
        marker.setPopup(
          new mapboxgl.Popup({ offset: 24, closeButton: false, closeOnClick: false }).setHTML(popupHtml(pinnedCoords.label, ""))
        );
      }
      marker.addTo(map);
      if (pinnedCoords.label) marker.togglePopup();
      markerRef.current = marker;

      if (!preDropCameraRef.current) {
        preDropCameraRef.current = { center: map.getCenter(), zoom: map.getZoom() };
      }
      // Offset shifts the pinned point away from centre on screen: nudged
      // past zero now (was 160, 90, 40, 10) — pulls it slightly left of
      // dead centre rather than just barely right of it.
      map.flyTo({ center: [pinnedCoords.lng, pinnedCoords.lat], zoom: 13, offset: [-30, -50], duration: 900 });
    } else if (preDropCameraRef.current) {
      const { center, zoom: prevZoom } = preDropCameraRef.current;
      map.flyTo({ center, zoom: prevZoom, duration: 900 });
      preDropCameraRef.current = null;
    }
  }, [pinnedCoords]);

  // Show/hide the destination (second) pin marker, and keep the driving
  // route between it and the main pin up to date on our own map - this
  // replaces the earlier behaviour of opening a Google Maps tab for
  // directions. Recomputes whenever either point moves, so dragging the
  // main pin around keeps the route (and its distance/time) current rather
  // than requiring the destination to be re-picked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
    if (destinationCoords) {
      // A permanently-open popup naming the selected place - the visible
      // "highlight" confirming what got picked as the second pin, whether
      // it came from clicking a KPI place name in PinPanel or from a map
      // click that snapped to a labelled feature. Without this, a plain
      // marker on the map gave no obvious confirmation of *what* had just
      // been selected.
      destMarkerRef.current = new mapboxgl.Marker({ element: createPinElement("#3B6E8F"), anchor: "bottom" })
        .setLngLat([destinationCoords.lng, destinationCoords.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 24, closeButton: false, closeOnClick: false }).setHTML(
            popupHtml(destinationCoords.label, "Second pin")
          )
        )
        .addTo(map)
        .togglePopup();
    }

    let cancelled = false;

    function clearRoute() {
      const source = map?.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: [] } as any);
      onRouteInfo?.(null);
    }

    async function updateRoute() {
      if (!map) return;
      if (!pinnedCoords || !destinationCoords) {
        clearRoute();
        // Only fly back if a route was actually showing a moment ago (i.e.
        // this is a genuine "Clear" / destination-removed transition, not
        // just the very first pin drop before any destination ever
        // existed) - otherwise this would fight with the pin-focus flyTo
        // the marker effect above already does on first drop.
        if (pinnedCoords && hadRouteRef.current) {
          map.flyTo({ center: [pinnedCoords.lng, pinnedCoords.lat], zoom: 13, offset: [-30, -50], duration: 900 });
        }
        hadRouteRef.current = false;
        return;
      }
      const route = await drivingRoute(pinnedCoords, destinationCoords).catch(() => null);
      if (cancelled || !map) return;
      if (!route) {
        clearRoute();
        hadRouteRef.current = false;
        return;
      }
      const source = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      source?.setData({ type: "Feature", geometry: route.geometry, properties: {} } as any);
      // Car is the primary route (drawn on the map, above) and reported
      // immediately; walking is a duration-only lookup (no second line
      // drawn - would clutter the map for what's just a supplementary
      // figure in PinPanel) fetched alongside it rather than blocking the
      // car time on it. There's no public-transport figure to fetch at all
      // - Mapbox's free Directions API has no transit profile - PinPanel
      // discloses that honestly instead of this pretending to have it.
      onRouteInfo?.({ car: { minutes: route.minutes, km: route.km }, walkingMinutes: null });
      hadRouteRef.current = true;
      travelMinutes(pinnedCoords, destinationCoords, "walking")
        .catch(() => null)
        .then((walkingMinutes) => {
          if (cancelled) return;
          onRouteInfo?.({ car: { minutes: route.minutes, km: route.km }, walkingMinutes });
        });

      // Bug: this used to only extend the bounds to the two endpoints
      // (origin + destination), not the actual route line between them. A
      // real driving route almost never travels in a straight line (it
      // follows roads, goes around obstacles, etc.), so the drawn line
      // could bow outside those two-point bounds entirely and end up
      // clipped off-screen or hidden behind a panel even with generous
      // padding - fitBounds had no idea the route deviated that far.
      // Extending on every coordinate in the route geometry fixes this: the
      // fitted view now always contains the whole visible line, not just
      // its start and end.
      const bounds = new mapboxgl.LngLatBounds();
      for (const coord of route.geometry.coordinates) {
        bounds.extend(coord as [number, number]);
      }
      // Padding clears both floating UI elements the route could otherwise
      // end up hidden behind: left accounts for the fixed 320px+16px left
      // column, bottom adds the PinPanel bar's own live-measured height
      // (reservedBottomPx, from the parent) on top of a base clearance, so
      // it scales with however tall the bar actually is rather than a
      // guessed constant. Math.max floors it in case reservedBottomPx
      // hasn't been measured yet (e.g. right on the first click, before the
      // ResizeObserver has reported back).
      map.fitBounds(bounds, {
        padding: { top: 100, bottom: Math.max(180, 60 + reservedBottomPx), left: 380, right: 80 },
        duration: 800,
        maxZoom: 15,
      });
    }

    if (mapLoadedRef.current) {
      updateRoute();
    } else {
      map.once("load", updateRoute);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedCoords, destinationCoords, reservedBottomPx]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {pickingDestination && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-pill bg-ink-900/80 text-white text-xs px-4 py-2">
          Click the map to place your second pin
        </div>
      )}
      {!pinnedCoords && !pickingDestination && (
        <div className="absolute bottom-4 right-4 rounded-pill bg-ink-900/80 text-white text-xs px-4 py-2">
          Drop a pin for local details
        </div>
      )}
    </div>
  );
}
