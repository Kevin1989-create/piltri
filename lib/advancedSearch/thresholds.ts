/**
 * What Advanced search's choices and the leaderboards' boards share, so a
 * filter and its board mean the same (2026-11-06, owner: "align"). Kept
 * apart from finder.ts, which reads the site's dataset manifest: the
 * pipeline works the boards out ahead of time with these too.
 */

/* ---- Size: the population column is in thousands. ---- */
export type SizeBand = "village" | "town" | "smallCity" | "city" | "big";
export const SIZE_BANDS: { key: SizeBand; label: string; hint: string; test: (k: number) => boolean }[] = [
  { key: "village", label: "Villages", hint: "under 10k", test: (k) => k < 10 },
  { key: "town", label: "Towns", hint: "10k-50k", test: (k) => k >= 10 && k < 50 },
  { key: "smallCity", label: "Small cities", hint: "50k-100k", test: (k) => k >= 50 && k < 100 },
  { key: "city", label: "Cities", hint: "100k-500k", test: (k) => k >= 100 && k < 500 },
  { key: "big", label: "Big cities", hint: "500k+", test: (k) => k >= 500 },
];

/** Eternal spring's highs and lows, a sunny year's hours, a beach's and
 *  mountains' distance. */
export const ETERNAL_SPRING = { maxHighC: 27, minLowC: 12 };
export const SUNNY_HOURS = 2500;
export const BEACH_KM = 10;
export const MOUNTAINS_KM = 30;
