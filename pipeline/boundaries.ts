import { DuckDBInstance } from "@duckdb/node-api";
import { BOUNDARY_PRECISION, type EncodedBoundary } from "@/lib/dataset/schema";
import { extractParts, resolveOvertureRelease } from "./overture";
import { cached, log, pointsKey } from "./util";

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

/** Accent- and case-insensitive name without "City of" / "Greater" / " City"
 *  ("Greater London" = "London", "Mexico City" = "Ciudad de México"'s
 *  English name "Mexico City"), as SQL. */
const coreName = (x: string) =>
  `regexp_replace(trim(regexp_replace(lower(strip_accents(${x})), '[^a-z0-9]+', ' ', 'g')), '^(city of|greater|town of|municipality of) | (city|municipality|town)$', '', 'g')`;

type City = { cityName: string; countryCode: string; lat: number; lng: number };
type Con = Awaited<ReturnType<DuckDBInstance["connect"]>>;

async function loadCities(con: Con, cities: City[]) {
  await con.run("CREATE OR REPLACE TABLE pts (idx INTEGER, cc VARCHAR, name VARCHAR, lng DOUBLE, lat DOUBLE)");
  const appender = await con.createAppender("pts");
  cities.forEach((c, i) => {
    appender.appendInteger(i);
    appender.appendVarchar(c.countryCode);
    appender.appendVarchar(c.cityName);
    appender.appendDouble(c.lng);
    appender.appendDouble(c.lat);
    appender.endRow();
  });
  appender.closeSync();
  await con.run(`ALTER TABLE pts ADD COLUMN k VARCHAR; UPDATE pts SET k = ${coreName("name")}`);
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

function encodeGeoJson(json: string): EncodedBoundary | null {
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
  return cached(`bounds-v2-${release}-${key}`, async () => {
    // Pass 1 (remote, resumable): only polygons whose name matches a city's
    // name in the same country - a few percent of the ~1M land divisions.
    const glob = await extractParts(release, {
      name: `bounds-v2-${key}`,
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
 *  to ~100-300 points - plenty for an outline on a map. */
export async function chooseOutlines(glob: string, cities: City[]): Promise<(EncodedBoundary | null)[]> {
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  await con.run("INSTALL spatial; LOAD spatial;");
  await loadCities(con, cities);
  const reader = await con.runAndReadAll(`
      WITH cand AS (
        SELECT p.idx, p.lng, p.lat, a.subtype, a.geometry AS whole, ST_Distance(a.geometry, ST_Point(p.lng, p.lat)) AS dist
        FROM read_parquet('${glob}') a
        JOIN pts p ON a.country = p.cc AND (a.k1 = p.k OR a.k2 = p.k)
          AND p.lng BETWEEN a.bbox.xmin - 0.02 AND a.bbox.xmax + 0.02
          AND p.lat BETWEEN a.bbox.ymin - 0.02 AND a.bbox.ymax + 0.02
      ), near AS (
        SELECT idx, subtype, dist,
          ST_Collect(list_transform(list_filter(ST_Dump(whole), d -> ST_Distance(d.geom, ST_Point(lng, lat)) < ${MAX_PART_DEG}), d -> d.geom)) AS geom
        FROM cand WHERE dist < 0.01
      ), sized AS (
        -- ST_Area_Spheroid reads coordinates as lat/lng, hence the flip.
        SELECT *, ST_Area_Spheroid(ST_FlipCoordinates(geom)) / 1e6 AS km2 FROM near
      ), best AS (
        SELECT *, row_number() OVER (PARTITION BY idx ORDER BY ${SUBTYPE_RANK}, dist) AS rn
        FROM sized WHERE km2 BETWEEN ${MIN_KM2} AND ${MAX_KM2}
      ), simple AS (
        SELECT idx, ST_SimplifyPreserveTopology(geom, greatest(0.00005, sqrt(ST_Area(geom)) / 150)) AS g FROM best WHERE rn = 1
      )
      SELECT idx, ST_AsGeoJSON(CASE WHEN ST_NPoints(g) > 300 THEN ST_SimplifyPreserveTopology(g, sqrt(ST_Area(g)) / 60) ELSE g END)
      FROM simple`);
  const out: (EncodedBoundary | null)[] = cities.map(() => null);
  for (const [idx, json] of reader.getRows()) if (json) out[Number(idx)] = encodeGeoJson(String(json));
  return out;
}
