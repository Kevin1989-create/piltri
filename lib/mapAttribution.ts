import type { Map as MaplibreMap } from "maplibre-gl";

/** OpenStreetMap's attribution guidelines accept a collapsed ("i") credit on
 *  interactive maps as long as it's shown when the map first loads.
 *  MapLibre's compact control does open on load, but only collapses on the
 *  first drag - on a phone it covers the bottom of the map (and the "Drop a
 *  pin" hint) until then. This collapses it a few seconds after load. */
export function autoCollapseAttribution(map: MaplibreMap, delayMs = 4000): void {
  map.once("load", () => {
    window.setTimeout(() => {
      const el = map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact");
      el?.classList.remove("maplibregl-compact-show");
      el?.removeAttribute("open");
    }, delayMs);
  });
}
