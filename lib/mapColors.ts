import type { Map as MaplibreMap } from "maplibre-gl";

/**
 * The map's soft, muted look. It used to be a CSS filter on the whole map
 * canvas - saturate(0.45) brightness(1.08) contrast(0.95) - which also
 * dulled everything drawn on top, so the place icons couldn't have true,
 * distinct colours (2026-10-29, on request: "play a bit more with the
 * colours"). The same filter is now applied to the basemap's own colours,
 * one by one (muteBasemap), and to the overlays meant to keep that look
 * (muteColor); the icons keep theirs.
 */

// A little less muted since 2026-11-08 (owner: "a bit more contrast and
// details"): 0.45 / 1.08 / 0.95 before.
const SATURATE = 0.6;
const BRIGHTNESS = 1.04;
const CONTRAST = 1;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** CSS's filter, step by step: saturate (the Filter Effects matrix), then
 *  brightness, then contrast - on 0-1 channels. */
function filterRgb([r, g, b]: number[]): number[] {
  const s = SATURATE;
  const sat = [
    (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
  ].map(clamp);
  return sat.map((v) => clamp((clamp(v * BRIGHTNESS) - 0.5) * CONTRAST + 0.5));
}

function hslToRgb(h: number, s: number, l: number): number[] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
}

/** A CSS colour as 0-1 channels and alpha, or null if it isn't one (the
 *  basemap uses hex, rgb(a) and hsl(a)). */
function parseColor(css: string): { rgb: number[]; a: number } | null {
  const s = css.trim().toLowerCase();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(full)) return null;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
    return { rgb: [n(0), n(2), n(4)], a: full.length === 8 ? n(6) : 1 };
  }
  const m = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  const num = (p: string, scale: number) => (p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / scale);
  const a = parts[3] != null ? num(parts[3], 1) : 1;
  if (m[1].startsWith("rgb")) return { rgb: parts.slice(0, 3).map((p) => num(p, 255)), a };
  return { rgb: hslToRgb(parseFloat(parts[0]), num(parts[1], 100), num(parts[2], 100)), a };
}

/** A colour with the map's muted look. Anything that isn't a colour comes
 *  back as it was. */
export function muteColor(css: string): string {
  const parsed = parseColor(css);
  if (!parsed) return css;
  const [r, g, b] = filterRgb(parsed.rgb).map((v) => Math.round(v * 255));
  return `rgba(${r}, ${g}, ${b}, ${Number(parsed.a.toFixed(3))})`;
}

/** Every colour inside a paint value - a plain colour, an expression, or
 *  the older {stops: [...]} form. */
function muteValue(value: unknown): unknown {
  if (typeof value === "string") return muteColor(value);
  if (Array.isArray(value)) return value.map(muteValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, muteValue(v)]));
  return value;
}

/** A width expression ["interpolate", curve, ["zoom"], z, w, ...] with every
 *  width times `factor`; anything else as it was. */
function widen(value: unknown, factor: number): unknown {
  if (!Array.isArray(value) || value[0] !== "interpolate") return typeof value === "number" ? value * factor : value;
  return value.map((v, i) => (i >= 4 && i % 2 === 1 && typeof v === "number" ? v * factor : v));
}

/** The streets read like a street map's (2026-11-08, owner: "more contrast
 *  and details ... highlight of the high street like in Google Maps"),
 *  after muteBasemap: a clear road hierarchy - warm amber motorways,
 *  honey main streets, pale yellow secondary ones, crisp white side streets,
 *  each with a defined edge and a little wider at a city's zoom - and the
 *  shopping and business districts, where the high streets are, in a soft
 *  peach, as Google Maps marks its "areas of interest" (OpenStreetMap's
 *  retail and commercial land, in the tiles already). */
export function emphasizeStreets(map: MaplibreMap): void {
  // Darker and firmer on 2026-11-12 (owner: "the streets are too pale -
  // a bit darker, to see them better and from further"): every edge a
  // shade deeper, the main and secondary roads a little more coloured.
  const style: [string[], string, number][] = [
    // [layers, colour, width factor]
    [["road_motorway", "bridge_motorway", "road_motorway_link", "bridge_motorway_link"], "#F0B952", 1.15],
    [["road_motorway_casing", "bridge_motorway_casing", "road_motorway_link_casing", "bridge_motorway_link_casing"], "#C1862F", 1.15],
    [["road_trunk_primary", "bridge_trunk_primary"], "#F6D27A", 1.3],
    [["road_trunk_primary_casing", "bridge_trunk_primary_casing"], "#BF8F45", 1.3],
    [["road_secondary_tertiary", "bridge_secondary_tertiary", "road_link", "bridge_link"], "#FBE6AE", 1.25],
    [["road_secondary_tertiary_casing", "bridge_secondary_tertiary_casing", "road_link_casing", "bridge_link_casing"], "#C4A56B", 1.25],
    [["road_minor", "bridge_street"], "#FFFFFF", 1.1],
    [["road_minor_casing", "bridge_street_casing"], "#ADA08D", 1.1],
  ];
  for (const [ids, color, factor] of style) {
    for (const id of ids) {
      if (!map.getLayer(id)) continue;
      map.setPaintProperty(id, "line-color", color);
      map.setPaintProperty(id, "line-width", widen(map.getPaintProperty(id, "line-width"), factor) as any);
    }
  }
  // Side streets have no white middle before zoom 13.5 - only their edge,
  // half a pixel to one wide, which vanished on the cream: drawn as a
  // clear warm-grey line from zoom 11 instead, widening into the edge of
  // the white street as you zoom in.
  const sideStreetEdge = ["interpolate", ["exponential", 1.2], ["zoom"], 11, 0.5, 12, 1, 13, 1.6, 14, 4.6, 20, 22];
  for (const id of ["road_minor_casing", "bridge_street_casing"]) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, "line-width", sideStreetEdge as any);
    map.setLayerZoomRange(id, 11, 24);
  }
  // Buildings a touch firmer, so blocks and streets stand apart.
  if (map.getLayer("building")) map.setPaintProperty("building", "fill-color", "#E3DBD0");
  if (map.getLayer("building-3d")) map.setPaintProperty("building-3d", "fill-extrusion-color", "#E6DED3");
  // Shopping and business districts, under the roads.
  const firstRoad = map.getStyle()?.layers?.find((l) => "source-layer" in l && l["source-layer"] === "transportation")?.id;
  if (!map.getLayer("piltri-shopping-areas")) {
    map.addLayer(
      {
        id: "piltri-shopping-areas",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["match", ["get", "class"], ["retail", "commercial"], true, false],
        paint: {
          "fill-color": "#F6CFA6",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0, 12.5, 0.5, 16, 0.6],
        },
      },
      firstRoad
    );
  }
}

/** Mutes the basemap's style (call once it has loaded, before adding any
 *  layers of our own): every colour of every layer, and the shaded-relief
 *  raster of the zoomed-out world. Its sprite icons (shops, road shields)
 *  keep their colours. */
export function muteBasemap(map: MaplibreMap): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "raster") {
      map.setPaintProperty(layer.id, "raster-saturation", SATURATE - 1);
      map.setPaintProperty(layer.id, "raster-contrast", CONTRAST - 1);
      continue;
    }
    for (const prop of Object.keys(("paint" in layer && layer.paint) || {})) {
      if (!prop.endsWith("color")) continue;
      map.setPaintProperty(layer.id, prop, muteValue(map.getPaintProperty(layer.id, prop)) as any);
    }
  }
}
