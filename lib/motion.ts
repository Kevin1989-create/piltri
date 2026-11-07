/**
 * One motion for the map and what moves with it (2026-11-07, owner: "super
 * super smooth", the same whichever button): the map growing to fill the
 * screen and back, the camera framing the place, the panels stepping
 * aside. The curve is CSS's "ease" - MapLibre's own, the glide the city
 * page opens with, which the owner liked - and the camera and the boxes
 * share it, so they move as one.
 */
export const MOTION_MS = 700;
const BEZIER = [0.25, 0.1, 0.25, 1] as const;
export const MOTION_CSS = `cubic-bezier(${BEZIER.join(", ")})`;

/** A section opening or closing, the panels beside the column. */
export const QUICK_MS = 280;

/** The cubic-bezier curve as a function of time (0-1), for MapLibre's
 *  `easing` option: x(s) solved for s by Newton's method, then y(s). */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  const y = (s: number) => ((ay * s + by) * s + cy) * s;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = x(s) - t;
      if (Math.abs(err) < 1e-6) break;
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    return y(Math.min(1, Math.max(0, s)));
  };
}

export const motionEase = cubicBezier(...BEZIER);

/** No movement for people who ask their system for less. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A camera move's timing: MOTION_MS on the shared curve, or at once. */
export function cameraMotion(ms = MOTION_MS): { duration: number; easing: (t: number) => number } {
  return { duration: prefersReducedMotion() ? 0 : ms, easing: motionEase };
}
