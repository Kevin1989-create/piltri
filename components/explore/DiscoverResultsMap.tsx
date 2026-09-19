"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { scoreColor } from "@/lib/design-tokens";

export interface MapPoint {
  key: string;
  lat: number;
  lng: number;
  name: string;
  piltriScore: number;
  detailHref: string;
}

interface DiscoverResultsMapProps {
  points: MapPoint[];
}

/** Small round marker showing the Piltri Score, colour-coded the same way
 *  as ScoreBadge (green/amber/red) — deliberately simpler than MapView's
 *  two-tone teardrop pin (which is built around a single dropped point),
 *  since this map can be plotting up to 50 results at once and a lighter
 *  glyph reads better at that density. */
function createScoreMarkerElement(score: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "30px";
  el.style.height = "30px";
  el.style.borderRadius = "50%";
  el.style.background = scoreColor(score);
  el.style.border = "2px solid white";
  el.style.boxShadow = "0 1px 3px rgba(30,26,22,0.4)";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.color = "white";
  el.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";
  el.style.fontSize = "11px";
  el.style.fontWeight = "600";
  el.style.cursor = "pointer";
  el.textContent = String(Math.round(score));
  return el;
}

/** Plots every Advanced search result as a marker, fit to bounds — separate
 *  from MapView.tsx (which is built around Pin mode's single-point,
 *  directions-drawing use case) so this stays a small, purpose-built
 *  "overview of many results" map instead of overloading that component
 *  with a second, unrelated responsibility. */
export function DiscoverResultsMap({ points }: DiscoverResultsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

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
      style: "mapbox://styles/mapbox/light-v11",
      center: [0, 20],
      zoom: 1.5,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    // light-v11 is monochrome by default (grey land, near-white water) - a
    // deliberate choice for the single-pin Pin mode map, but too flat for
    // this world-view overview. Recolour water to a soft blue (matching the
    // site's warm, muted palette rather than a saturated "map app" blue) so
    // oceans/lakes read as water at a glance, without switching to a busier
    // style (streets-v12's POI icons/labels would be noisy at world-zoom
    // with up to 50 markers already on screen).
    //
    // Matched by each layer's underlying vector-tile `source-layer`
    // ("water"/"waterway" in the Mapbox Streets tileset every base style is
    // built on) rather than a specific layer id — a fixed id like "water"
    // is not guaranteed to exist under that exact name in every style
    // revision, whereas the source-layer naming is the stable, documented
    // part of the schema.
    function recolourWater() {
      const layers = map.getStyle()?.layers ?? [];
      for (const layer of layers) {
        const sourceLayer = (layer as unknown as { "source-layer"?: string })["source-layer"];
        if (sourceLayer !== "water" && sourceLayer !== "waterway") continue;
        try {
          if (layer.type === "fill") map.setPaintProperty(layer.id, "fill-color", "#AED4E6");
          else if (layer.type === "line") map.setPaintProperty(layer.id, "line-color", "#AED4E6");
        } catch {
          // Some layers expose paint props under a slightly different name
          // across style versions - skip rather than throw over a cosmetic
          // tweak.
        }
      }
    }
    if (map.isStyleLoaded()) recolourWater();
    else map.once("load", recolourWater);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function render() {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      if (points.length === 0) return;

      const bounds = new mapboxgl.LngLatBounds();
      for (const point of points) {
        const el = createScoreMarkerElement(point.piltriScore);
        el.addEventListener("click", () => window.open(point.detailHref, "_blank", "noopener,noreferrer"));

        const popup = new mapboxgl.Popup({ offset: 18, closeButton: false }).setHTML(
          `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;font-size:12px;">
            <strong>${escapeHtml(point.name)}</strong><br/>Piltri Score: ${Math.round(point.piltriScore)}
          </div>`
        );

        const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([point.lng, point.lat])
          .setPopup(popup)
          .addTo(map!);
        markersRef.current.push(marker);
        bounds.extend([point.lng, point.lat]);
      }

      if (points.length === 1) {
        map!.flyTo({ center: [points[0].lng, points[0].lat], zoom: 8 });
      } else {
        map!.fitBounds(bounds, { padding: 60, maxZoom: 6, duration: 0 });
      }
    }

    if (map.isStyleLoaded()) render();
    else map.once("load", render);
  }, [points]);

  return <div ref={containerRef} className="w-full h-full rounded-card overflow-hidden" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
