"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { driveMinutes, formatDriveTime, ROAD_DETOUR_FACTOR } from "@/lib/dataset/assemble";
import { fetchRoute, googleMapsDirectionsUrl, ROUTE_ATTRIBUTION, WALK_MAX_KM } from "@/lib/routing";
import { formatDistanceKm, useUnitPreferences } from "@/lib/unitPreferences";
import { hasMapPlaces, loadMapPlaces, yesRadiusKm, type MapPlace } from "@/lib/mapPlaces";
import { cn } from "@/lib/cn";
import { CloseIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { addMapIcons, mapIconColor, mapIconId } from "@/components/explore/mapIcons";
import { MapCredit } from "@/components/explore/MapCredit";
import type { MapKind } from "@/lib/kpiRows";
import type { TravelTimes } from "@/lib/types";

/** OpenFreeMap: free OpenStreetMap vector tiles, no API key, no usage
 *  limits (https://openfreemap.org). "liberty" is the richer style with POI
 *  icons. */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Directions are estimates from the straight-line distance - there's no
 *  routing engine by design (no live API calls): by car via driveMinutes,
 *  walking at 5 km/h, both on roads ~30% longer than the straight line. */
const WALK_KMH = 5;

function straightLineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** A place one of the city's figures is about ("Nearest beach: Plage X"):
 *  marked on the map with a dashed line from the city centre, framed, and
 *  described in a small card. No `point` when none was found nearby (the
 *  card says so). */
export interface MapFocus {
  title: string;
  /** What kind of place - its icon, and for a Yes, which places to find. */
  kind: MapKind;
  /** Where - one place (a distance), or several (a Yes: the dataset's
   *  nearest 6, nearest first - the map adds every other one it knows,
   *  lib/mapPlaces.ts); none if none was found. */
  points: { lng: number; lat: number; name: string }[];
  /** Both: the kind's icon where it is, named. "journey" adds the dashed
   *  line from the centre (a distance figure - the figure itself already
   *  says how far, so there's no card, 2026-10-14, on request). */
  style: "journey" | "pin";
}

type FocusPoint = { lng: number; lat: number; name: string };

/** A Yes's places: every one the map's tiles hold, plus the dataset's own
 *  (Overture / GeoNames) where the tiles have nothing within 150 m - so the
 *  places behind the figure always show - nearest first. */
function mergePlaces(center: { lat: number; lng: number }, dataset: FocusPoint[], tiles: MapPlace[]): FocusPoint[] {
  const extra = dataset
    .filter((p) => !tiles.some((t) => straightLineKm(t, p) < 0.15))
    .map((p) => ({ ...p, km: straightLineKm(center, p) }));
  return [...tiles, ...extra].sort((a, b) => a.km - b.km);
}

/** A figure's places on the map, in its kind's icon and colour, ranked
 *  nearest first (which icons win where they'd overlap). */
function drawFocusPoints(map: maplibregl.Map, focus: MapFocus | null, points: FocusPoint[]): void {
  (map.getSource(FOCUS_POINTS_ID) as maplibregl.GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: focus
      ? points.map((p, rank) => ({
          type: "Feature",
          properties: { name: p.name, rank, icon: mapIconId(focus.kind), color: mapIconColor(focus.kind) },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        }))
      : [],
  } as any);
}

/** The chip's count for a Yes: every place within its radius once the
 *  map's tiles have been read, or the dataset's own nearest few. */
function yesCount(focus: MapFocus, tilePlaces: { places: MapPlace[]; done: boolean } | null, center: { lat: number; lng: number }): string {
  if (tilePlaces && !tilePlaces.done) return "finding them all…";
  if (tilePlaces?.places.length) {
    const n = mergePlaces(center, focus.points, tilePlaces.places).length;
    return `${n.toLocaleString("en-US")} within ${yesRadiusKm(focus.kind as Exclude<MapKind, "capital">)} km`;
  }
  const n = focus.points.length;
  return n === 6 ? "6 nearest" : n > 1 ? `${n} places` : "";
}

