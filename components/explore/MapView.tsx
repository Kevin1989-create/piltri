"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AIRPORT_REACH_KM, driveMinutes, formatDriveTime, ROAD_DETOUR_FACTOR } from "@/lib/dataset/assemble";
import { fetchRoute, googleMapsDirectionsUrl, ROUTE_ATTRIBUTION, WALK_MAX_KM } from "@/lib/routing";
import { formatDistanceKm, useUnitPreferences } from "@/lib/unitPreferences";
import { hasMapPlaces, loadMapPlaces, MAP_LAYER_KINDS, osmPoiFilter, yesRadiusKm, type MapPlace } from "@/lib/mapPlaces";
import { cn } from "@/lib/cn";
import { CloseIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { addMapIcons, mapIconColor, mapIconId, mapIconUrl } from "@/components/explore/mapIcons";
import { muteBasemap, muteColor } from "@/lib/mapColors";
import { INSIDE_KINDS, type InsideKind, type NearbyKind } from "@/lib/dataset/schema";
import { MapCredit } from "@/components/explore/MapCredit";
import { airportsByReach, type MapKind } from "@/lib/kpiRows";
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
  /** A Yes's points are every place it counts (in the city or within 1 km
   *  of it, 2026-10-29): the map shows those, framed with the city, and
   *  reads nothing from its tiles. */
  complete?: boolean;
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
          properties: { name: p.name, rank, kind: focus.kind, icon: mapIconId(focus.kind) },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        }))
      : [],
  } as any);
}

/** The chip's count for a Yes: every place within its radius once the
 *  map's tiles have been read, or the dataset's own nearest few. */
function yesCount(focus: MapFocus, tilePlaces: { places: MapPlace[]; done: boolean } | null, center: { lat: number; lng: number }): string {
  if (focus.complete) return `${focus.points.length.toLocaleString("en-US")} ${airportsByReach(focus.kind) ? `within ${AIRPORT_REACH_KM} km` : "in the city"}`;
  if (tilePlaces && !tilePlaces.done) return "finding them all…";
  if (tilePlaces?.places.length) {
    const n = mergePlaces(center, focus.points, tilePlaces.places).length;
    return `${n.toLocaleString("en-US")} within ${yesRadiusKm(focus.kind as Exclude<MapKind, "capital">)} km`;
  }
  const n = focus.points.length;
  return n === 6 ? "6 nearest" : n > 1 ? `${n} places` : "";
}

/** A line of the box saying what's on the map: the kind's icon, its name,
 *  how many (or how far), and its own close. */
function ShownLine({ kind, label, detail, onClose }: { kind: MapKind; label: string; detail: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mapIconUrl(kind)} alt="" width={14} height={14} className="shrink-0" />
      <span className="text-xs font-medium text-ink-900">
        {label}
        {detail && <span className="font-normal text-ink-500"> · {detail}</span>}
      </span>
      <button type="button" aria-label={`Hide ${label}`} onClick={onClose} className="ml-auto flex-shrink-0 rounded-full p-1 text-ink-500 hover:text-ink-900">
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
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
  /** A kind's places in the city, from the dataset (from 2026-10-29) - the
   *  layer list then offers every INSIDE_KINDS kind and shows them all;
   *  without it, the kinds the map's tiles hold, within 5 km. */
  loadInside?: (kind: InsideKind) => Promise<{ lng: number; lat: number; name: string }[] | null>;
  /** "Lyon, France" - a tapped icon's Google Maps search adds it to the
   *  place's name. */
  areaName?: string;
  /** Per kind, how many are in the city and the nearest one's distance -
   *  the layer list says "nearest 25 km" for a kind the city has none of. */
  insideFigures?: Partial<Record<InsideKind, { count: number; nearestKm: number | null }>>;
}

const FOCUS_SOURCE_ID = "piltri-focus";
/** A figure's places: the kind's icon on every one, and its name where
 *  there's room. */
