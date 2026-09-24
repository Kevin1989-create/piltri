/**
 * Köppen-Geiger climate classification — computed directly from the same
 * trailing-365-day monthly temperature/precipitation breakdown
 * getClimateAverages already derives from Open-Meteo, not a separate data
 * source. No new external dependency, no static geospatial dataset to
 * download/maintain: Köppen classification is a deterministic formula over
 * 12 monthly means, so it's exactly as globally reliable as the app's
 * existing weather fields (see openmeteo.ts's own coverage verification).
 *
 * Standard formulation (main groups A/B/C/D/E, common precipitation-
 * seasonality and temperature subtypes) - reference: Peel, Finlayson &
 * McMahon (2007), "Updated world map of the Köppen-Geiger climate
 * classification", Hydrol. Earth Syst. Sci. Minor threshold variants exist
 * across sources; this follows the widely-used -3°C C/D boundary (the same
 * one the reference Beck et al. 2018 world map uses), not the older
 * original Köppen 0°C boundary.
 */

export const KOPPEN_LABELS: Record<string, string> = {
  Af: "Tropical rainforest",
  Am: "Tropical monsoon",
  Aw: "Tropical savanna",
  As: "Tropical savanna (dry summer)",
  BWh: "Hot desert",
  BWk: "Cold desert",
  BSh: "Hot semi-arid",
  BSk: "Cold semi-arid",
  Csa: "Mediterranean (hot summer)",
  Csb: "Mediterranean (warm summer)",
  Csc: "Mediterranean (cold summer)",
  Cwa: "Humid subtropical (dry winter)",
  Cwb: "Subtropical highland (dry winter)",
  Cwc: "Subtropical highland (dry winter, cold)",
  Cfa: "Humid subtropical",
  Cfb: "Temperate oceanic",
  Cfc: "Subpolar oceanic",
  Dsa: "Hot-summer humid continental (dry summer)",
  Dsb: "Warm-summer humid continental (dry summer)",
  Dsc: "Subarctic (dry summer)",
  Dsd: "Extreme subarctic (dry summer)",
  Dwa: "Hot-summer humid continental (dry winter)",
  Dwb: "Warm-summer humid continental (dry winter)",
  Dwc: "Subarctic (dry winter)",
  Dwd: "Extreme subarctic (dry winter)",
  Dfa: "Hot-summer humid continental",
  Dfb: "Warm-summer humid continental",
  Dfc: "Subarctic",
  Dfd: "Extreme subarctic",
  ET: "Tundra",
  EF: "Ice cap",
};

/** monthlyTemps/monthlyPrecip: 12 entries each, calendar-month order
 *  (index 0 = January), °C and mm respectively. `lat` decides which 6
 *  months count as "summer" (higher-sun half of the year) for the
 *  precipitation-seasonality subtype - Apr-Sep north of the equator,
 *  Oct-Mar south of it. Returns a Köppen code (e.g. "Cfb") or null if the
 *  input is incomplete (a genuine data gap, never guessed). */
export function classifyKoppen(monthlyTemps: (number | null)[], monthlyPrecip: (number | null)[], lat: number): string | null {
  if (monthlyTemps.length !== 12 || monthlyPrecip.length !== 12) return null;
  if (monthlyTemps.some((t) => t == null) || monthlyPrecip.some((p) => p == null)) return null;
  const T = monthlyTemps as number[];
  const P = monthlyPrecip as number[];

  const summerIdx = lat >= 0 ? [3, 4, 5, 6, 7, 8] : [0, 1, 2, 9, 10, 11];
  const winterIdx = lat >= 0 ? [0, 1, 2, 9, 10, 11] : [3, 4, 5, 6, 7, 8];

  const Tann = T.reduce((a, b) => a + b, 0) / 12;
  const Pann = P.reduce((a, b) => a + b, 0);
  const Tmax = Math.max(...T);
  const Tmin = Math.min(...T);
  const Pmin = Math.min(...P);

  const Psummer = summerIdx.reduce((s, i) => s + P[i], 0);
  const Pwinter = winterIdx.reduce((s, i) => s + P[i], 0);
  const PminSummer = Math.min(...summerIdx.map((i) => P[i]));
  const PmaxSummer = Math.max(...summerIdx.map((i) => P[i]));
  const PminWinter = Math.min(...winterIdx.map((i) => P[i]));
  const PmaxWinter = Math.max(...winterIdx.map((i) => P[i]));

  // ---- B: Arid (checked before A/C/D/E - an arid climate overrides what
  // its temperature profile alone would otherwise suggest) ----
  let Pthreshold: number;
  if (Psummer >= 0.7 * Pann) Pthreshold = 2 * Tann + 28;
  else if (Pwinter >= 0.7 * Pann) Pthreshold = 2 * Tann;
  else Pthreshold = 2 * Tann + 14;

  if (Pann < 10 * Pthreshold) {
    const desert = Pann < 5 * Pthreshold;
    const main = desert ? "BW" : "BS";
    const sub = Tann >= 18 ? "h" : "k";
    return main + sub;
  }

  // ---- E: Polar ----
  if (Tmax < 10) {
    return Tmax < 0 ? "EF" : "ET";
  }

  // ---- A: Tropical ----
  if (Tmin >= 18) {
    if (Pmin >= 60) return "Af";
    if (Pmin >= 100 - Pann / 25) return "Am";
    return "Aw";
  }

  // ---- C / D: Temperate / Continental ----
  const main = Tmin >= -3 ? "C" : "D";

  let seasonality: string;
  if (PminSummer < 40 && PminSummer < PmaxWinter / 3) seasonality = "s";
  else if (PminWinter < PmaxSummer / 10) seasonality = "w";
  else seasonality = "f";

  const monthsAbove10 = T.filter((t) => t >= 10).length;
  let tempSub: string;
  if (Tmax >= 22) tempSub = "a";
  else if (monthsAbove10 >= 4) tempSub = "b";
  else if (main === "D" && Tmin < -38) tempSub = "d";
  else tempSub = "c";

  return main + seasonality + tempSub;
}
