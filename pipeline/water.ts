import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { WATER_STRESS_ARID } from "@/lib/dataset/schema";
import { cached, downloadOnce, log, pointsKey, WORK_DIR } from "./util";

/**
 * Water for each place (2026-11-07, owner): how much of the water renewed
 * each year is used, and whether the groundwater (the water table) is
 * falling - for the river basin, and the aquifer, the place is in. From
 * WRI's Aqueduct 4.0 (CC BY 4.0), modelled from rainfall, river flows and
 * water use: ~68,500 areas, the world's 16,400 river basins cut by
 * provinces and aquifers (median 370 km²). A fixed release (2023), so the
 * download is cached between refreshes.
 */
export const WATER_SOURCE =
  "WRI Aqueduct 4.0 (World Resources Institute, 2023, CC BY 4.0) - baseline water stress and groundwater table decline, for the river basin and aquifer";

const ZIP_URL = "https://files.wri.org/aqueduct/aqueduct-4-0-water-risk-data.zip";
const RELEASE = "Aqueduct40_waterrisk_download_Y2023M07D05";
const GDB = `${RELEASE}/GDB/Aq40_Y2023D07M05.gdb`;

export async function sampleWater(points: { lat: number; lng: number }[]): Promise<{ stressPct: (number | null)[]; groundwaterCmYr: (number | null)[] }> {
  return cached(`water-aqueduct40-${pointsKey(points)}`, async () => {
    const zip = await downloadOnce(ZIP_URL, "aqueduct-4.0/aqueduct-4-0-water-risk-data.zip");
    const dir = path.join(WORK_DIR, "aqueduct-4.0");
    // The geodatabase only (the CSVs repeat it without the shapes).
    if (!existsSync(path.join(dir, GDB))) {
      log("unzip", `${path.basename(zip)} -> ${dir}`);
      execSync(`unzip -o -q "${zip}" -x "*/CVS/*" -d "${dir}"`, { stdio: "inherit" });
    }
    const con = await (await DuckDBInstance.create(":memory:")).connect();
    await con.run("INSTALL spatial; LOAD spatial;");
    const gdb = path.join(dir, GDB).split(path.sep).join("/");
    // Each area with its bounding box, and the 1° cells the box covers: a
    // place is only tested against the few areas whose box holds it (66 s,
    // where a plain spatial join took hours).
    await con.run(`
      CREATE TABLE aq AS
      SELECT row_number() OVER () AS id, bws_raw, bws_cat, gtd_raw, gtd_cat, Shape AS geom,
             ST_XMin(Shape) AS minx, ST_XMax(Shape) AS maxx, ST_YMin(Shape) AS miny, ST_YMax(Shape) AS maxy
      FROM ST_Read('${gdb}') WHERE Shape IS NOT NULL AND NOT ST_IsEmpty(Shape)`);
    await con.run(`
      CREATE TABLE cells AS
      SELECT id, cx, cy FROM (
        SELECT id, unnest(range(floor(minx)::INT, floor(maxx)::INT + 1)) AS cx, miny, maxy FROM aq
      ), LATERAL (SELECT unnest(range(floor(miny)::INT, floor(maxy)::INT + 1)) AS cy)`);
    await con.run("CREATE TABLE pts (idx INTEGER, lng DOUBLE, lat DOUBLE)");
    const appender = await con.createAppender("pts");
    points.forEach((p, i) => {
      appender.appendInteger(i);
      appender.appendDouble(p.lng);
      appender.appendDouble(p.lat);
      appender.endRow();
    });
    appender.closeSync();
    const rows = (
      await con.runAndReadAll(`
        SELECT p.idx, any_value(a.bws_raw), any_value(a.bws_cat), any_value(a.gtd_raw), any_value(a.gtd_cat)
        FROM pts p
        JOIN cells c ON c.cx = floor(p.lng)::INT AND c.cy = floor(p.lat)::INT
        JOIN aq a ON a.id = c.id
        WHERE p.lng BETWEEN a.minx AND a.maxx AND p.lat BETWEEN a.miny AND a.maxy AND ST_Intersects(a.geom, ST_Point(p.lng, p.lat))
        GROUP BY p.idx`)
    ).getRows();
    const stressPct: (number | null)[] = points.map(() => null);
    const groundwaterCmYr: (number | null)[] = points.map(() => null);
    for (const [idx, bwsRaw, bwsCat, gtdRaw, gtdCat] of rows as [number, number, number, number, number][]) {
      // Water stress: the share used, % (over 100% where more is drawn than
      // renewed, capped at 999); "arid and low water use" its own marker;
      // WRI's "no data" left as null.
      stressPct[idx] = bwsCat === -9999 ? null : bwsCat === -1 ? WATER_STRESS_ARID : Math.round(Math.min(bwsRaw, 9.99) * 1000) / 10;
      // Groundwater: cm a year the water table falls (negative: rises);
      // WRI's "insignificant trend" is stable, 0.
      groundwaterCmYr[idx] = gtdCat === -9999 ? 0 : Math.round(gtdRaw * 10) / 10;
    }
    log("water", `${rows.length} of ${points.length} places in an Aqueduct area`);
    return { stressPct, groundwaterCmYr };
  });
}
