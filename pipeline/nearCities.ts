import { writeFileSync } from "fs";
import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { WORK_DIR } from "./util";

/** "What's within X km of each city" aggregations, run inside DuckDB so
 *  millions of points (restaurants, Speedtest tiles) never enter
 *  JavaScript. Points are bucketed into 0.05° cells; each city is joined
 *  only against the cells its radius can reach, then filtered by exact
 *  great-circle distance. */

const CELL = 0.05;

type Connection = Awaited<ReturnType<DuckDBInstance["connect"]>>;

async function prepare(cities: { lat: number; lng: number }[], radiusKm: number, pointsSql: string): Promise<Connection> {
  const con = await (await DuckDBInstance.create(":memory:")).connect();
  const citiesFile = path.join(WORK_DIR, "cities-for-counting.csv").split(path.sep).join("/");
  writeFileSync(citiesFile, "i,lat,lng\n" + cities.map((c, i) => `${i},${c.lat},${c.lng}`).join("\n"));
  await con.run(`CREATE TABLE cities AS SELECT * FROM read_csv('${citiesFile}', header=true, columns={'i':'INTEGER','lat':'DOUBLE','lng':'DOUBLE'})`);
  await con.run(`
    CREATE TABLE pts AS
    SELECT *, floor(lat / ${CELL})::INTEGER AS cy, floor(lng / ${CELL})::INTEGER AS cx
    FROM (${pointsSql}) WHERE lat IS NOT NULL AND lng IS NOT NULL`);
  // Every cell each city's radius can touch (wider in longitude away from
  // the equator, where a degree of longitude covers less ground).
  await con.run(`
    CREATE TABLE city_cells AS
    SELECT i, lat, lng, cy, cx FROM (
      SELECT i, lat, lng,
        unnest(range(floor((lat - ${radiusKm / 111}) / ${CELL})::INTEGER, floor((lat + ${radiusKm / 111}) / ${CELL})::INTEGER + 1)) AS cy,
        floor((lng - ${radiusKm} / (111 * greatest(cos(radians(lat)), 0.05))) / ${CELL})::INTEGER AS cx0,
        floor((lng + ${radiusKm} / (111 * greatest(cos(radians(lat)), 0.05))) / ${CELL})::INTEGER AS cx1
      FROM cities
    ) t, LATERAL (SELECT unnest(range(t.cx0, t.cx1 + 1)) AS cx)`);
  return con;
}

const WITHIN = (radiusKm: number) => `
  2 * 6371 * asin(sqrt(
    pow(sin(radians(p.lat - c.lat) / 2), 2) +
    cos(radians(c.lat)) * cos(radians(p.lat)) * pow(sin(radians(p.lng - c.lng) / 2), 2)
  )) <= ${radiusKm}`;

/** Per-city counts of each category within `radiusKm`. `pointsSql` must
 *  yield columns cat, lat, lng. */
export async function countNearCities(
  pointsSql: string,
  cities: { lat: number; lng: number }[],
  radiusKm: number
): Promise<Map<number, Map<number, number>>> {
  const con = await prepare(cities, radiusKm, pointsSql);
  const reader = await con.runAndReadAll(`
    SELECT c.i, p.cat, count(*) AS n
    FROM city_cells c JOIN pts p ON p.cy = c.cy AND p.cx = c.cx
    WHERE ${WITHIN(radiusKm)}
    GROUP BY c.i, p.cat`);
  const out = new Map<number, Map<number, number>>();
  for (const [i, cat, n] of reader.getRows()) {
    const idx = Number(i);
    if (!out.has(idx)) out.set(idx, new Map());
    out.get(idx)!.set(Number(cat), Number(n));
  }
  return out;
}

/** Per-city weighted mean of `v` (weighted by `w`) over points within
 *  `radiusKm`, or null where the total weight is under `minWeight`.
 *  `pointsSql` must yield columns lat, lng, v, w. */
export async function weightedMeanNearCities(
  pointsSql: string,
  cities: { lat: number; lng: number }[],
  radiusKm: number,
  minWeight: number
): Promise<(number | null)[]> {
  const con = await prepare(cities, radiusKm, pointsSql);
  const reader = await con.runAndReadAll(`
    SELECT c.i, sum(p.v * p.w) / sum(p.w) AS mean, sum(p.w) AS weight
    FROM city_cells c JOIN pts p ON p.cy = c.cy AND p.cx = c.cx
    WHERE ${WITHIN(radiusKm)}
    GROUP BY c.i`);
  const out: (number | null)[] = cities.map(() => null);
  for (const [i, mean, weight] of reader.getRows()) {
    if (Number(weight) >= minWeight) out[Number(i)] = Number(mean);
  }
  return out;
}
