import type maplibregl from "maplibre-gl";

/**
 * Names on the map in English (2026-11-16, owner: "full alignment in
 * English" - the search bar said "Lisbon", the map its own names): the
 * English name where OpenStreetMap has one, else the name in Latin letters,
 * else the name itself. OpenFreeMap's styles otherwise show a local name,
 * with the local script under it ("Moskva / Москва").
 */
export const ENGLISH_NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];

/** Every label of the map's style that shows a name (not a road number),
 *  in English - once the style is in, before any label is drawn. */
export function labelsInEnglish(map: maplibregl.Map): void {
  const apply = () => {
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.type !== "symbol") continue;
      const field = map.getLayoutProperty(layer.id, "text-field");
      if (field && JSON.stringify(field).includes("name")) map.setLayoutProperty(layer.id, "text-field", ENGLISH_NAME);
    }
  };
  if (map.isStyleLoaded()) apply();
  else map.once("style.load", apply);
}

/** A tile feature's name, the same way. */
export function englishName(properties: Record<string, unknown>): string {
  return String(properties["name:en"] ?? properties["name:latin"] ?? properties.name ?? "");
}