const FOCUS_POINTS_ID = "piltri-focus-points";
/** A Yes's circle (5 km from the centre, 10 for a port): where its places
 *  are counted - drawn so it's clear why they stop there (2026-10-28: in
 *  London, an outline 40 km across). */
const FOCUS_CIRCLE_ID = "piltri-focus-circle";
/** The map's layer list (2026-10-28, on request): any kinds of place at
 *  once - every one in the city from the dataset (loadInside), or with an
 *  older dataset those within 5 km of the centre, read from the detailed
 *  tiles (lib/mapPlaces.ts). From zoom 14, where the map shows the detailed
 *  tiles itself, every one in view too - anywhere. */
const LAYERS_SOURCE_ID = "piltri-layers";
/** The basemap's label layers ("liberty" style) shown from a lower zoom
 *  than the style's own: main roads (12.2), streets (15), paths (15.5),
 *  the most notable places of interest (15) and the others (16, 17). */
const EARLIER_LABELS: [string, number][] = [
  ["highway-name-major", 11],
  ["highway-name-minor", 13.5],
  ["highway-name-path", 15],
  ["poi_r1", 13.5],
  ["poi_r7", 15],
  ["poi_r20", 16],
];
/** The tiles' own detail starts here. */
const DETAIL_ZOOM = 14;
const osmLayerId = (kind: NearbyKind) => `piltri-osm-${kind}`;
/** The layer list's names, in its order. */
const LAYER_LABELS: Record<InsideKind, string> = {
  train: "Train stations",
  metro: "Metro stations",
  tram: "Tram stops",
  bus: "Bus stations",
  port: "Ports & ferries",
  nursery: "Nurseries",
  school: "Schools",
  university: "Universities",
  careHome: "Care homes",
  hospital: "Hospitals",
  intlAirport: "Int'l airports",
  localAirport: "Local airports",
  beach: "Beaches",
  lakeBeach: "Lake beaches",
  mountain: "Mountains",
  forest: "Forests",
};

/** Every place gets its icon - smaller zoomed out, never hidden (2026-10-29,
 *  on request: icons only, no dots) - and its name where there's room,
 *  from zoom 12 (thousands of names placed at once slowed the map). */
const PLACE_ICON_LAYOUT = {
  "icon-allow-overlap": true,
  "icon-ignore-placement": true,
  "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 13, 0.7, 16, 0.9],
  "text-field": ["step", ["zoom"], "", 12, ["get", "name"]],
  "text-font": ["Noto Sans Regular"],
  "text-size": 11.5,
  "text-anchor": "left",
  "text-offset": ["interpolate", ["linear"], ["zoom"], 10, ["literal", [0.9, 0]], 16, ["literal", [1.4, 0]]],
  "text-max-width": 12,
  "text-optional": true,
} as const;
const PLACE_ICON_PAINT = { "text-color": muteColor("#1E1A16"), "text-halo-color": muteColor("#FFFFFF"), "text-halo-width": 1.6, "text-halo-blur": 0.4 };
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

/** A place's kind in a few words, for its card. */
const KIND_NAMES: Record<MapKind, string> = {
  train: "Train station",
  metro: "Metro station",
  tram: "Tram stop",
  bus: "Bus station",
  port: "Port or ferry",
  airport: "Airport",
  intlAirport: "International airport",
  localAirport: "Local airport",
  nursery: "Nursery or day care",
  school: "School",
  university: "University",
  careHome: "Care home",
  hospital: "Hospital",
  beach: "Beach",
  lakeBeach: "Lake beach",
  mountain: "Mountain",
  forest: "Forest",
  large: "City",
  capital: "Capital",
};

/** The card that opens on a tapped icon (2026-10-29, on request): its name,
 *  what it is and how far from the centre, and a link to Google Maps (by
 *  name - its listing, reviews and hours - or by its point when unnamed). */
