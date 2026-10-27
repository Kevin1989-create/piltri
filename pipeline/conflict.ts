import path from "path";
import KDBush from "kdbush";
import { around } from "geokdbush";
import { DuckDBInstance } from "@duckdb/node-api";
import { downloadOnce, log, unzipOnce, WORK_DIR } from "./util";

/**
 * Armed conflict near each city (2026-10-24, phase 1 of local data): the
 * deadly events of organised violence - state-based conflict, non-state
 * conflict and one-sided violence against civilians - within CONFLICT_KM
 * over the last CONFLICT_YEARS full years, from the Uppsala Conflict Data
 * Program's Georeferenced Event Dataset (UCDP GED, CC BY 4.0). Real,
 * individually sourced events, not a risk model. Only events placed to
 * within about 25 km or a district (where_prec 1-3); those known only to
 * a province or country can't be put near a city.
 */
const GED_VERSION = "261";
export const CONFLICT_KM = 50;
export const CONFLICT_YEARS = 5;
/** The last full year GED 26.1 covers. */
const LAST_YEAR = 2025;
export const CONFLICT_FIRST_YEAR = LAST_YEAR - CONFLICT_YEARS + 1;
export const CONFLICT_LAST_YEAR = LAST_YEAR;

export const CONFLICT_SOURCE = `UCDP Georeferenced Event Dataset ${GED_VERSION.slice(0, 2)}.${GED_VERSION.slice(2)} (Uppsala Conflict Data Program, CC BY 4.0) - deadly events of organised violence ${CONFLICT_FIRST_YEAR}-${LAST_YEAR}, placed to within ~25 km or a district`;

export async function sampleConflict(points: { lat: number; lng: number }[]): Promise<{ events: number[]; deaths: number[] }> {
  const zip = await downloadOnce(`https://ucdp.uu.se/downloads/ged/ged${GED_VERSION}-csv.zip`, `ged${GED_VERSION}-csv.zip`);
  const dir = path.join(WORK_DIR, `ucdp-ged${GED_VERSION}`);
  const csv = `GEDEvent_v${GED_VERSION.slice(0, 2)}_${GED_VERSION.slice(2)}.csv`;
  unzipOnce(zip, dir, csv);
  const con = await (await DuckDBInstance.create(":memory:")).connect();
  const file = path.join(dir, csv).split(path.sep).join("/");
  const rows = (
    await con.runAndReadAll(`
      SELECT latitude::DOUBLE, longitude::DOUBLE, best::INTEGER
      FROM read_csv('${file}', header=true, all_varchar=true)
      WHERE year::INTEGER BETWEEN ${CONFLICT_FIRST_YEAR} AND ${LAST_YEAR}
        AND where_prec::INTEGER <= 3 AND best::INTEGER > 0`)
  ).getRows();
  const kd = new KDBush(Math.max(rows.length, 1));
  for (const r of rows) kd.add(Number(r[1]), Number(r[0]));
  if (!rows.length) kd.add(0, -89.999);
  kd.finish();
  const events: number[] = [];
  const deaths: number[] = [];
  for (const { lat, lng } of points) {
    // around() measures great-circle distance.
    const ids = rows.length ? (around(kd, lng, lat, Infinity, CONFLICT_KM) as number[]) : [];
    events.push(ids.length);
    deaths.push(ids.reduce((sum, id) => sum + Number(rows[id][2]), 0));
  }
  log("conflict", `${rows.length} located deadly events ${CONFLICT_FIRST_YEAR}-${LAST_YEAR}; ${events.filter((n) => n > 0).length} of ${points.length} places have one within ${CONFLICT_KM} km`);
  return { events, deaths };
}