interface MapViewProps {
  lat: number;
  lng: number;
  zoom?: number;
  /** The city's outline: drawn and framed when present; null = the dataset
   *  has none, so the 5 km circle is drawn instead; undefined = still
   *  loading (nothing drawn yet, so the circle never flashes first). */
  outline?: GeoJSON.MultiPolygon | null;
  /** A click on the map while NOT in pickingDestination mode - drops/moves
   *  the main pin. Like onDestinationPick below, `name` carries a nearby
   *  labelled map feature's name (POI, transit stop, neighbourhood) when
   *  the click landed on or near one, so the very first pin gets the same
   *  "snap to what you actually clicked, and show what it is" treatment as
   *  the second one - not just raw coordinates with no confirmation of
   *  what's there. Omit it for a view-only map (no pins, no pin hint). */
  onMapClick?: (coords: { lat: number; lng: number }, name: string | null) => void;
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
  /** True on the results page's mobile layout, where the score column and
   *  pin panel sit in normal document flow below the map instead of
   *  floating on top of it — every padding/offset below tuned to dodge that
   *  floating desktop column (fitBounds' large left padding, the
   *  camera's [-30,-50]/[325,0] offsets) would just waste space or push the
   *  view off-centre on a map that has nothing floating over it. Compact
   *  mode uses small, symmetric padding instead. */
  compact?: boolean;
  focus?: MapFocus | null;
  onCloseFocus?: () => void;
  /** Whether the map fills the screen (the expand button's state), and the
   *  button's action; no button without it. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

const FOCUS_SOURCE_ID = "piltri-focus";
/** A figure's places: a small dot for every one, and the kind's icon with
 *  its name where there's room - the map hides icons that would overlap,
 *  nearest first, and shows more as you zoom in. */
const FOCUS_POINTS_ID = "piltri-focus-points";
/** A distance figure's journey along the roads (lib/routing.ts), once it
 *  has come back - the straight line stands in until then. */
const FOCUS_ROUTE_ID = "piltri-focus-route";
const AREA_SOURCE_ID = "piltri-research-area";
/** Everything outside the place, gently veiled so the place stands out. */
const MASK_SOURCE_ID = "piltri-area-mask";

/** The world with the place cut out of it (each part's outer ring a hole). */
function outsideOf(area: GeoJSON.Feature): GeoJSON.Feature {
  const g = area.geometry;
  const parts = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...parts.map((rings) => rings[0])] } };
}
const ROUTE_SOURCE_ID = "piltri-route";
// Fallback area when a city has no outline: the same 5 km radius the
// dataset counts amenities in (pipeline/build.ts LOCAL_RADIUS_KM).
const AREA_RADIUS_KM = 5;

/** Custom marker element for the main dropped pin - white teardrop body with
 *  an amber outline and a small amber dot in the centre, the reverse of the
 *  old solid-amber default Marker (which only supports a single flat fill
 *  colour via its `color` option, not a two-tone design like this). A fresh
 *  element is needed per Marker instance since the map library takes ownership of
 *  whatever element it's given. `anchor: "bottom"` on the Marker (set where
 *  this is used) makes the tip of the teardrop - not its centre - the point
 *  that lands on the actual coordinate. */
/** White teardrop body, coloured outline + centre dot - the shared pin
 *  design used for both the main pin (amber, #BA7517) and the second/
 *  destination pin (blue, #3B6E8F), so picking a second pin reads as "the
 *  same kind of thing, different colour" rather than a completely different
 *  marker style. A fresh element is needed per Marker instance since the map
 *  library
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
 *  comes from map feature properties (external data),
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
 * MapLibre map (OpenFreeMap tiles). Sits behind the score panel / pin panel;
 * clicking anywhere on it drops a pin and triggers pin mode.
 *
 * Rendered exactly once by the parent (never remounted when toggling pin
 * mode) — the parent only changes this component's *container* width via
 * CSS, and the ResizeObserver below handles telling the map to resize and
 * recentre itself. Remounting on every pin toggle was the earlier cause of
 * the dropped-pin marker seeming to disappear and the map view resetting.
 */
