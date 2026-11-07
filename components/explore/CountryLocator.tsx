"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

/** public/geo/countries/<CC>.json (scripts/build-country-shapes.mjs): the
 *  country in clusters of nearby parts (mainland France and Corsica;
 *  Réunion...), biggest first - each with its box and its rings as flat
 *  [lng, lat, lng, lat...] lists. Longitudes can run past ±180 to keep a
 *  country whole across the date line. */
interface CountryShape {
  name: string;
  clusters: { b: [number, number, number, number]; r: number[][] }[];
}

const shapes = new Map<string, Promise<CountryShape | null>>();
function loadShape(cc: string): Promise<CountryShape | null> {
  if (!shapes.has(cc)) {
    shapes.set(
      cc,
      fetch(`/geo/countries/${cc}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<CountryShape>) : null))
        .catch(() => null)
    );
  }
  return shapes.get(cc)!;
}

/** The cluster the place is in (or the nearest), and the place's longitude
 *  on that cluster's side of the date line. */
function clusterFor(shape: CountryShape, lat: number, lng: number) {
  let best: { cluster: CountryShape["clusters"][number]; x: number; d: number } | null = null;
  for (const cluster of shape.clusters) {
    const [minx, miny, maxx, maxy] = cluster.b;
    for (const x of [lng, lng + 360, lng - 360]) {
      const d = Math.hypot(Math.max(0, minx - x, x - maxx), Math.max(0, miny - lat, lat - maxy));
      if (!best || d < best.d) best = { cluster, x, d };
    }
  }
  return best;
}

/**
 * Where the place is in its country (2026-11-07, owner: "a small square
 * with the country where it is ... work something awesome"): the
 * country's silhouette with the place as a softly pulsing amber dot, in a
 * corner of the map. Tapping it glides the map out to the whole country
 * (`onShowCountry` with its bounds), and again back to the place.
 */
export function CountryLocator({
  countryCode,
  countryName,
  placeName,
  lat,
  lng,
  size,
  showingCountry,
  onShowCountry,
  className,
  style,
}: {
  countryCode: string;
  /** The site's own names (the shape's are Natural Earth's). */
  countryName?: string;
  placeName?: string;
  lat: number;
  lng: number;
  /** The square's side, px. */
  size: number;
  showingCountry: boolean;
  /** The country's bounds to glide out to, or null to come back. */
  onShowCountry: (bounds: [[number, number], [number, number]] | null) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [shape, setShape] = useState<CountryShape | null>(null);
  useEffect(() => {
    let live = true;
    setShape(null);
    loadShape(countryCode).then((s) => live && setShape(s));
    return () => {
      live = false;
    };
  }, [countryCode]);

  const drawing = useMemo(() => {
    if (!shape) return null;
    const found = clusterFor(shape, lat, lng);
    if (!found) return null;
    const [minx, miny, maxx, maxy] = found.cluster.b;
    // Plate carrée, squeezed by the cosine of the middle latitude: true
    // enough at a country's scale.
    const kx = Math.cos((((miny + maxy) / 2) * Math.PI) / 180);
    const w = Math.max((maxx - minx) * kx, 1e-6);
    const h = Math.max(maxy - miny, 1e-6);
    const inner = size - (size >= 96 ? 22 : 14);
    const scale = inner / Math.max(w, h);
    const ox = (size - w * scale) / 2;
    const oy = (size - h * scale) / 2 - (size >= 96 ? 4 : 0);
    const px = (x: number) => ox + (x - minx) * kx * scale;
    const py = (y: number) => oy + (maxy - y) * scale;
    const d = found.cluster.r
      .map((ring) => {
        let s = "";
        for (let i = 0; i < ring.length; i += 2) s += `${i ? "L" : "M"}${px(ring[i]).toFixed(1)} ${py(ring[i + 1]).toFixed(1)}`;
        return `${s}Z`;
      })
      .join("");
    return {
      d,
      dot: { x: px(found.x), y: py(lat) },
      bounds: [
        [minx, miny],
        [maxx, maxy],
      ] as [[number, number], [number, number]],
    };
  }, [shape, lat, lng, size]);

  if (!shape || !drawing) return null;
  const big = size >= 96;
  const country = countryName ?? shape.name;
  const back = placeName ? `Back to ${placeName}` : "Back to the place";
  return (
    <button
      type="button"
      onClick={() => onShowCountry(showingCountry ? null : drawing.bounds)}
      aria-label={showingCountry ? back : `Show all of ${country}`}
      title={showingCountry ? back : `Where ${placeName ?? "it"} is in ${country} - tap to see the whole country`}
      style={{ width: size, height: size, ...style }}
      className={cn(
        "group absolute z-10 overflow-hidden rounded-xl bg-surface/90 shadow-card ring-1 ring-black/5 backdrop-blur-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg motion-safe:animate-fade-in",
        className
      )}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden className="block">
        <path
          d={drawing.d}
          fillRule="evenodd"
          className={cn("transition-colors duration-300", showingCountry ? "fill-piltri-amber-tint" : "fill-[#EAE2D6]")}
          stroke="#BFAE97"
          strokeWidth={0.7}
          strokeLinejoin="round"
        />
        {/* The place: a soft pulse, a halo, the dot. */}
        <circle cx={drawing.dot.x} cy={drawing.dot.y} r={big ? 4 : 3} fill="#BA7517" className="locator-pulse" />
        <circle cx={drawing.dot.x} cy={drawing.dot.y} r={big ? 6.5 : 5} fill="#BA7517" opacity={0.18} />
        <circle cx={drawing.dot.x} cy={drawing.dot.y} r={big ? 3.4 : 2.6} fill="#BA7517" stroke="#FFFFFF" strokeWidth={1.4} />
      </svg>
      {big && (
        <span className="absolute inset-x-0 bottom-1.5 truncate px-2 text-center font-serif text-[11px] leading-none text-ink-700">
          {showingCountry ? back : country}
        </span>
      )}
    </button>
  );
}
