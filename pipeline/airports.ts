import { readFileSync } from "fs";
import type { PointSet } from "./geonames";
import { downloadOnce, log } from "./util";

/**
 * Airports from OurAirports (ourairports.com, public domain), in two kinds
 * (2026-10-17, on request - GeoNames' "airports" include airfields and air
 * bases, and an airport 5 km away with no flights says little):
 *  - international: large airports, plus medium ones with scheduled
 *    flights named "International" (Internacional, Internazionale...);
 *  - local: every other airport with scheduled passenger flights.
 * Airfields, heliports and closed airports count as neither.
 */
export const AIRPORTS_SOURCE = "OurAirports (public domain) - international and other airports with scheduled flights";

const INTERNATIONAL = /internation|internacional|internazionale|internationaal|\bintl\b/i;

/** One CSV line into fields (quoted fields may hold commas and "" quotes). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function loadAirports(): Promise<{ international: PointSet; local: PointSet }> {
  // A fresh copy each month (the list changes slowly).
  const month = new Date().toISOString().slice(0, 7);
  const file = await downloadOnce("https://davidmegginson.github.io/ourairports-data/airports.csv", `ourairports-airports-${month}.csv`);
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const [type, name, lat, lng, scheduled] = ["type", "name", "latitude_deg", "longitude_deg", "scheduled_service"].map(col);
  const international: PointSet = { lng: [], lat: [], names: [] };
  const local: PointSet = { lng: [], lat: [], names: [] };
  for (const line of lines.slice(1)) {
    const r = parseCsvLine(line);
    const kind = r[type];
    const y = Number(r[lat]);
    const x = Number(r[lng]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const flights = r[scheduled] === "yes";
    const target =
      kind === "large_airport" || (kind === "medium_airport" && flights && INTERNATIONAL.test(r[name]))
        ? international
        : flights && (kind === "medium_airport" || kind === "small_airport")
          ? local
          : null;
    if (!target) continue;
    target.lng.push(x);
    target.lat.push(y);
    target.names.push(r[name]);
  }
  log("airports", `${international.lng.length} international, ${local.lng.length} local airports with scheduled flights`);
  return { international, local };
}