export function MapView({
  lat,
  lng,
  zoom = 10,
  outline,
  onMapClick,
  pinnedCoords,
  destinationCoords,
  pickingDestination = false,
  onDestinationPick,
  onRouteInfo,
  reservedBottomPx = 0,
  compact = false,
  focus = null,
  onCloseFocus,
  expanded = false,
  onToggleExpanded,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Whether a route was actually drawn on the last pass through the route
  // effect below - lets it tell "destination just got cleared" apart from
  // "no destination has ever been set yet" so it only flies back to the pin
  // focus in the former case.
  const hadRouteRef = useRef(false);
  const mapLoadedRef = useRef(false);
  // The searched place's framing, to come back to once a figure's place
  // (focus) is closed.
  const areaBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const focusRef = useRef<MapFocus | null>(focus);
  // A Yes's places from the map's tiles, as they arrive (null: none being
  // looked for - a distance, or a kind the tiles don't hold).
  const [tilePlaces, setTilePlaces] = useState<{ places: MapPlace[]; done: boolean } | null>(null);
  // The same, with the focus they're for - read by the focus effect, which
  // redraws when the map changes size.
  const tilePlacesRef = useRef<{ focus: MapFocus; places: MapPlace[] } | null>(null);
  // The journey along the roads for a distance figure: its bounds (framed
  // with the place), the chip's "35 km · 35 min by car", and which focus
  // it's for (a reply for an earlier tap is dropped).
  const routeBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const routeTokenRef = useRef(0);
  const [routeInfo, setRouteInfo] = useState<string | null>(null);
  const { prefs } = useUnitPreferences();
  // Asymmetric padding keeps what's framed clear of the floating left
  // column and the section panel beside it (at their open widths, but never
  // more than the map can spare); compact (mobile) layout has nothing
  // floating over the map, so it uses small symmetric padding.
  // extraRight: room for a flag's name, which sits to its right.
  const framePadding = (map: maplibregl.Map, extraTop = 0, extraRight = 0): maplibregl.PaddingOptions => {
    if (compact) return { top: 40 + extraTop, bottom: 40, left: 40, right: 40 + extraRight };
    const left = Math.max(60, Math.min(780, map.getContainer().clientWidth - 420));
    return { top: 60 + extraTop, bottom: 60, left, right: 60 + extraRight };
  };
  /** A Yes (MapFocus style "pin") in one view: the circle its places are
   *  counted in, where the map shows them all - not the whole outline,
   *  which for London is 40 km across (2026-10-28) - widened for any of
   *  the dataset's places outside it. */
  const yesView = (focused: MapFocus) => {
    const circle = (circlePolygon(lat, lng, focused.kind === "capital" ? AREA_RADIUS_KM : yesRadiusKm(focused.kind)).geometry as GeoJSON.Polygon).coordinates[0];
    const bounds = new maplibregl.LngLatBounds();
    for (const c of circle) bounds.extend(c as [number, number]);
    for (const p of focused.points) bounds.extend([p.lng, p.lat]);
    return bounds;
  };
  /** Room on the right for the labels: less on a phone, where the map
   *  hides those that don't fit. */
  const FLAG_LABEL_PX = compact ? 40 : 110;
  // Camera position from just before a pin was dropped, so closing the pin
  // can fly back to the same view rather than staying zoomed in on it.
  const preDropCameraRef = useRef<{ center: maplibregl.LngLat; zoom: number } | null>(null);
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

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [lng, lat],
      zoom,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // The credit OpenStreetMap's licence asks for is a line in the corner
    // (MapCredit, below) rather than MapLibre's control.

    // Shared by both click branches below (main pin and destination pin) -
    // resolves whatever labelled map feature (if any) sits at/near a click,
    // so either pin can snap to "the coffee shop" itself rather than just
    // the raw pixel the cursor happened to land on. Previously this only
    // ran for the destination/second-pin branch; the main pin got no
    // snapping or name resolution at all, which is what this unifies.
    async function resolveClickedFeature(
      e: maplibregl.MapMouseEvent
    ): Promise<{ point: { lat: number; lng: number }; name: string | null }> {
      const clickPoint = { lat: e.lngLat.lat, lng: e.lngLat.lng };

      // Attempt 1: whatever labelled feature is directly under the click -
      // a POI icon/label, a transit stop, a neighbourhood name. Restricted
      // to `symbol` layers, since that's how vector map styles render every
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
          const hitBox: [maplibregl.PointLike, maplibregl.PointLike] = [
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

      // A click that doesn't land on a rendered label just keeps its raw
      // coordinates, and PinPanel names the spot from the nearest town.
      return { point: clickPoint, name: null };
    }

    map.on("click", async (e) => {
      if (!onMapClickRef.current && !pickingDestinationRef.current) return; // view-only map
      // Belt-and-braces fallback: whatever goes wrong inside feature
      // resolution (network hiccup, an unforeseen map error, etc.), the
      // click itself should never be silently dropped - worst case, the pin
      // just lands on the raw coordinates with no resolved name, exactly
      // like it always did before snap-to-label existed.
      const clickPoint = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      const { point, name } = await resolveClickedFeature(e).catch(() => ({ point: clickPoint, name: null }));
      if (!pickingDestinationRef.current) {
        onMapClickRef.current?.(point, name);
      } else {
        onDestinationPickRef.current?.(point, name);
      }
    });

    // The "liberty" style's colours are more saturated than fits the
    // "elegant, book cover" tone. Rather than hand-recolouring every layer,
    // desaturating the rendered canvas itself gets a pastel
    // look while keeping all the same detail. Applied to the canvas
    // specifically (not the container) so the zoom control buttons aren't
    // affected.
    map.getCanvas().style.filter = "saturate(0.45) brightness(1.08) contrast(0.95)";
    // Pointer (hand) cursor everywhere on the map, not the map's default
    // grab/drag cursor - clicking the map is always a meaningful action
    // here (drop a pin, or pick a directions target), so it should read as
    // clickable the same way the place-name buttons in PinPanel do, rather
    // than implying it's just a pannable surface. (A view-only map keeps
    // the default drag cursor.)
    if (onMapClick) map.getCanvas().style.cursor = "pointer";

    map.on("load", () => {
      mapLoadedRef.current = true;
      // Start with an empty source rather than the fallback circle — the
      // boundary effect below fills it in as soon as it knows the real
      // shape (or, failing that, the circle). Pre-drawing the circle here
      // caused a visible flash of the old small circle before the real
      // boundary (or a correctly-sized fallback) replaced it.
      // Every outline drawn alike (2026-10-14, on request) - an official
      // boundary, a built-up area or the 5 km circle: the world outside
      // gently veiled, a whisper of amber inside, and a crisp amber line on
      // a soft white casing that reads on any part of the map.
      map.addSource(MASK_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${MASK_SOURCE_ID}-fill`,
        type: "fill",
        source: MASK_SOURCE_ID,
        paint: { "fill-color": "#FAF7F2", "fill-opacity": 0.45 },
      });
      map.addSource(AREA_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${AREA_SOURCE_ID}-fill`,
        type: "fill",
        source: AREA_SOURCE_ID,
        paint: { "fill-color": "#E3B27A", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: `${AREA_SOURCE_ID}-line-halo`,
        type: "line",
        source: AREA_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#FFFFFF", "line-width": 6, "line-opacity": 0.85, "line-blur": 1 },
      });
      map.addLayer({
        id: `${AREA_SOURCE_ID}-line`,
        type: "line",
        source: AREA_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#96600F", "line-width": 2.25, "line-opacity": 1 },
      });

      // The line from the centre to a distance figure's place ("nearest
      // beach") - empty until one is shown (see the focus effect below);
      // the place itself is a flag marker.
      map.addSource(FOCUS_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${FOCUS_SOURCE_ID}-line`,
        type: "line",
        source: FOCUS_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round" },
        paint: { "line-color": "#1E1A16", "line-width": 2.5, "line-opacity": 0.75, "line-dasharray": [1.5, 1.5] },
      });
      map.addSource(FOCUS_ROUTE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: ROUTE_ATTRIBUTION });
      map.addLayer({
        id: `${FOCUS_ROUTE_ID}-casing`,
        type: "line",
        source: FOCUS_ROUTE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FFFFFF", "line-width": 7, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: FOCUS_ROUTE_ID,
        type: "line",
        source: FOCUS_ROUTE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        // Blue, so the journey never reads as part of the amber outline.
        paint: { "line-color": "#3B6E8F", "line-width": 3.5 },
      });
      // A figure's places: a dot for every one, and its icon and name
      // where they fit (nearest first).
      addMapIcons(map);
      map.addSource(FOCUS_POINTS_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${FOCUS_POINTS_ID}-dots`,
        type: "circle",
        source: FOCUS_POINTS_ID,
        paint: {
          "circle-radius": 4,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#FFFFFF",
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: `${FOCUS_POINTS_ID}-icons`,
        type: "symbol",
        source: FOCUS_POINTS_ID,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-padding": 1,
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11.5,
          "text-anchor": "left",
          "text-offset": [1.45, 0],
          "text-max-width": 12,
          "text-optional": true,
          "symbol-sort-key": ["get", "rank"],
        },
        paint: { "text-color": "#1E1A16", "text-halo-color": "#FFFFFF", "text-halo-width": 1.6, "text-halo-blur": 0.4 },
      });

      // Directions route line - empty until both a main pin and a
      // destination pin exist (see the route effect below).
      map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${ROUTE_SOURCE_ID}-line`,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#BA7517", "line-width": 3, "line-opacity": 0.85, "line-dasharray": [2, 1.5] },
      });
    });

    // MapLibre sizes its internal canvas from the container's dimensions at
    // init time and doesn't notice later layout changes on its own — e.g.
    // the bottom score panel growing once data loads, or the container
    // shrinking to half-width when pin mode opens. Without this, the map
    // renders off-centre / cropped relative to its actual visible area.
    //
    // Debounced (2026-09-23, on request - fixing a genuine jank bug) rather
    // than calling map.resize() on every single firing: the results page's
    // mobile map height now animates via a CSS transition (opening/closing
    // a section), and ResizeObserver fires on essentially every frame of
    // that transition - each firing was triggering a full, synchronous
    // map resize (WebGL canvas resize + repaint), competing with the CSS
    // transition's own rendering for the main thread and producing the
    // stuttery "small movements" the animation was reported to have. Since
    // nothing needs the map's canvas to track the container's size on every
    // intermediate frame - only once the size has actually settled - this
    // waits until resize events stop arriving for a beat (comfortably past
    // the 300ms CSS transition) before doing the one resize that matters.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => map.resize(), 350);
    });
    resizeObserver.observe(containerRef.current);

    mapRef.current = map;

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new place: the camera saved before a pin was dropped belongs to the
  // previous place - forget it, or clearing that pin (which happens when the
  // page switches place) would fly back there.
  useEffect(() => {
    preDropCameraRef.current = null;
  }, [lat, lng]);

  // Draw and frame the searched place: its real outline, or the 5 km circle
  // when the dataset has none. Nothing is drawn while the outline is still
  // loading (a few KB, cached), so the circle never flashes up first.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    function applyArea() {
      if (!map || cancelled) return;
      const source = map.getSource(AREA_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      const mask = map.getSource(MASK_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (outline === undefined) {
        source?.setData({ type: "FeatureCollection", features: [] });
        mask?.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      const area: GeoJSON.Feature = outline
        ? { type: "Feature", geometry: outline, properties: {} }
        : circlePolygon(lat, lng, AREA_RADIUS_KM);
      source?.setData(area as any);
      mask?.setData(outsideOf(area) as any);
      const bounds = new maplibregl.LngLatBounds();
      const rings = area.geometry.type === "MultiPolygon" ? area.geometry.coordinates.flat() : (area.geometry as GeoJSON.Polygon).coordinates;
      for (const ring of rings) for (const coord of ring) bounds.extend(coord as [number, number]);
      areaBoundsRef.current = bounds;
      // A figure's place being shown takes the framing (see below) - a
      // flag's together with the place, now that its outline is here.
      const focused = focusRef.current;
      if (focused?.points.length) {
        if (focused.style === "pin") map.fitBounds(yesView(focused), { padding: framePadding(map, compact ? 50 : 0, FLAG_LABEL_PX), duration: 800 });
        return;
      }
      map.fitBounds(bounds, { padding: framePadding(map), duration: 800 });
    }

    if (mapLoadedRef.current) {
      applyArea();
    } else {
      map.once("load", applyArea);
    }

    return () => {
      cancelled = true;
    };
  }, [lat, lng, zoom, compact, outline]);

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
      const marker = new maplibregl.Marker({ element: createPinElement("#BA7517"), anchor: "bottom" }).setLngLat([
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
          new maplibregl.Popup({ offset: 24, closeButton: false, closeOnClick: false }).setHTML(popupHtml(pinnedCoords.label, ""))
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
      // dead centre rather than just barely right of it. Compact mode has
      // no floating column to dodge, so it centres the pin normally.
      map.flyTo({ center: [pinnedCoords.lng, pinnedCoords.lat], zoom: 13, offset: compact ? [0, 0] : [-30, -50], duration: 900 });
    } else if (preDropCameraRef.current) {
      const { center, zoom: prevZoom } = preDropCameraRef.current;
      map.flyTo({ center, zoom: prevZoom, duration: 900 });
      preDropCameraRef.current = null;
    }
  }, [pinnedCoords, compact]);

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
      destMarkerRef.current = new maplibregl.Marker({ element: createPinElement("#3B6E8F"), anchor: "bottom" })
        .setLngLat([destinationCoords.lng, destinationCoords.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 24, closeButton: false, closeOnClick: false }).setHTML(
            popupHtml(destinationCoords.label, "Second pin")
          )
        )
        .addTo(map)
        .togglePopup();
    }

    let cancelled = false;

    function clearRoute() {
      const source = map?.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
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
          map.flyTo({ center: [pinnedCoords.lng, pinnedCoords.lat], zoom: 13, offset: compact ? [0, 0] : [-30, -50], duration: 900 });
        }
        hadRouteRef.current = false;
        return;
      }
      if (cancelled || !map) return;
      // Straight dashed line + estimated times (no routing engine - see
      // WALK_KMH's comment); PinPanel labels these as estimates.
      const coordinates: [number, number][] = [
        [pinnedCoords.lng, pinnedCoords.lat],
        [destinationCoords.lng, destinationCoords.lat],
      ];
      const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} } as any);
      const straightKm = straightLineKm(pinnedCoords, destinationCoords);
      const roadKm = straightKm * ROAD_DETOUR_FACTOR;
      onRouteInfo?.({
        car: { minutes: driveMinutes(straightKm) ?? 1, km: Number(roadKm.toFixed(1)) },
        walkingMinutes: Math.max(1, Math.round((roadKm / WALK_KMH) * 60)),
      });
      hadRouteRef.current = true;

      const bounds = new maplibregl.LngLatBounds();
      for (const coord of coordinates) bounds.extend(coord);
      // Padding clears both floating UI elements the route could otherwise
      // end up hidden behind: left accounts for the fixed 320px+16px left
      // column, bottom adds the PinPanel bar's own live-measured height
      // (reservedBottomPx, from the parent) on top of a base clearance, so
      // it scales with however tall the bar actually is rather than a
      // guessed constant. Math.max floors it in case reservedBottomPx
      // hasn't been measured yet (e.g. right on the first click, before the
      // ResizeObserver has reported back).
      map.fitBounds(bounds, compact
        ? { padding: { top: 40, bottom: Math.max(40, 40 + reservedBottomPx), left: 40, right: 40 }, duration: 800, maxZoom: 15 }
        : { padding: { top: 100, bottom: Math.max(180, 60 + reservedBottomPx), left: 380, right: 80 }, duration: 800, maxZoom: 15 }
      );
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
  }, [pinnedCoords, destinationCoords, reservedBottomPx, compact]);

  // A Yes: look for every place of its kind in the map's tiles (lib/
  // mapPlaces.ts) - the dataset's own nearest 6 show meanwhile, and stay
  // where the tiles have nothing near them.
  useEffect(() => {
    setTilePlaces(null);
    if (!focus || focus.style !== "pin" || focus.kind === "capital" || !hasMapPlaces(focus.kind)) return;
    const controller = new AbortController();
    loadMapPlaces(focus.kind, { lat, lng }, controller.signal, (places, done) => {
      tilePlacesRef.current = { focus, places };
      setTilePlaces({ places, done });
    }).catch(() => {});
    return () => controller.abort();
  }, [focus, lat, lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || !focus || !tilePlaces) return;
    drawFocusPoints(map, focus, mergePlaces({ lat, lng }, focus.points, tilePlaces.places));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilePlaces]);

  // Show (or clear) a figure's place: the point, a dashed line from the
  // centre, framed together - back to the place's own framing when closed.
  useEffect(() => {
    focusRef.current = focus;
    const map = mapRef.current;
    if (!map) return;
    // Frames whatever is current when it runs - also after the map has
    // resized (on phones it goes full screen for a figure's place, and a
    // framing done at the small size would be off-centre).
    const frame = (duration = 800) => {
      const points = focusRef.current?.points ?? [];
      const current = points[0];
      if (current && focusRef.current?.style === "pin") {
        map.fitBounds(yesView(focusRef.current), { padding: framePadding(map, compact ? 50 : 0, FLAG_LABEL_PX), duration });
      } else if (current) {
        const bounds = new maplibregl.LngLatBounds([lng, lat], [lng, lat]).extend([current.lng, current.lat]);
        if (routeBoundsRef.current) bounds.extend(routeBoundsRef.current);
        // Room for the chip above and the flag's name beside it.
        map.fitBounds(bounds, { padding: framePadding(map, compact ? 50 : 20, FLAG_LABEL_PX), maxZoom: 15, duration });
      } else if (areaBoundsRef.current) {
        map.fitBounds(areaBoundsRef.current, { padding: framePadding(map), duration });
      }
    };
    const apply = () => {
      const source = map.getSource(FOCUS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      const point = focus?.points[0];
      // Redrawn when the map changes size too: with every place the tiles
      // gave, once they're in.
      const tiles = tilePlacesRef.current?.focus === focus ? tilePlacesRef.current.places : null;
      drawFocusPoints(map, focus, focus && tiles ? mergePlaces({ lat, lng }, focus.points, tiles) : focus?.points ?? []);
      source.setData({
        type: "FeatureCollection",
        features: point && focus?.style === "journey"
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[lng, lat], [point.lng, point.lat]] } }]
          : [],
      } as any);
      // The road journey replaces the straight line once it's back (on
      // foot for a short one); if the server can't answer, the line stays.
      const routeSource = map.getSource(FOCUS_ROUTE_ID) as maplibregl.GeoJSONSource | undefined;
      const token = ++routeTokenRef.current;
      routeBoundsRef.current = null;
      routeSource?.setData({ type: "FeatureCollection", features: [] });
      setRouteInfo(null);
      if (point && focus?.style === "journey") {
        const mode = straightLineKm({ lat, lng }, point) <= WALK_MAX_KM ? "foot" : "car";
        fetchRoute({ lng, lat }, point, mode).then((route) => {
          if (!route || token !== routeTokenRef.current) return;
          source.setData({ type: "FeatureCollection", features: [] });
          routeSource?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.coordinates } } as any);
          const bounds = new maplibregl.LngLatBounds();
          for (const c of route.coordinates) bounds.extend(c);
          routeBoundsRef.current = bounds;
          setRouteInfo(`${formatDistanceKm(route.km, prefs)} · ${formatDriveTime(Math.max(1, Math.round(route.minutes)))} ${mode === "foot" ? "on foot" : "by car"}`);
          frame();
        });
      }
      frame();
      // Straight to the new framing once it has (the map has just appeared).
      if (compact) map.once("resize", () => frame(0));
      // Shown before the map had loaded: once it has fully drawn, frame
      // again - the outline may have arrived, or the size settled, since.
      if (late) map.once("idle", () => frame(0));
    };
    const late = !mapLoadedRef.current;
    if (mapLoadedRef.current) apply();
    else map.once("load", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, lat, lng, compact]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {focus && (
        // What's shown (the flag carries its name), the way to close it -
        // and for a journey, the same one in Google Maps in a new tab.
        <div className={cn("absolute z-10 rounded-2xl bg-surface shadow-card pl-3 pr-1 py-1", compact ? "top-3 left-3 max-w-[calc(100%-4.5rem)]" : "top-4 right-14 max-w-sm")}>
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-ink-900">
              {focus.title}
              {focus.style === "pin" && yesCount(focus, tilePlaces, { lat, lng }) && (
                <span className="font-normal text-ink-500"> · {yesCount(focus, tilePlaces, { lat, lng })}</span>
              )}
              {!focus.points.length && !tilePlaces?.places.length && (
                <span className="font-normal text-ink-500"> · none found nearby</span>
              )}
              {routeInfo && <span className="font-normal text-ink-500"> · {routeInfo}</span>}
            </span>
            <button type="button" aria-label="Close" onClick={onCloseFocus} className="ml-auto p-1 rounded-full text-ink-500 hover:text-ink-900 flex-shrink-0">
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          </div>
          {focus.style === "journey" && focus.points[0] && (
            <a
              href={googleMapsDirectionsUrl(
                { lat, lng },
                focus.points[0],
                straightLineKm({ lat, lng }, focus.points[0]) <= WALK_MAX_KM ? "foot" : "car"
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 pb-1 pr-2 text-[11px] font-medium text-piltri-amber-dark hover:underline underline-offset-2"
            >
              Open in Google Maps
              <ExternalLinkIcon className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
      {pickingDestination && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-pill bg-ink-900/80 text-white text-xs px-4 py-2">
          Click the map to place your second pin
        </div>
      )}
      {onMapClick && !pinnedCoords && !pickingDestination && (
        <div className="absolute bottom-6 right-4 rounded-pill bg-ink-900/80 text-white text-xs px-4 py-2">
          Drop a pin for local details
        </div>
      )}
      {onToggleExpanded && (
        // Under the zoom buttons, in their style.
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? "Make the map smaller" : "Expand the map"}
          title={expanded ? "Make the map smaller" : "Expand the map"}
          className="absolute right-[10px] top-[76px] z-10 flex h-[29px] w-[29px] items-center justify-center rounded bg-white text-ink-900 shadow-[0_0_0_2px_rgba(0,0,0,0.1)] hover:bg-surface-muted"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {expanded ? (
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            ) : (
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            )}
          </svg>
        </button>
      )}
      <MapCredit routes={!!routeInfo} />
    </div>
  );
}
