import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { BOUNDARY_PRECISION, type EncodedBoundary } from "@/lib/dataset/schema";
import { extractParts, resolveOvertureRelease } from "./overture";
import { cached, log, pointsKey, WORK_DIR } from "./util";

/** City outlines for the map, from Overture Maps' divisions theme (place
 *  and administrative boundaries, mostly OpenStreetMap - ODbL). A city gets
 *  the polygon that carries its own name and contains its point (within
 *  ~1 km), minus any parts far away from it; if there's none - or it's
 *  implausibly small or large - it gets none, and the map draws the 5 km
 *  circle instead. Never a neighbouring town's outline. (London has none:
 *  OpenStreetMap maps the City of London and the boroughs, not "London".) */
export const BOUNDARY_SOURCE = "Overture Maps divisions (ODbL, from OpenStreetMap)";

/** "region" is last resort, for city-states mapped only at that level
 *  (Berlin, Tokyo, Vienna); MAX_KM2 keeps out same-name provinces (Madrid). */
const SUBTYPES = ["locality", "localadmin", "county", "macrohood", "neighborhood", "region"];
/** Among same-name candidates, the most city-like kind wins. */
const SUBTYPE_RANK = `CASE subtype WHEN 'locality' THEN 1 WHEN 'localadmin' THEN 2 WHEN 'county' THEN 3 WHEN 'macrohood' THEN 4 WHEN 'neighborhood' THEN 5 ELSE 6 END`;
const MIN_KM2 = 0.3;
const MAX_KM2 = 6000; // above this it's a province, not a city (Chongqing)
/** Parts of an outline further than this (degrees, ~50 km) from the city
 *  are dropped - Tokyo's Pacific islands, far-flung exclaves - so the map
 *  frames the city itself. */
const MAX_PART_DEG = 0.5;

/** Accent- and case-insensitive name, in any script, without the words
 *  that differ between sources: "City of" / "Greater" / "Ciudad de" /
 *  " City" / " Metropolitan Municipality" / " Municipal Corporation" /
 *  a trailing 市 ("Greater London" = "London", "City of Johannesburg
 *  Metropolitan Municipality" = "Johannesburg", 札幌市 = 札幌), as SQL.
 *  Not "District": a district is usually much bigger than its town. */
const coreName = (x: string) =>
  `regexp_replace(regexp_replace(trim(regexp_replace(lower(strip_accents(${x})), '[^\\p{L}\\p{N}]+', ' ', 'g')),
    '^(city of|greater|town of|municipality of|ciudad de|municipio de|ville de) | (city|town|municipality|metropolitan municipality|local municipality|municipal corporation|municipal council)$', '', 'g'),
    '市$', '')`;

/** A city and every name it's known by (GeoNames' name, ASCII name and
 *  alternate names). */
type City = { cityName: string; altNames?: string[]; countryCode: string; lat: number; lng: number };
type Con = Awaited<ReturnType<DuckDBInstance["connect"]>>;

/** pts: one row per city name variant; k is its core name (never empty). */
async function loadCities(con: Con, cities: City[]) {
  await con.run("CREATE OR REPLACE TABLE pts_raw (idx INTEGER, cc VARCHAR, name VARCHAR, lng DOUBLE, lat DOUBLE)");
  const appender = await con.createAppender("pts_raw");
  cities.forEach((c, i) => {
    for (const name of [c.cityName, ...(c.altNames ?? [])]) {
      appender.appendInteger(i);
      appender.appendVarchar(c.countryCode);
      appender.appendVarchar(name);
      appender.appendDouble(c.lng);
      appender.appendDouble(c.lat);
      appender.endRow();
    }
  });
  appender.closeSync();
  await con.run(`CREATE OR REPLACE TABLE pts AS
    SELECT DISTINCT idx, cc, lng, lat, k FROM (SELECT *, ${coreName("name")} AS k FROM pts_raw) WHERE k <> ''`);
}

