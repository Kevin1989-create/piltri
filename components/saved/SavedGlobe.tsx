"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { geoArea, geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { HeartIcon } from "@/components/ui/icons";
import { CloseButton } from "@/components/ui/CloseButton";
import { prefersReducedMotion } from "@/lib/motion";

export interface GlobePoint {
  key: string;
  kind: "place" | "spot";
  lat: number;
  lng: number;
  title: string;
  subtitle: string;
  href: string;
}

type World = { type: "FeatureCollection"; features: { type: "Feature"; geometry: { type: "MultiPolygon"; coordinates: number[][][][] } }[] };
let worldPromise: Promise<World | null> | null = null;
function loadWorld(): Promise<World | null> {
  worldPromise ??= fetch("/geo/world.json")
    .then((r) => (r.ok ? (r.json() as Promise<World>) : null))
    .then((world) => {
      // d3 reads a ring's direction to know which side is inside: any
      // island or mainland that came out covering the rest of the globe
      // is turned round (each one on its own - a country can have both).
      for (const f of world?.features ?? []) {
        f.geometry.coordinates = f.geometry.coordinates.map((poly) =>
          geoArea({ type: "Polygon", coordinates: poly } as GeoPermissibleObjects) > 2 * Math.PI ? poly.map((ring) => [...ring].reverse()) : poly
        );
      }
      return world;
    })
    .catch(() => null);
  return worldPromise;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 9;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The Saved page's globe (2026-11-08, owner: "a beautiful 3D world map
 * super nice looking and easy to use, zoom in and out"): the world in
 * Piltri's colours - warm paper land on a soft cream sea, a faint amber
 * glow around it - with each saved place a pulsing amber point and each
 * spot a smaller one. Drag to turn it (it keeps turning a little, then
 * settles), scroll or pinch to zoom, tap a point for its card; left alone
 * it turns slowly. Drawn on a canvas with d3-geo's orthographic
 * projection - no map service involved.
 */
export function SavedGlobe({ points, focusKey }: { points: GlobePoint[]; focusKey?: string | null }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [selected, setSelected] = useState<GlobePoint | null>(null);
  const [cardAt, setCardAt] = useState<{ x: number; y: number } | null>(null);
  // Camera and motion, outside React: [longitude, latitude] in front, zoom.
  const view = useRef({ lng: 10, lat: 25, zoom: 1, vLng: 0, vLat: 0, lastTouch: 0, tween: null as null | { from: [number, number, number]; to: [number, number, number]; start: number; ms: number } });
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const selectedRef = useRef<GlobePoint | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    loadWorld().then(setWorld);
  }, []);

  /** Turns (and zooms) to a point, gently. */
  const flyTo = (lng: number, lat: number, zoom: number, ms = 1100) => {
    const v = view.current;
    v.vLng = v.vLat = 0;
    v.tween = { from: [v.lng, v.lat, v.zoom], to: [lng, lat, zoom], start: performance.now(), ms: prefersReducedMotion() ? 0 : ms };
    v.lastTouch = performance.now();
  };

  // Start over the saved places' middle; a point chosen in the list flies.
  const firstFrameRef = useRef(true);
  useEffect(() => {
    if (!points.length || !firstFrameRef.current) return;
    firstFrameRef.current = false;
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const x = points.reduce((s, p) => s + Math.cos((p.lng * Math.PI) / 180), 0);
    const y = points.reduce((s, p) => s + Math.sin((p.lng * Math.PI) / 180), 0);
    Object.assign(view.current, { lng: (Math.atan2(y, x) * 180) / Math.PI, lat: Math.max(-50, Math.min(55, lat)) });
  }, [points]);
  useEffect(() => {
    // (A trailing "#": the same one chosen again - fly back to it.)
    const p = focusKey ? points.find((q) => q.key === focusKey.replace(/#$/, "")) : undefined;
    if (!p) return;
    setSelected(p);
    flyTo(p.lng, p.lat, Math.max(view.current.zoom, 3.2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;
    const ctx = canvas.getContext("2d")!;
    const projection = geoOrthographic().clipAngle(90).precision(0.4);
    const path = geoPath(projection, ctx);
    const graticule = geoGraticule10();
    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const r = box.getBoundingClientRect();
      w = r.width;
      h = r.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);

    const still = prefersReducedMotion();
    let frame = 0;
    const draw = (now: number) => {
      const v = view.current;
      // Motion: a tween, else the throw's glide, else a slow idle turn.
      if (v.tween) {
        const t = v.tween.ms ? Math.min(1, (now - v.tween.start) / v.tween.ms) : 1;
        const k = ease(t);
        const [lng, lat] = geoInterpolate([v.tween.from[0], v.tween.from[1]], [v.tween.to[0], v.tween.to[1]])(k);
        v.lng = lng;
        v.lat = lat;
        v.zoom = v.tween.from[2] + (v.tween.to[2] - v.tween.from[2]) * k;
        if (t >= 1) v.tween = null;
      } else if (Math.abs(v.vLng) > 0.002 || Math.abs(v.vLat) > 0.002) {
        v.lng += v.vLng;
        v.lat = Math.max(-80, Math.min(80, v.lat + v.vLat));
        v.vLng *= 0.94;
        v.vLat *= 0.94;
      } else if (!still && !selectedRef.current && now - v.lastTouch > 2500) {
        v.lng += 0.035;
      }
      const base = Math.min(w, h) * 0.42;
      const scale = base * v.zoom;
      projection.scale(scale).translate([w / 2, h / 2]).rotate([-v.lng, -v.lat]);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      // The glow around the globe, then the sea with light from top left.
      const glow = ctx.createRadialGradient(cx, cy, scale * 0.96, cx, cy, scale * 1.18);
      glow.addColorStop(0, "rgba(186,117,23,0.16)");
      glow.addColorStop(1, "rgba(186,117,23,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, scale * 1.18, 0, Math.PI * 2);
      ctx.fill();
      // A soft slate sea (the city maps' water, quietened), lit from the
      // top left; warm paper land with fine borders.
      const sea = ctx.createRadialGradient(cx - scale * 0.35, cy - scale * 0.4, scale * 0.1, cx, cy, scale);
      sea.addColorStop(0, "#EDF2F3");
      sea.addColorStop(0.65, "#D9E2E5");
      sea.addColorStop(1, "#C3CFD4");
      ctx.fillStyle = sea;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fill();
      ctx.beginPath();
      path(graticule);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
      if (world) {
        ctx.beginPath();
        path(world as unknown as GeoPermissibleObjects);
        ctx.fillStyle = "#FBF6EE";
        ctx.fill();
        ctx.strokeStyle = "rgba(170,140,105,0.55)";
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.strokeStyle = "rgba(150,115,80,0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // The saved points on the near side; the chosen one's card follows it.
      const front: [number, number] = [v.lng, v.lat];
      const pulse = still ? 0 : (now % 2400) / 2400;
      const sel = selectedRef.current;
      let selXY: { x: number; y: number } | null = null;
      // Labels already drawn: one that would cover another is left out
      // (the chosen one first, then places before spots).
      const labelled: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const ordered = [...pointsRef.current].sort((a, b) => Number(b.key === sel?.key) - Number(a.key === sel?.key) || (a.kind === b.kind ? 0 : a.kind === "place" ? -1 : 1));
      for (const p of ordered) {
        if (geoDistance([p.lng, p.lat], front) > Math.PI / 2 - 0.02) continue;
        const xy = projection([p.lng, p.lat]);
        if (!xy) continue;
        const [x, y] = xy;
        const place = p.kind === "place";
        const r = place ? 4.6 : 3.2;
        if (place && pulse) {
          ctx.beginPath();
          ctx.arc(x, y, r + pulse * 12, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(186,117,23,${0.32 * (1 - pulse)})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, r + 1.6, 0, Math.PI * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = place ? "#BA7517" : "#7A4A0E";
        ctx.fill();
        if (sel?.key === p.key) selXY = { x, y };
        // Names once close enough to read them.
        if (v.zoom >= 2.4 || sel?.key === p.key) {
          ctx.font = `${place ? 600 : 500} 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif`;
          const box = { x0: x + r + 3, y0: y - 8, x1: x + r + 7 + ctx.measureText(p.title).width, y1: y + 7 };
          if (!labelled.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
            labelled.push(box);
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(255,252,247,0.95)";
            ctx.strokeText(p.title, x + r + 5, y + 4);
            ctx.fillStyle = "#2B241D";
            ctx.fillText(p.title, x + r + 5, y + 4);
          }
        }
      }
      setCardAt((prev) => (selXY ? (prev && Math.abs(prev.x - selXY.x) < 0.5 && Math.abs(prev.y - selXY.y) < 0.5 ? prev : selXY) : prev ? null : prev));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    // Drag to turn (with a throw), wheel and pinch to zoom, tap a point.
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchFrom = 0;
    let zoomFrom = 1;
    let moved = 0;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = view.current;
      v.tween = null;
      v.vLng = v.vLat = 0;
      v.lastTouch = performance.now();
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchFrom = Math.hypot(a.x - b.x, a.y - b.y);
        zoomFrom = v.zoom;
      }
    };
    const onMove = (e: PointerEvent) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const v = view.current;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      v.lastTouch = performance.now();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        v.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomFrom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(pinchFrom, 1))));
        return;
      }
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      const degPerPx = 180 / (Math.PI * Math.min(w, h) * 0.42 * v.zoom);
      v.vLng = -dx * degPerPx;
      v.vLat = dy * degPerPx;
      v.lng += v.vLng;
      v.lat = Math.max(-80, Math.min(80, v.lat + v.vLat));
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (moved < 6 && pointers.size === 0) {
        // A tap: the nearest point within reach.
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const front: [number, number] = [view.current.lng, view.current.lat];
        let best: GlobePoint | null = null;
        let bestD = 18;
        for (const p of pointsRef.current) {
          if (geoDistance([p.lng, p.lat], front) > Math.PI / 2 - 0.02) continue;
          const xy = projection([p.lng, p.lat]);
          if (!xy) continue;
          const d = Math.hypot(xy[0] - x, xy[1] - y);
          if (d < bestD) [best, bestD] = [p, d];
        }
        setSelected(best);
        if (best) flyTo(best.lng, best.lat, Math.max(view.current.zoom, 2.6), 800);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      v.tween = null;
      v.lastTouch = performance.now();
      v.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * Math.exp(-e.deltaY * 0.0016)));
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [world]);

  const zoomBy = (factor: number) => {
    const v = view.current;
    flyTo(v.lng, v.lat, Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor)), 450);
  };

  return (
    <div ref={boxRef} className="relative h-full w-full touch-none select-none overflow-hidden">
      <canvas ref={canvasRef} className="block cursor-grab active:cursor-grabbing" aria-label="A globe of your saved places - drag to turn, scroll or pinch to zoom" />
      {/* Zoom, and back to the whole world. */}
      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg bg-surface/90 shadow-card ring-1 ring-black/5 backdrop-blur-sm">
        <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in" className="h-8 w-8 text-lg leading-none text-ink-700 hover:bg-surface-muted">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out" className="h-8 w-8 border-t border-surface-border text-lg leading-none text-ink-700 hover:bg-surface-muted">
          −
        </button>
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            flyTo(view.current.lng, 20, 1, 900);
          }}
          aria-label="The whole world"
          title="The whole world"
          className="flex h-8 w-8 items-center justify-center border-t border-surface-border text-ink-700 hover:bg-surface-muted"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5S9.4 5.9 12 3.5z" />
          </svg>
        </button>
      </div>
      {selected && cardAt && (
        // Centred under its point by the outer box; the inner one fades up
        // (an animation's transform would undo the centring).
        <div
          className="pointer-events-auto absolute z-10 w-56 -translate-x-1/2"
          style={{ left: Math.max(118, Math.min(cardAt.x, (boxRef.current?.clientWidth ?? 0) - 118)), top: cardAt.y + 14 }}
        >
          <div className="rounded-xl bg-surface p-3 shadow-card ring-1 ring-black/5 motion-safe:animate-fade-up">
          <div className="flex items-start gap-2">
            <HeartIcon className="mt-0.5 h-4 w-4 shrink-0 text-piltri-amber" fill="currentColor" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-serif text-base leading-tight text-ink-900 lining-nums">{selected.title}</p>
              <p className="truncate text-[11px] text-ink-500">{selected.subtitle}</p>
            </div>
            <CloseButton label="Close" onClick={() => setSelected(null)} className="-mr-1.5 -mt-1.5" />
          </div>
          <Link href={selected.href} className="mt-2 block rounded-pill bg-piltri-amber py-1.5 text-center text-xs font-medium text-white hover:bg-piltri-amber-dark">
            {selected.kind === "place" ? "Open the place" : "Open on the map"}
          </Link>
          </div>
        </div>
      )}
    </div>
  );
}
