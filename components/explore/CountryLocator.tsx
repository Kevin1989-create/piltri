"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { MOTION_CSS, MOTION_MS, prefersReducedMotion } from "@/lib/motion";

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

function useCountryShape(countryCode: string): CountryShape | null {
  const [shape, setShape] = useState<CountryShape | null>(null);
  useEffect(() => {
    let live = true;
    setShape(null);
    loadShape(countryCode).then((s) => live && setShape(s));
    return () => {
      live = false;
    };
  }, [countryCode]);
  return shape;
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

/** The place's cluster drawn in a w x h box of `unit`s per degree: plate
 *  carrée squeezed by the cosine of the middle latitude - true enough at a
 *  country's scale - and the place's point in it. */
function project(shape: CountryShape, lat: number, lng: number) {
  const found = clusterFor(shape, lat, lng);
  if (!found) return null;
  const [minx, miny, maxx, maxy] = found.cluster.b;
  const kx = Math.cos((((miny + maxy) / 2) * Math.PI) / 180);
  return {
    rings: found.cluster.r,
    w: Math.max((maxx - minx) * kx, 1e-6),
    h: Math.max(maxy - miny, 1e-6),
    px: (x: number) => (x - minx) * kx,
    py: (y: number) => maxy - y,
    dot: { x: (found.x - minx) * kx, y: maxy - lat },
  };
}

function pathOf(rings: number[][], px: (x: number) => number, py: (y: number) => number): string {
  return rings
    .map((ring) => {
      let s = "";
      for (let i = 0; i < ring.length; i += 2) s += `${i ? "L" : "M"}${px(ring[i]).toFixed(2)} ${py(ring[i + 1]).toFixed(2)}`;
      return `${s}Z`;
    })
    .join("");
}

/**
 * Where the place is in its country (2026-11-07, owner: "a small square
 * with the country where it is ... work something awesome"): the
 * country's silhouette with the place as a softly pulsing amber dot, in a
 * corner of the map. A tap opens the country over the whole map
 * (CountryTakeover, 2026-11-16).
 */
export function CountryLocator({
  countryCode,
  countryName,
  placeName,
  lat,
  lng,
  size,
  onOpen,
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
  onOpen: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const shape = useCountryShape(countryCode);
  const drawing = useMemo(() => {
    const p = shape && project(shape, lat, lng);
    if (!p) return null;
    const inner = size - (size >= 96 ? 22 : 14);
    const scale = inner / Math.max(p.w, p.h);
    const ox = (size - p.w * scale) / 2;
    const oy = (size - p.h * scale) / 2 - (size >= 96 ? 4 : 0);
    const px = (x: number) => ox + p.px(x) * scale;
    const py = (y: number) => oy + p.py(y) * scale;
    return { d: pathOf(p.rings, px, py), dot: { x: ox + p.dot.x * scale, y: oy + p.dot.y * scale } };
  }, [shape, lat, lng, size]);

  if (!shape || !drawing) return null;
  const big = size >= 96;
  const country = countryName ?? shape.name;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Where ${placeName ?? "it"} is in ${country} - open the map of ${country}`}
      title={`Where ${placeName ?? "it"} is in ${country} - tap to see the whole country`}
      style={{ width: size, height: size, ...style }}
      className={cn(
        "group relative block overflow-hidden rounded-xl bg-surface/90 shadow-card ring-1 ring-black/5 backdrop-blur-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg motion-safe:animate-fade-in",
        className
      )}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden className="block">
        <path d={drawing.d} fillRule="evenodd" fill="#EAE2D6" stroke="#BFAE97" strokeWidth={0.7} strokeLinejoin="round" />
        {/* The place: a soft pulse, a halo, the dot. */}
        <circle cx={drawing.dot.x} cy={drawing.dot.y} r={big ? 4 : 3} fill="#BA7517" className="locator-pulse" />
        <circle cx={drawing.dot.x} cy={drawing.dot.y} r={big ? 6.5 : 5} fill="#BA7517" opacity={0.18} />
        <circle cx={drawing.dot.x} cy={drawing.dot.y} r={big ? 3.4 : 2.6} fill="#BA7517" stroke="#FFFFFF" strokeWidth={1.4} />
      </svg>
      {big && (
        <span className="absolute inset-x-0 bottom-1.5 truncate px-2 text-center font-serif text-[11px] leading-none text-ink-700">{country}</span>
      )}
    </button>
  );
}

/** A square in the map's bottom-left corner: `left` and `bottom` px from
 *  the map's edges, `size` px a side. */
export interface CornerBox {
  left: number;
  bottom: number;
  size: number;
}

/**
 * The country over the whole map (2026-11-16, owner: "the borders of this
 * pop up expand to then take the place of the map ... the button on the
 * right disappear, and the mini map on the left become the one of the
 * city"). It grows out of the corner square on the map's own curve, the
 * country scaling with it; the city's map waits in the corner as a small
 * square (`cityShot`, a picture of the map as it was). A tap on it, on the
 * country, or Escape, and it all goes back the same way - `onClosed` once
 * it's back in its square.
 */
export function CountryTakeover({
  countryCode,
  countryName,
  placeName,
  lat,
  lng,
  from,
  corner,
  freeLeft = 0,
  cityShot,
  onClosed,
}: {
  countryCode: string;
  countryName?: string;
  placeName?: string;
  lat: number;
  lng: number;
  /** The square it grows out of (the locator's, when tapped). */
  from: CornerBox;
  /** Where the city waits, and where the country goes back to. */
  corner: CornerBox;
  /** Px on the left the map's own panels cover (a computer's place
   *  column): the country is drawn in the room right of it. */
  freeLeft?: number;
  /** The city's map, as an image; null while it's being taken, or if the
   *  map couldn't give one (the place's name stands in). */
  cityShot: string | null;
  onClosed: () => void;
}) {
  const shape = useCountryShape(countryCode);
  const boxRef = useRef<HTMLButtonElement | null>(null);
  const closingRef = useRef(false);
  const [cityShown, setCityShown] = useState(false);
  const country = countryName ?? shape?.name ?? "";

  // Drawn once in degrees; the SVG scales it to the box as the box grows.
  const drawing = useMemo(() => {
    const p = shape && project(shape, lat, lng);
    if (!p) return null;
    return { d: pathOf(p.rings, p.px, p.py), w: p.w, h: p.h, dot: p.dot };
  }, [shape, lat, lng]);

  const square = (b: CornerBox): Keyframe => ({ left: `${b.left}px`, bottom: `${b.bottom}px`, width: `${b.size}px`, height: `${b.size}px`, borderRadius: "12px" });
  const FULL: Keyframe = { left: "0px", bottom: "0px", width: "100%", height: "100%", borderRadius: "0px" };

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || prefersReducedMotion()) {
      setCityShown(true);
      return;
    }
    const grow = box.animate([square(from), FULL], { duration: MOTION_MS, easing: MOTION_CSS });
    // The city and the name come in halfway - counted from when the growth
    // really starts (its first frame).
    let later = 0;
    grow.ready.then(() => {
      later = window.setTimeout(() => setCityShown(true), MOTION_MS * 0.45);
    }, () => undefined);
    return () => {
      grow.cancel();
      window.clearTimeout(later);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setCityShown(false);
    const box = boxRef.current;
    if (!box || prefersReducedMotion()) {
      onClosed();
      return;
    }
    box.animate([FULL, square(corner)], { duration: Math.round(MOTION_MS * 0.85), easing: MOTION_CSS, fill: "forwards" }).finished.then(onClosed, onClosed);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  // Escape goes back to the map (before the page's Escape, which would
  // shrink it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const back = `Back to the map${placeName ? ` of ${placeName}` : ""}`;
  return (
    <>
      <button
        ref={boxRef}
        type="button"
        onClick={close}
        aria-label={back}
        title={back}
        className="pointer-events-auto absolute overflow-hidden bg-surface shadow-card ring-1 ring-black/5"
        style={{ left: 0, bottom: 0, width: "100%", height: "100%" }}
      >
        {drawing && (
          <span className="absolute" style={{ left: `calc(${freeLeft}px + 7%)`, right: "7%", top: "calc(5% + 24px)", bottom: "calc(5% + 12px)" }}>
            <svg viewBox={`0 0 ${drawing.w} ${drawing.h}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-hidden className="block overflow-visible">
              <path d={drawing.d} fillRule="evenodd" fill="#EAE2D6" stroke="#BFAE97" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              {/* The place: zero-length strokes with round ends - dots that
               *  keep their size in pixels while the country grows. */}
              {(
                [
                  [26, 0.45, "takeover-pulse"],
                  [24, 0.18, ""],
                  [12, 1, "white"],
                  [8.5, 1, ""],
                ] as const
              ).map(([width, opacity, kind], i) => (
                <path
                  key={i}
                  d={`M${drawing.dot.x} ${drawing.dot.y}h0`}
                  stroke={kind === "white" ? "#FFFFFF" : "#BA7517"}
                  strokeOpacity={opacity}
                  strokeWidth={width}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className={kind === "takeover-pulse" ? "takeover-pulse" : undefined}
                />
              ))}
            </svg>
          </span>
        )}
        {/* At the top, clear of the map's credit line; in once the box is
         *  big enough for it. */}
        <span
          className={cn(
            "absolute right-0 top-3 truncate px-3 text-center font-serif text-[14px] leading-tight text-ink-700 transition-opacity duration-300",
            cityShown ? "opacity-100" : "opacity-0"
          )}
          style={{ left: freeLeft }}
        >
          {placeName ? `${placeName}, ${country}` : country}
        </span>
      </button>
      {/* The city, waiting in the corner. */}
      <button
        type="button"
        onClick={close}
        aria-label={back}
        title={back}
        className={cn(
          "pointer-events-auto absolute overflow-hidden rounded-xl bg-surface-muted shadow-card ring-2 ring-white transition-[opacity,transform] duration-300 ease-out hover:-translate-y-0.5",
          cityShown ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-90"
        )}
        style={{ left: corner.left, bottom: corner.bottom, width: corner.size, height: corner.size, transformOrigin: "0% 100%" }}
      >
        {cityShot ? (
          // eslint-disable-next-line @next/next/no-img-element -- a picture of our own map
          <img src={cityShot} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-1 text-center font-serif text-[11px] leading-tight text-ink-700">{placeName ?? "Map"}</span>
        )}
        {cityShot && corner.size >= 96 && placeName && (
          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-4 text-center font-serif text-[11px] leading-none text-white">
            {placeName}
          </span>
        )}
      </button>
    </>
  );
}