function encodeRing(ring: number[][]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (const [lng, lat] of ring) {
    const x = Math.round(lng * BOUNDARY_PRECISION);
    const y = Math.round(lat * BOUNDARY_PRECISION);
    if (out.length && x === px && y === py) continue;
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

export function encodeGeoJson(json: string): EncodedBoundary | null {
  const geom = JSON.parse(json) as { type: string; coordinates: number[][][] | number[][][][] };
  const polygons = geom.type === "Polygon" ? [geom.coordinates as number[][][]] : geom.type === "MultiPolygon" ? (geom.coordinates as number[][][][]) : [];
  const encoded = polygons
    .map((rings) => rings.map(encodeRing).filter((ring) => ring.length >= 8)) // a ring needs 4+ points
    .filter((rings) => rings.length > 0);
  return encoded.length ? encoded : null;
}

/** One outline per city (aligned with `cities`), or null. */
export async function sampleBoundaries(cities: City[]): Promise<(EncodedBoundary | null)[]> {
  const release = await resolveOvertureRelease();
  const key = pointsKey(cities);
  return cached(`bounds-v3-${release}-${key}`, async () => {
    // Pass 1 (remote, resumable): only polygons whose name matches a city's
    // name in the same country - a few percent of the ~1M land divisions.
    const glob = await extractParts(release, {
      name: `bounds-v3-${key}`,
      source: "theme=divisions/type=division_area",
      setup: async (con) => {
        await loadCities(con, cities);
        await con.run("CREATE OR REPLACE TABLE wanted AS SELECT DISTINCT cc || '|' || k AS key FROM pts");
      },
      select: `country, subtype, ${coreName('names."primary"')} AS k1, ${coreName("names.common['en']")} AS k2, bbox, geometry`,
      where: `class = 'land' AND subtype IN (${SUBTYPES.map((s) => `'${s}'`).join(", ")})
        AND (country || '|' || ${coreName('names."primary"')} IN (SELECT key FROM wanted)
          OR country || '|' || ${coreName("names.common['en']")} IN (SELECT key FROM wanted))`,
    });

    const out = await chooseOutlines(glob, cities);
    log("bounds", `${out.filter(Boolean).length} of ${cities.length} cities have an outline (${release})`);
    return out;
  });
}

/** Pass 2 (local): the best candidate per city in an extract, simplified
 *  to ~100-300 points - plenty for an outline on a map.
 *
 *  Memory-lean by design (the GitHub runner has 16 GB, and the build holds
 *  a lot by this point - holding every candidate's geometry through one
 *  big query exhausted it): candidates are scored into small tables of
 *  numbers, and geometries are read back from the extract only to measure
 *  them and, at the end, for the ~40k winners. DuckDB is capped and spills
 *  to disk rather than taking the machine down. */
export async function chooseOutlines(glob: string, cities: City[]): Promise<(EncodedBoundary | null)[]> {
  const instance = await DuckDBInstance.create(":memory:", {
    memory_limit: "4GB",
    threads: "4",
    preserve_insertion_order: "false",
    temp_directory: path.join(WORK_DIR, "duckdb-tmp").replace(/\\/g, "/"),
  });
  const con = await instance.connect();
  await con.run("INSTALL spatial; LOAD spatial;");
  await loadCities(con, cities);
  const extract = `read_parquet('${glob}', filename = true, file_row_number = true)`;
  const byRow = (alias: string) => `JOIN ${extract} a ON a.filename = ${alias}.filename AND a.file_row_number = ${alias}.file_row_number`;
  // An outline minus parts far from its city (Tokyo's Pacific islands).
  await con.run(`CREATE MACRO near_parts(g, lng, lat) AS
    ST_Collect(list_transform(list_filter(ST_Dump(g), d -> ST_Distance(d.geom, ST_Point(lng, lat)) < ${MAX_PART_DEG}), d -> d.geom))`);
  // City-outline pairs by name, without touching the geometries: two
  // equality joins (fast hash joins) - a single join on "k1 = k OR k2 = k"
  // can't use a hash and grows with the square of the name variants (it
  // took hours).
  await con.run(`
    CREATE TABLE pairs AS
    SELECT DISTINCT idx, filename, file_row_number FROM (
      SELECT p.idx, p.lng, p.lat, a.* FROM (SELECT filename, file_row_number, country, k1, bbox FROM ${extract}) a JOIN pts p ON a.country = p.cc AND a.k1 = p.k
      UNION ALL
      SELECT p.idx, p.lng, p.lat, a.* FROM (SELECT filename, file_row_number, country, k2 AS k1, bbox FROM ${extract}) a JOIN pts p ON a.country = p.cc AND a.k1 = p.k
    )
    WHERE lng BETWEEN bbox.xmin - 0.02 AND bbox.xmax + 0.02 AND lat BETWEEN bbox.ymin - 0.02 AND bbox.ymax + 0.02`);
  await con.run("CREATE TABLE centres AS SELECT DISTINCT idx, lng, lat FROM pts");
  const count = async (table: string) => Number((await con.runAndReadAll(`SELECT count(*) FROM ${table}`)).getRows()[0][0]);
  log("bounds", `${await count("pairs")} name matches to check`);
  // Numbers only from here: which candidates contain their city (within
  // ~1 km), then their size once far-off parts are dropped.
  await con.run(`
    CREATE TABLE near AS
    SELECT pr.idx, pr.filename, pr.file_row_number, a.subtype, ST_Distance(a.geometry, ST_Point(c.lng, c.lat)) AS dist
    FROM pairs pr ${byRow("pr")} JOIN centres c ON c.idx = pr.idx`);
  await con.run("DELETE FROM near WHERE dist >= 0.01");
  log("bounds", `${await count("near")} contain their city; measuring them`);
  // ST_Area_Spheroid reads coordinates as lat/lng, hence the flip.
  await con.run(`
    CREATE TABLE sized AS
    SELECT n.*, ST_Area_Spheroid(ST_FlipCoordinates(near_parts(a.geometry, c.lng, c.lat))) / 1e6 AS km2
    FROM near n ${byRow("n")} JOIN centres c ON c.idx = n.idx`);
  await con.run(`
    CREATE TABLE best AS
    SELECT idx, filename, file_row_number FROM (
      SELECT *, row_number() OVER (PARTITION BY idx ORDER BY ${SUBTYPE_RANK}, dist) AS rn
      FROM sized WHERE km2 BETWEEN ${MIN_KM2} AND ${MAX_KM2}
    ) WHERE rn = 1`);
  log("bounds", `${await count("best")} chosen; simplifying`);
  // The winners' geometries: trimmed, simplified, as GeoJSON.
  const reader = await con.runAndReadAll(`
    WITH g AS (
      SELECT b.idx, near_parts(a.geometry, c.lng, c.lat) AS geom
      FROM best b ${byRow("b")} JOIN centres c ON c.idx = b.idx
    ), simple AS (
      SELECT idx, ST_SimplifyPreserveTopology(geom, greatest(0.00005, sqrt(ST_Area(geom)) / 150)) AS g FROM g
    )
    SELECT idx, ST_AsGeoJSON(CASE WHEN ST_NPoints(g) > 300 THEN ST_SimplifyPreserveTopology(g, sqrt(ST_Area(g)) / 60) ELSE g END)
    FROM simple`);
  const out: (EncodedBoundary | null)[] = cities.map(() => null);
  for (const [idx, json] of reader.getRows()) if (json) out[Number(idx)] = encodeGeoJson(String(json));
  return out;
}
