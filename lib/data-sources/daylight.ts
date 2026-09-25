/**
 * Day length (sunrise-to-sunset hours) — pure astronomy, not a data
 * source in the usual sense: computed directly from latitude and the
 * calendar date, no API call, no external dependency, always available
 * for any coordinate on Earth.
 *
 * Averaged over a full year every location gets almost exactly 12 hours
 * of daylight (orbital mechanics) - a flat "avg annual daylight" field
 * would barely differentiate any two cities. What actually differs city
 * to city is the SEASONAL SWING: longestDayHours/shortestDayHours (the
 * summer/winter solstice day length) - London ~16.5h/~8h, Singapore
 * ~12h/~12h, Oslo ~18.8h/~6h.
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Day length in hours for latitude `lat` on year-day `dayOfYear`
 *  (1-365), via the standard solar-declination/hour-angle formula.
 *  Clamped to [0, 24] for polar day/night, where the raw formula's
 *  arccos argument falls outside [-1, 1]. */
function dayLengthHours(lat: number, dayOfYear: number): number {
  const declinationDeg = -23.44 * Math.cos(((360 / 365) * (dayOfYear + 10)) * DEG_TO_RAD);
  const latRad = lat * DEG_TO_RAD;
  const declRad = declinationDeg * DEG_TO_RAD;
  const cosHourAngle = -Math.tan(latRad) * Math.tan(declRad);

  if (cosHourAngle >= 1) return 0; // polar night
  if (cosHourAngle <= -1) return 24; // polar day

  const hourAngleDeg = Math.acos(cosHourAngle) * RAD_TO_DEG;
  return (2 * hourAngleDeg) / 15; // 15 degrees of hour angle per hour
}

export interface DaylightRange {
  longestDayHours: number;
  shortestDayHours: number;
}

/** June solstice (day 172) and December solstice (day 355) bracket every
 *  location's longest/shortest day, whichever hemisphere it's in - no
 *  separate north/south branching needed, just take the max/min of the
 *  two. */
export function getDaylightRange(lat: number): DaylightRange {
  const juneSolstice = dayLengthHours(lat, 172);
  const decemberSolstice = dayLengthHours(lat, 355);
  return {
    longestDayHours: Number(Math.max(juneSolstice, decemberSolstice).toFixed(1)),
    shortestDayHours: Number(Math.min(juneSolstice, decemberSolstice).toFixed(1)),
  };
}
