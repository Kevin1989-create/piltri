import type { Map as MaplibreMap } from "maplibre-gl";
import type { MapKind } from "@/lib/kpiRows";

/**
 * The map's icon for each kind of place a figure points at - a school for
 * schools, a child for nurseries, a train for stations... (2026-10-28, on
 * request: one amber flag for everything was hard to read). A white
 * pictogram on a round badge, coloured by family: transport blue, education
 * amber, care red, nature green, towns ink.
 *
 * The badge colours are brighter than Piltri's palette on purpose: the map
 * canvas is desaturated as a whole (MapView: saturate(0.45) brightness(1.08)
 * contrast(0.95)), so these come out as #3B6E8F, #BA7517, #B4472F, #3F8557
 * and #3D362E - the palette - once drawn.
 */

const FAMILY = {
  transport: "#016FB7",
  education: "#F86200",
  care: "#FF2500",
  nature: "#00912D",
  town: "#3C2D1C",
} as const;

/** Pictograms on a 24 px grid: white lines (2 px, rounded) unless filled. */
const GLYPHS: Record<string, string> = {
  train:
    '<path d="M7 3h10a3 3 0 0 1 3 3v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3z"/><path d="M4 10h16"/>' +
    '<circle cx="8" cy="13.5" r="1" fill="#fff" stroke="none"/><circle cx="16" cy="13.5" r="1" fill="#fff" stroke="none"/><path d="M8 17l-2 4M16 17l2 4"/>',
  metro: '<path d="M5 19V6l7 7.5L19 6v13" stroke-width="2.4"/>',
  tram:
    '<path d="M9 2.5h6M12 2.5V6"/><rect x="6" y="6" width="12" height="11.5" rx="2.5"/><path d="M6 11.5h12"/>' +
    '<path d="M9 17.5l-2 3.5M15 17.5l2 3.5"/>',
  bus:
    '<rect x="5" y="3" width="14" height="15" rx="2.5"/><path d="M5 10.5h14"/><path d="M7.5 18v2.5M16.5 18v2.5"/>' +
    '<path d="M3 7v3M21 7v3"/><circle cx="8.5" cy="14.5" r="1" fill="#fff" stroke="none"/><circle cx="15.5" cy="14.5" r="1" fill="#fff" stroke="none"/>',
  ferry:
    '<path d="M3.5 14.5h17l-2.5 4.5H6z"/><path d="M7 14.5V9.5h10v5"/><path d="M12 9.5V5.5"/>' +
    '<path d="M3 22c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1" stroke-width="1.6"/>',
  plane:
    '<path d="M12 2.5c.8 0 1.4.9 1.4 2v5.1l7.1 4.3v2.1l-7.1-2.3v4.5l2.2 1.7V21L12 20.1 8.4 21v-1.6l2.2-1.7v-4.5L3.5 16v-2.1l7.1-4.3V4.5c0-1.1.6-2 1.4-2z" fill="#fff" stroke="none"/>',
  child:
    '<circle cx="12" cy="5" r="2.6"/><path d="M12 8.5v6.5"/><path d="M6.5 10.5l5.5 2 5.5-2"/><path d="M9 21.5l3-6.5 3 6.5"/>',
  school:
    '<path d="M3.5 11L12 6l8.5 5"/><path d="M5.5 10v10.5h13V10"/><path d="M10 20.5v-4.5h4v4.5"/>' +
    '<path d="M12 6V2h3.5v2.2H12"/>',
  university:
    '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v5.5"/>',
  careHome:
    '<path d="M3 11l9-7 9 7"/><path d="M5.5 9.5v11h13v-11"/>' +
    '<path d="M12 18.2s-3.6-2.2-3.6-4.5a1.9 1.9 0 0 1 3.6-.9 1.9 1.9 0 0 1 3.6.9c0 2.3-3.6 4.5-3.6 4.5z" fill="#fff" stroke="none"/>',
  hospital: '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z" fill="#fff" stroke="none"/>',
  beach:
    '<path d="M4 11.5a8 8 0 0 1 16 0z"/><path d="M12 11.5V19"/>' +
    '<path d="M3 21.5c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1" stroke-width="1.6"/>',
  mountain: '<path d="M2 20l7-12 4 6.5 3-4L22 20z"/><path d="M7.2 11l1.8 1.5 1.8-1.5"/>',
  forest: '<path d="M12 2.5l6 9h-3l4 6.5H5l4-6.5H6z"/><path d="M12 18v3.5"/>',
  town: '<path d="M3 21V11h5v10M8 21V4.5h7V21M15 21v-8h6v8"/><path d="M2 21h20"/><path d="M10.5 8h2M10.5 11.5h2M10.5 15h2"/>',
  capital:
    '<path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.6l-5.5 2.9 1.2-6.1-4.5-4.2 6.1-.8z" fill="#fff" stroke="none"/>',
};

/** Each kind's family and pictogram. */
const KIND_ICON: Record<MapKind, { family: keyof typeof FAMILY; glyph: string }> = {
  train: { family: "transport", glyph: "train" },
  metro: { family: "transport", glyph: "metro" },
  tram: { family: "transport", glyph: "tram" },
  bus: { family: "transport", glyph: "bus" },
  port: { family: "transport", glyph: "ferry" },
  airport: { family: "transport", glyph: "plane" },
  intlAirport: { family: "transport", glyph: "plane" },
  localAirport: { family: "transport", glyph: "plane" },
  nursery: { family: "education", glyph: "child" },
  school: { family: "education", glyph: "school" },
  university: { family: "education", glyph: "university" },
  careHome: { family: "care", glyph: "careHome" },
  hospital: { family: "care", glyph: "hospital" },
  beach: { family: "nature", glyph: "beach" },
  lakeBeach: { family: "nature", glyph: "beach" },
  mountain: { family: "nature", glyph: "mountain" },
  forest: { family: "nature", glyph: "forest" },
  large: { family: "town", glyph: "town" },
  capital: { family: "town", glyph: "capital" },
};

/** The map image id for a kind's icon. */
export const mapIconId = (kind: MapKind) => `piltri-${kind}`;
/** The kind's badge colour (as drawn - see the note above). */
export const mapIconColor = (kind: MapKind) => FAMILY[KIND_ICON[kind].family];

/** Badge: 30 px across (drawn at twice that for sharp screens), a white rim
 *  and a soft shadow so it stands off any part of the map. */
const BADGE_PX = 30;

function badgeSvg(kind: MapKind): string {
  const { family, glyph } = KIND_ICON[kind];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_PX * 2}" height="${BADGE_PX * 2}" viewBox="0 0 30 30">` +
    '<circle cx="15" cy="15.6" r="13.2" fill="#1E1A16" opacity="0.22"/>' +
    `<circle cx="15" cy="15" r="13" fill="${FAMILY[family]}" stroke="#FFFFFF" stroke-width="2"/>` +
    '<g transform="translate(6.6 6.6) scale(0.7)" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    GLYPHS[glyph] +
    "</g></svg>"
  );
}

/** Adds every kind's icon to the map (once its style has loaded). */
export function addMapIcons(map: MaplibreMap): void {
  for (const kind of Object.keys(KIND_ICON) as MapKind[]) {
    const id = mapIconId(kind);
    if (map.hasImage(id)) continue;
    const image = new Image(BADGE_PX * 2, BADGE_PX * 2);
    image.onload = () => {
      if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg(kind))}`;
  }
}