function placeCardHtml(name: string, kind: MapKind, distance: string, lat: number, lng: number, areaName?: string): string {
  // Laid out by .piltri-place-card (globals.css): the kind's icon, the
  // name, the kind in its colour, the distance, the link (2026-10-30, on
  // request: clearer, aligned, a clean close button).
  return (
    `<div class="piltri-place-card">` +
    `<div class="piltri-place-card-head"><img src="${mapIconUrl(kind)}" width="28" height="28" alt="">` +
    `<div><div class="piltri-place-card-name">${escapeHtml(name || KIND_NAMES[kind])}</div>` +
    `<div class="piltri-place-card-kind" style="color:${mapIconColor(kind)}">${escapeHtml(KIND_NAMES[kind])}</div></div></div>` +
    `<div class="piltri-place-card-meta">${escapeHtml(distance)} from the centre</div>` +
    `<a href="${googleMapsSearchUrl(name ? [name, areaName].filter(Boolean).join(", ") : `${lat.toFixed(5)},${lng.toFixed(5)}`)}" target="_blank" rel="noopener noreferrer" class="piltri-popup-link" ` +
    `style="display:inline-flex; align-items:center; gap:4px;">Open in Google Maps${OPEN_IN_NEW_SVG}</a>` +
    `</div>`
  );
}

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
  loadInside,
  areaName,
  insideFigures,
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
  // The layer list: the kinds ticked, whether it's open, and whether the
  // map is close enough to show every place in view (DETAIL_ZOOM).
  const [layerKinds, setLayerKinds] = useState<NearbyKind[]>([]);
  // How many of each ticked kind are drawn, and from where: the city's list
  // (dataset) or the tiles within 5 km - for its line in the shown box.
  const [layerCounts, setLayerCounts] = useState<Partial<Record<NearbyKind, { n: number; from: "list" | "tiles" }>>>({});
  const [layersOpen, setLayersOpen] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  // A Yes being shown counts as ticked in the layer list (2026-10-29, on
  // request: tap a Yes, expand the map - it's already ticked).
  const focusKind = focus?.style === "pin" && focus.kind !== "capital" ? focus.kind : null;
  const listKinds: readonly NearbyKind[] = loadInside ? INSIDE_KINDS : MAP_LAYER_KINDS;
  const toggleLayer = (kind: NearbyKind) => {
    if (kind === focusKind) {
      setLayerKinds((kinds) => kinds.filter((k) => k !== kind));
      onCloseFocus?.();
    } else {
      setLayerKinds((kinds) => (kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]));
    }
  };
  // The journey along the roads for a distance figure: its bounds (framed
  // with the place), the chip's "35 km · 35 min by car", and which focus
  // it's for (a reply for an earlier tap is dropped).
  const routeBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const routeTokenRef = useRef(0);
  const [routeInfo, setRouteInfo] = useState<string | null>(null);
  const { prefs } = useUnitPreferences();
  // The ticked kinds, a line each in the shown box (a Yes's kind is on the
  // Yes's line), and what that line says: how many are drawn, or for a kind
  // the city has none of, how far the nearest is.
  const shownLayers = layerKinds.filter((kind) => kind !== focusKind);
  const layerCountText = (kind: NearbyKind): string => {
    const drawn = layerCounts[kind];
    if (!drawn) return "finding them…";
    const figure = insideFigures?.[kind as InsideKind];
    if (drawn.from === "tiles") return `${drawn.n.toLocaleString("en-US")} within ${yesRadiusKm(kind)} km`;
    if (figure?.count === 0) return figure.nearestKm != null ? `nearest ${formatDistanceKm(figure.nearestKm, prefs)}` : "none near";
    return `${drawn.n.toLocaleString("en-US")} ${airportsByReach(kind) ? `within ${AIRPORT_REACH_KM} km` : "in the city"}`;
  };
  // What a tapped icon's card reads (its listener is set up once).
  const cardContextRef = useRef({ lat, lng, prefs, areaName });
  cardContextRef.current = { lat, lng, prefs, areaName };
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
    if (focused.complete && areaBoundsRef.current) {
      const bounds = new maplibregl.LngLatBounds(areaBoundsRef.current.getSouthWest(), areaBoundsRef.current.getNorthEast());
      for (const p of focused.points) bounds.extend([p.lng, p.lat]);
      return bounds;
    }
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

    // Pointer (hand) cursor everywhere on the map, not the map's default
    // grab/drag cursor - clicking the map is always a meaningful action
    // here (drop a pin, or pick a directions target), so it should read as
    // clickable the same way the place-name buttons in PinPanel do, rather
    // than implying it's just a pannable surface. (A view-only map keeps
    // the default drag cursor.)
    if (onMapClick) map.getCanvas().style.cursor = "pointer";
    map.on("zoomend", () => setDetailed(map.getZoom() >= DETAIL_ZOOM));
    // Touching the map closes the layer list.
    map.on("mousedown", () => setLayersOpen(false));
    map.on("touchstart", () => setLayersOpen(false));

    map.on("load", () => {
      mapLoadedRef.current = true;
      // The "liberty" style's colours are more saturated than fits the
      // "elegant, book cover" tone: toned down colour by colour, so what
      // we draw on top - the place icons - keeps its own (lib/mapColors.ts;
      // a filter on the whole canvas until 2026-10-29). The lines and
      // fills below keep that muted look through muteColor.
      muteBasemap(map);
      // More names at a city's own zoom (2026-10-29, on request: "names of
      // key streets, buildings, stations"): the style shows main roads'
      // from 12.2, streets' and places' of interest from 15 - a city page
      // opens around 12-13. Labels that don't fit are still left out.
      for (const [id, minzoom] of EARLIER_LABELS) if (map.getLayer(id)) map.setLayerZoomRange(id, minzoom, 24);
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
        paint: { "fill-color": muteColor("#FAF7F2"), "fill-opacity": 0.45 },
      });
      map.addSource(AREA_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${AREA_SOURCE_ID}-fill`,
        type: "fill",
        source: AREA_SOURCE_ID,
        paint: { "fill-color": muteColor("#E3B27A"), "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: `${AREA_SOURCE_ID}-line-halo`,
        type: "line",
        source: AREA_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": muteColor("#FFFFFF"), "line-width": 6, "line-opacity": 0.85, "line-blur": 1 },
      });
      map.addLayer({
        id: `${AREA_SOURCE_ID}-line`,
        type: "line",
        source: AREA_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": muteColor("#96600F"), "line-width": 2.25, "line-opacity": 1 },
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
        paint: { "line-color": muteColor("#1E1A16"), "line-width": 2.5, "line-opacity": 0.75, "line-dasharray": [1.5, 1.5] },
      });
      map.addSource(FOCUS_ROUTE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: ROUTE_ATTRIBUTION });
      map.addLayer({
        id: `${FOCUS_ROUTE_ID}-casing`,
        type: "line",
        source: FOCUS_ROUTE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": muteColor("#FFFFFF"), "line-width": 7, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: FOCUS_ROUTE_ID,
        type: "line",
        source: FOCUS_ROUTE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        // Blue, so the journey never reads as part of the amber outline.
        paint: { "line-color": muteColor("#3B6E8F"), "line-width": 3.5 },
      });
      // A figure's places: a dot for every one, and its icon and name
      // where they fit (nearest first).
      addMapIcons(map);
      map.addSource(FOCUS_CIRCLE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: FOCUS_CIRCLE_ID,
        type: "line",
        source: FOCUS_CIRCLE_ID,
        paint: { "line-color": muteColor("#1E1A16"), "line-width": 1.5, "line-opacity": 0.55, "line-dasharray": [3, 2] },
      });
      // The layer list's places: zoomed out, those read for the 5 km
      // around the centre; from DETAIL_ZOOM, the tiles' own, anywhere.
      map.addSource(LAYERS_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${LAYERS_SOURCE_ID}-icons`,
        type: "symbol",
        source: LAYERS_SOURCE_ID,
        maxzoom: DETAIL_ZOOM,
        layout: { ...PLACE_ICON_LAYOUT, "icon-image": ["get", "icon"], "symbol-sort-key": ["get", "rank"] } as any,
        paint: PLACE_ICON_PAINT,
      });
      for (const kind of MAP_LAYER_KINDS) {
        const filter = osmPoiFilter(kind) as any;
        map.addLayer({
          id: osmLayerId(kind),
          type: "symbol",
          source: "openmaptiles",
          "source-layer": "poi",
          minzoom: DETAIL_ZOOM,
          filter,
          layout: { ...PLACE_ICON_LAYOUT, visibility: "none", "icon-image": mapIconId(kind) } as any,
          paint: PLACE_ICON_PAINT,
        });
      }
      map.addSource(FOCUS_POINTS_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${FOCUS_POINTS_ID}-icons`,
        type: "symbol",
        source: FOCUS_POINTS_ID,
        layout: { ...PLACE_ICON_LAYOUT, "icon-image": ["get", "icon"], "symbol-sort-key": ["get", "rank"] } as any,
        paint: PLACE_ICON_PAINT,
      });
      // Tapping an icon opens its card.
      const card = new maplibregl.Popup({ offset: 14, closeButton: true, maxWidth: "260px", className: "piltri-place-popup" });
      for (const id of [`${FOCUS_POINTS_ID}-icons`, `${LAYERS_SOURCE_ID}-icons`, ...MAP_LAYER_KINDS.map(osmLayerId)]) {
        map.on("click", id, (e) => {
          const feature = e.features?.[0];
          if (!feature || feature.geometry.type !== "Point") return;
          const [plng, plat] = feature.geometry.coordinates as [number, number];
          const kind = (feature.properties?.kind ?? id.replace("piltri-osm-", "")) as MapKind;
          const { lat: clat, lng: clng, prefs: units, areaName: area } = cardContextRef.current;
          const distance = formatDistanceKm(straightLineKm({ lat: clat, lng: clng }, { lat: plat, lng: plng }), units);
          card.setLngLat([plng, plat]).setHTML(placeCardHtml(String(feature.properties?.name ?? ""), kind, distance, plat, plng, area)).addTo(map);
        });
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = onMapClick ? "pointer" : ""));
      }
      setMapReady(true);

      // Directions route line - empty until both a main pin and a
      // destination pin exist (see the route effect below).
      map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${ROUTE_SOURCE_ID}-line`,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": muteColor("#BA7517"), "line-width": 3, "line-opacity": 0.85, "line-dasharray": [2, 1.5] },
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

  // The tiles' own places, anywhere in view from DETAIL_ZOOM - only where
  // the dataset has no list of its own (an older dataset): with one, the
  // map shows the city's, and the two would double up.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const shown = new Set<NearbyKind>(loadInside ? [] : layerKinds);
    if (focus?.style === "pin" && !focus.complete && focus.kind !== "capital") shown.add(focus.kind);
    for (const kind of MAP_LAYER_KINDS) map.setLayoutProperty(osmLayerId(kind), "visibility", shown.has(kind) ? "visible" : "none");
    map.setLayerZoomRange(`${LAYERS_SOURCE_ID}-icons`, 0, loadInside ? 24 : DETAIL_ZOOM);
  }, [mapReady, layerKinds, focus, loadInside]);

  // The ticked kinds' places: every one in the city from the dataset, or
  // with an older dataset those within 5 km of the centre from the tiles.
  // A Yes's kind is left to the Yes (the focus layer).
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource(LAYERS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!map || !mapReady || !source) return;
    const controller = new AbortController();
    const byKind = new Map<NearbyKind, { lng: number; lat: number; name: string }[]>();
    const counts = new Map<NearbyKind, { n: number; from: "list" | "tiles" }>();
    const found = (kind: NearbyKind, places: { lng: number; lat: number; name: string }[], from: "list" | "tiles") => {
      byKind.set(kind, places);
      counts.set(kind, { n: places.length, from });
      drawSoon();
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const draw = () => {
      timer = null;
      setLayerCounts(Object.fromEntries(counts));
      source.setData({
        type: "FeatureCollection",
        features: [...byKind].flatMap(([kind, places]) =>
          places.map((p) => ({
            type: "Feature",
            properties: { name: p.name, kind, icon: mapIconId(kind) },
            geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          }))
        ),
      } as any);
    };
    // Tiles report after each one read: drawn at most every 300 ms, not
    // dozens of times per kind (2026-10-29: big cities were slow).
    const drawSoon = () => {
      timer ??= setTimeout(draw, 300);
    };
    draw();
    for (const kind of layerKinds) {
      if (kind === focusKind) continue;
      if (loadInside) {
        loadInside(kind as InsideKind)
          .then((places) => {
            if (controller.signal.aborted) return;
            if (places) {
              found(kind, places, "list");
            } else if (hasMapPlaces(kind)) {
              // No list of its own (a tram line has no stops in the data):
              // the tiles' within 5 km.
              loadMapPlaces(kind, { lat, lng }, controller.signal, (tilePlaces) => found(kind, tilePlaces, "tiles")).catch(() => {});
            } else {
              found(kind, [], "tiles");
            }
          })
          .catch(() => {});
      } else if (hasMapPlaces(kind)) {
        loadMapPlaces(kind, { lat, lng }, controller.signal, (places) => found(kind, places, "tiles")).catch(() => {});
      }
    }
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [mapReady, layerKinds, lat, lng, focusKind, loadInside]);

  // A Yes: look for every place of its kind in the map's tiles (lib/
  // mapPlaces.ts) - the dataset's own nearest 6 show meanwhile, and stay
  // where the tiles have nothing near them.
  useEffect(() => {
    setTilePlaces(null);
    if (!focus || focus.style !== "pin" || focus.complete || focus.kind === "capital" || !hasMapPlaces(focus.kind)) return;
    const controller = new AbortController();
    // Redrawn at most every 300 ms while tiles come in (a redraw per tile
    // slowed big cities down).
    let shownAt = 0;
    loadMapPlaces(focus.kind, { lat, lng }, controller.signal, (places, done) => {
      tilePlacesRef.current = { focus, places };
      if (done || Date.now() - shownAt > 300) {
        shownAt = Date.now();
        setTilePlaces({ places, done });
      }
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
      (map.getSource(FOCUS_CIRCLE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(
        focus?.style === "pin" && !focus.complete && focus.kind !== "capital"
          ? (circlePolygon(lat, lng, yesRadiusKm(focus.kind)) as any)
          : { type: "FeatureCollection", features: [] }
      );
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
      {(focus || shownLayers.length > 0) && (
        // What's on the map, a line per kind with its count and its close -
        // the same for a tapped figure and a kind ticked in the layer list,
        // always beside the buttons (2026-10-30, owner: "more consistent").
        // A journey adds the same one in Google Maps in a new tab.
        <div className="absolute right-[46px] top-[10px] z-10 max-w-[min(20rem,calc(100%-56px))] rounded-2xl bg-surface py-0.5 pl-2.5 pr-0.5 shadow-card">
          {focus && (
            <>
              <ShownLine
                kind={focus.kind}
                label={focus.style === "pin" ? LAYER_LABELS[focus.kind as InsideKind] ?? focus.title : focus.title}
                detail={[
                  focus.style === "pin" ? yesCount(focus, tilePlaces, { lat, lng }) : "",
                  !focus.points.length && !tilePlaces?.places.length ? "none found nearby" : "",
                  routeInfo ?? "",
                ].filter(Boolean).join(" · ")}
                onClose={() => onCloseFocus?.()}
              />
              {focus.style === "journey" && focus.points[0] && (
                <a
                  href={googleMapsDirectionsUrl(
                    { lat, lng },
                    focus.points[0],
                    straightLineKm({ lat, lng }, focus.points[0]) <= WALK_MAX_KM ? "foot" : "car"
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-5 inline-flex items-center gap-1 pb-1 pr-2 text-[11px] font-medium text-piltri-amber-dark hover:underline underline-offset-2"
                >
                  Open in Google Maps
                  <ExternalLinkIcon className="w-3 h-3" />
                </a>
              )}
            </>
          )}
          {shownLayers.map((kind) => (
            <ShownLine key={kind} kind={kind} label={LAYER_LABELS[kind as InsideKind] ?? kind} detail={layerCountText(kind)} onClose={() => toggleLayer(kind)} />
          ))}
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
      {(expanded || !compact) && (
        // The layer list: under the zoom and expand buttons, in their style.
        <>
          <button
            type="button"
            onClick={() => setLayersOpen((open) => !open)}
            aria-label="Places to show on the map"
            aria-expanded={layersOpen}
            title="Places to show on the map"
            className={cn(
              "absolute right-[10px] z-10 flex h-[29px] w-[29px] items-center justify-center rounded shadow-[0_0_0_2px_rgba(0,0,0,0.1)]",
              onToggleExpanded ? "top-[113px]" : "top-[76px]",
              layerKinds.length || focusKind ? "bg-piltri-amber text-white" : "bg-white text-ink-900 hover:bg-surface-muted"
            )}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3l9 5-9 5-9-5z" />
              <path d="M3 13l9 5 9-5" />
            </svg>
          </button>
          {layersOpen && (
            // Right under its button, against the map's edge, narrow
            // (2026-10-30, owner: "take less space from the map"); never
            // taller than the map - it scrolls inside.
            <div
              className={cn(
                "absolute right-[10px] z-20 w-[180px] overflow-y-auto rounded-xl bg-surface p-1 shadow-card",
                onToggleExpanded ? "top-[148px] max-h-[calc(100%-160px)]" : "top-[111px] max-h-[calc(100%-123px)]"
              )}
            >
              <p className="px-1.5 pb-0.5 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">Show on the map</p>
              {listKinds.map((kind) => {
                const on = layerKinds.includes(kind) || kind === focusKind;
                // None in the city: its nearest one's distance - ticking
                // shows it where it is, the map doesn't move (2026-10-29).
                const none = insideFigures?.[kind as InsideKind]?.count === 0 ? insideFigures[kind as InsideKind]! : null;
                const label = LAYER_LABELS[kind as InsideKind];
                return (
                  <button
                    key={kind}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => toggleLayer(kind)}
                    title={none ? (none.nearestKm != null ? `None in the city - the nearest is ${formatDistanceKm(none.nearestKm, prefs)} away` : "None within 500 km") : undefined}
                    className={cn("flex w-full items-center gap-1.5 rounded-lg px-1.5 py-[3px] text-left text-[11px] text-ink-900 hover:bg-surface-muted", on && "font-medium")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mapIconUrl(kind)} alt="" width={16} height={16} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {none && (
                      <span className="shrink-0 text-[10px] font-normal text-ink-500">
                        {none.nearestKm != null ? formatDistanceKm(none.nearestKm, prefs) : "none"}
                      </span>
                    )}
                    <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px]", on ? "border-piltri-amber bg-piltri-amber text-white" : "border-ink-300")}>
                      {on && "✓"}
                    </span>
                  </button>
                );
              })}
              <p className="px-1.5 pb-0.5 pt-1 text-[10px] leading-snug text-ink-500">
                {loadInside
                  ? `Every one in the city, or within 1 km of it${airportsByReach("intlAirport") ? `; airports within ${AIRPORT_REACH_KM} km` : ""}.`
                  : detailed
                    ? "Every one in view."
                    : "Within 5 km of the centre - zoom in to see them anywhere."}
                {(layerKinds.length > 0 || focusKind) && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => {
                        setLayerKinds([]);
                        if (focusKind) onCloseFocus?.();
                      }} className="font-medium text-piltri-amber-dark hover:underline underline-offset-2">
                      Clear
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
        </>
      )}
      <MapCredit routes={!!routeInfo} />
    </div>
  );
}
