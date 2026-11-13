import { closeSync, existsSync, mkdirSync, openSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { log, WORK_DIR } from "./util";
import type { OsmHospitalAreas } from "./hospitals";

const FALLBACK_OVERTURE_RELEASE = "2026-08-19.0";

/** Overture Maps publishes a new release roughly monthly - each pipeline
 *  run uses the newest one, found from the bucket's public listing (pin a
 *  specific one with OVERTURE_RELEASE=...). Releases:
 *  https://docs.overturemaps.org/release/latest/ */
export async function resolveOvertureRelease(): Promise<string> {
  if (process.env.OVERTURE_RELEASE) return process.env.OVERTURE_RELEASE;
  try {
    const res = await fetch("https://overturemaps-us-west-2.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/", {
      signal: AbortSignal.timeout(30_000),
    });
    const releases = [...(await res.text()).matchAll(/<Prefix>release\/(\d{4}-\d{2}-\d{2}\.\d+)\/<\/Prefix>/g)].map((m) => m[1]).sort();
    if (releases.length) return releases[releases.length - 1];
  } catch {
    // fall through to the known-good fallback
  }
  return FALLBACK_OVERTURE_RELEASE;
}

/** Category codes stored in the extracted file - one small int per place
 *  rather than the full category string, to keep the local extract small. */
export const POI = {
  eating: 1, // restaurants, bars, cafes (the old OSM amenity=restaurant|bar|cafe set)
  cultural: 2, // museums, galleries, theatres, cinemas
  family: 3, // playgrounds, zoos, aquariums, amusement/water parks
  park: 4,
  school: 5,
  university: 6,
  train: 7,
  metro: 8,
  bus: 9,
  airport: 10,
  beach: 11,
  tram: 12,
  nursery: 13, // nurseries, day care, preschools
  careHome: 14, // care, nursing, retirement and assisted-living homes
  hospital: 15, // hospitals and emergency departments (not clinics or surgeries)
} as const;

const BASIC_CATEGORY_TO_CODE: Record<string, number> = {
  restaurant: POI.eating,
  fast_food_restaurant: POI.eating,
  bar: POI.eating,
  pub: POI.eating,
  cafe: POI.eating,
  coffee_shop: POI.eating,
  museum: POI.cultural,
  art_gallery: POI.cultural,
  theatre_venue: POI.cultural,
  movie_theater: POI.cultural,
  playground: POI.family,
  zoo: POI.family,
  aquarium: POI.family,
  amusement_park: POI.family,
  water_park: POI.family,
  park: POI.park,
  national_park: POI.park,
  elementary_school: POI.school,
  middle_school: POI.school,
  high_school: POI.school,
  college_university: POI.university,
  train_station: POI.train,
  airport: POI.airport,
  beach: POI.beach,
  // Residential homes for older people: retirement / nursing homes and
  // assisted living. Home-help services, nurses, hospices and senior
  // activity centres are separate categories and are left out.
  senior_living_facility: POI.careHome,
  // The nearest hospital (2026-10-24, phase 1 of local data). Clinics,
  // surgeries and urgent-care centres are separate categories.
  hospital: POI.hospital,
  emergency_department: POI.hospital,
};

/** Transit and childcare categories live in the finer-grained taxonomy
 *  (childcare's basic_category is the broad "family_service"). */
const TAXONOMY_TO_CODE: Record<string, number> = {
  bus_station: POI.bus,
  metro_station: POI.metro,
  light_rail_and_subway_station: POI.metro,
  tram_station: POI.tram,
  tram_stop: POI.tram,
  child_care_and_day_care: POI.nursery,
  day_care_preschool: POI.nursery,
  preschool: POI.nursery,
};

function sqlCase(column: string, map: Record<string, number>): string {
  return Object.entries(map)
    .map(([k, v]) => `WHEN ${column} = '${k}' THEN ${v}`)
    .join(" ");
}

/** One pass over Overture's global places (~70M rows, read straight from
 *  their public S3 bucket - free, no account), keeping only the categories
 *  above, written to local Parquet parts. Everything downstream reads
 *  those. Takes a while on first run (it streams a few GB); skipped when
 *  the output already exists. */
export async function extractOverturePlaces(): Promise<{ glob: string; release: string }> {
  const release = await resolveOvertureRelease();
  const basicList = Object.keys(BASIC_CATEGORY_TO_CODE).map((c) => `'${c}'`).join(",");
  const taxList = Object.keys(TAXONOMY_TO_CODE).map((c) => `'${c}'`).join(",");
  const glob = await extractParts(release, {
    // Versioned: a changed category list needs a fresh extract.
    name: "places-v4",
    source: "theme=places/type=place",
    select: `
      CASE ${sqlCase("taxonomy.primary", TAXONOMY_TO_CODE)} ${sqlCase("basic_category", BASIC_CATEGORY_TO_CODE)} END::TINYINT AS cat,
      round((bbox.xmin + bbox.xmax) / 2, 5) AS lng,
      round((bbox.ymin + bbox.ymax) / 2, 5) AS lat,
      names."primary" AS name`,
    where: `(basic_category IN (${basicList}) OR taxonomy.primary IN (${taxList}))
      AND coalesce(confidence, 1) >= 0.5
      AND coalesce(operating_status, 'open') <> 'permanently_closed'`,
  });
  return { glob, release };
}

/** OpenStreetMap's hospitals (amenity=hospital grounds), as Overture's
 *  base theme carries them: land use "medical", class "hospital"
 *  (2026-11-10, the worldwide audit: Overture's places come from business
 *  listings, thin in China, Iran, Central Asia and much of Africa, where
 *  OpenStreetMap maps hospitals - 46 around Weifang, 145 in Tehran, 80 in
 *  Tashkent, against a handful of listings). The centre of each one's box,
 *  and the box; and (v2, 2026-11-11: Olivet's rehab clinic came back
 *  through OpenStreetMap) what its tags say of the care it gives - whether
 *  it has an emergency department, its speciality, and France's official
 *  category (FINESS) - for pipeline/hospitals.ts osmNotAcute. */
export async function extractOvertureMedical(): Promise<{ glob: string; release: string }> {
  const release = await resolveOvertureRelease();
  const glob = await extractParts(release, {
    name: "medical-v2",
    source: "theme=base/type=land_use",
    select: `
      round((bbox.xmin + bbox.xmax) / 2, 5) AS lng,
      round((bbox.ymin + bbox.ymax) / 2, 5) AS lat,
      round(bbox.xmin, 5) AS xmin,
      round(bbox.ymin, 5) AS ymin,
      round(bbox.xmax, 5) AS xmax,
      round(bbox.ymax, 5) AS ymax,
      names."primary" AS name,
      source_tags['emergency'] AS emergency,
      source_tags['healthcare:speciality'] AS speciality,
      source_tags['type:FR:FINESS'] AS finess`,
    where: `subtype = 'medical' AND class = 'hospital'`,
  });
  return { glob, release };
}

export async function loadOsmHospitalAreas(glob: string): Promise<OsmHospitalAreas> {
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  const rows = (
    await con.runAndReadAll(`SELECT lng, lat, name, xmin, ymin, xmax, ymax, emergency, speciality, finess FROM read_parquet('${glob}') WHERE name IS NOT NULL`)
  ).getRows();
  const col = (k: number) => Float64Array.from(rows, (r) => Number(r[k]));
  const text = (k: number) => rows.map((r) => (r[k] == null ? null : String(r[k])));
  return {
    lng: col(0),
    lat: col(1),
    names: rows.map((r) => String(r[2])),
    xmin: col(3),
    ymin: col(4),
    xmax: col(5),
    ymax: col(6),
    emergency: text(7),
    speciality: text(8),
    finess: text(9),
  };
}

/** Urban rail track from Overture's transportation theme (OpenStreetMap
 *  railway=tram / light_rail / subway / monorail) - the actual lines, which
 *  is what "does this city have trams" needs. Stops/stations aren't
 *  reliably mapped as places (see build.ts's tram history), but the track
 *  itself is. One point per segment (its bbox centre, segments are short);
 *  abandoned / disused / under-construction track is dropped. */
export async function extractOvertureRail(): Promise<{ glob: string; release: string }> {
  const release = await resolveOvertureRelease();
  const glob = await extractParts(release, {
    name: "rail",
    source: "theme=transportation/type=segment",
    select: `
      class,
      round((bbox.xmin + bbox.xmax) / 2, 5) AS lng,
      round((bbox.ymin + bbox.ymax) / 2, 5) AS lat`,
    where: `subtype = 'rail' AND class IN ('tram', 'light_rail', 'subway', 'monorail')
      AND NOT coalesce(list_has_any(
        flatten(list_transform(rail_flags, f -> f."values")),
        ['is_abandoned', 'is_disused', 'is_under_construction', 'is_construction', 'is_proposed']
      ), false)`,
  });
  return { glob, release };
}

export interface ExtractSpec {
  /** Local folder suffix, e.g. "places". */
  name: string;
  /** Path under the release, e.g. "theme=places/type=place". */
  source: string;
  select: string;
  where: string;
  /** Runs once before extracting, e.g. to load a table `where` joins on. */
  setup?: (con: DuckDBConnection) => Promise<void>;
}

export async function extractParts(OVERTURE_RELEASE: string, spec: ExtractSpec): Promise<string> {
  const partsDir = path.join(WORK_DIR, `overture-${spec.name}-${OVERTURE_RELEASE}`).replace(/\\/g, "/");
  const doneMarker = path.join(partsDir, "_DONE");
  const glob = `${partsDir}/part-*.parquet`;
  if (existsSync(doneMarker)) {
    log("overture", `reusing ${path.basename(partsDir)}`);
    return glob;
  }
  if (!existsSync(partsDir)) mkdirSync(partsDir, { recursive: true });

  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  await con.run(
    "INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET threads=8; SET http_retries=10; SET http_retry_wait_ms=2000; SET http_retry_backoff=2;"
  );
  await spec.setup?.(con);
  const files = (
    await con.runAndReadAll(`SELECT file FROM glob('s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/${spec.source}/*')`)
  )
    .getRows()
    .map((r) => String(r[0]));
  log("overture", `${spec.name}: ${files.length} source files in release ${OVERTURE_RELEASE} (one-time, resumable)`);

  // One local part per remote file, so a network blip only costs the file
  // in flight - a re-run skips every part already written. Several
  // processes can share the work (OVERTURE_WORKERS=n runs n in parallel
  // here; S3 throughput is per-connection-bound): each claims a file with
  // an exclusive lock file before starting it.
  const order = files.map((_, i) => i);
  if (process.env.OVERTURE_REVERSE) order.reverse();
  const claim = (i: number): string | null => {
    const part = `${partsDir}/part-${String(i).padStart(4, "0")}.parquet`;
    if (existsSync(part)) return null;
    try {
      closeSync(openSync(`${part}.lock-${OVERTURE_RELEASE}`, "wx"));
      return part;
    } catch {
      return null; // another worker has it
    }
  };
  const workers = Number(process.env.OVERTURE_WORKERS ?? 1);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      const con = await instance.connect();
      await con.run("SET s3_region='us-west-2'; SET http_retries=10; SET http_retry_wait_ms=2000; SET http_retry_backoff=2;");
      for (const i of order) {
        const part = claim(i);
        if (!part) continue;
        await extractOne(con, i, part);
      }
    })
  );
  // Files claimed by a worker that died never got written - pick them up.
  for (const i of order) {
    const part = `${partsDir}/part-${String(i).padStart(4, "0")}.parquet`;
    if (!existsSync(part)) await extractOne(con, i, part);
  }
  writeFileSync(doneMarker, new Date().toISOString());
  return glob;

  async function extractOne(con: DuckDBConnection, i: number, part: string) {
    const tmp = `${part}.tmp-${process.pid}-${i}`;
    const t0 = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        await con.run(`
          COPY (SELECT ${spec.select} FROM read_parquet('${files[i]}') WHERE ${spec.where})
          TO '${tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
        renameSync(tmp, part);
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        log("overture", `file ${i + 1} attempt ${attempt} failed (${String(err).slice(0, 120)}), retrying...`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
    log("overture", `${spec.name} file ${i + 1}/${files.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
}

export interface OverturePoints {
  lng: Float64Array;
  lat: Float64Array;
  names: (string | null)[] | null;
}

/** Beaches from Overture's base theme - OpenStreetMap natural=beach, far
 *  more than GeoNames maps (most of the world's sea beaches, and lake
 *  beaches such as Geneva's). One point per beach, the centre of its box;
 *  build.ts sorts them into sea, lake and river beaches. Load with
 *  loadOvertureCategory(glob, "beach", true). */
export async function extractOvertureBeaches(): Promise<{ glob: string; release: string }> {
  const release = await resolveOvertureRelease();
  const glob = await extractParts(release, {
    name: "beaches",
    source: "theme=base/type=land",
    select: `
      class,
      round((bbox.xmin + bbox.xmax) / 2, 5) AS lng,
      round((bbox.ymin + bbox.ymax) / 2, 5) AS lat,
      names."primary" AS name`,
    where: `subtype = 'sand' AND class = 'beach'`,
  });
  return { glob, release };
}

/** Stations and stops from OpenStreetMap, as Overture's base theme carries
 *  them with their raw OSM tags (2026-11-08, owner: Olivet's "train
 *  station" was a tram stop in Orléans, its own tram stops missing).
 *  Overture's places categories come from business listings: a tram stop
 *  named "Station Royale-Châtelet" was a train station there, and tram
 *  stops weren't places at all. OpenStreetMap tags say what each is:
 *    train - railway=station, or a halt marked train=yes; not a metro,
 *            light-rail, monorail, funicular, miniature or tourist line
 *    metro - subway stations (station=subway or monorail)
 *    tram  - railway=tram_stop, tram stops and platforms, light-rail
 *            stations
 *    bus   - bus stations (amenity=bus_station), not stops
 *  One row per OSM element; build.ts keeps one per site. Load with
 *  loadOvertureCategory(glob, "train" | "metro" | "tram" | "bus", true). */
export async function extractOvertureTransit(): Promise<{ glob: string; release: string }> {
  const release = await resolveOvertureRelease();
  const tag = (k: string) => `coalesce(source_tags['${k}'], '')`;
  const glob = await extractParts(release, {
    // v2 (2026-11-11, owner: "London says only 61 bus stations, way below
    // reality"): bus stops too (highway=bus_stop) - counted for "Bus
    // stops", not listed (London has ~24,000), so no names.
    name: "transit-v2",
    source: "theme=base/type=infrastructure",
    select: `
      CASE
        WHEN class = 'subway_station' OR (class = 'railway_station' AND ${tag("station")} IN ('subway', 'monorail')) THEN 'metro'
        WHEN ${tag("railway")} = 'tram_stop' OR ${tag("station")} = 'light_rail'
          OR (class IN ('stop_position', 'platform') AND ${tag("tram")} = 'yes' AND ${tag("train")} <> 'yes') THEN 'tram'
        WHEN class IN ('railway_station', 'railway_halt')
          AND ${tag("station")} NOT IN ('subway', 'monorail', 'light_rail', 'funicular', 'miniature')
          AND ${tag("usage")} <> 'tourism' AND ${tag("railway:miniature")} = '' AND ${tag("tourism")} = ''
          AND (class = 'railway_station' OR ${tag("train")} = 'yes') THEN 'train'
        WHEN class = 'bus_station' THEN 'bus'
        WHEN class = 'bus_stop' THEN 'busStop'
      END AS class,
      round((bbox.xmin + bbox.xmax) / 2, 5) AS lng,
      round((bbox.ymin + bbox.ymax) / 2, 5) AS lat,
      CASE WHEN class = 'bus_stop' THEN NULL ELSE names."primary" END AS name`,
    where: `class IN ('railway_station', 'railway_halt', 'subway_station', 'bus_station', 'bus_stop')
      OR source_tags['railway'] = 'tram_stop'
      OR (class IN ('stop_position', 'platform') AND source_tags['tram'] = 'yes')`,
  });
  return { glob, release };
}

/** A rail/transit class's points only, read column by column - for the
 *  millions of bus stops, which only get counted (no names, no per-row
 *  arrays). */
export async function loadOverturePointsLean(file: string, cls: string): Promise<OverturePoints> {
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  const reader = await con.runAndReadAll(`SELECT lng, lat FROM read_parquet('${file}') WHERE class = '${cls}' AND lng IS NOT NULL AND lat IS NOT NULL`);
  const [lngCol, latCol] = reader.getColumns();
  return { lng: Float64Array.from(lngCol as number[]), lat: Float64Array.from(latCol as number[]), names: null };
}

/** Loads one category's points from a local extract - a place category
 *  code, or a rail class name ("tram", "subway"...). Names only kept when
 *  asked for (pin-mode categories), since they're most of the size. */
export async function loadOvertureCategory(file: string, cat: number | string, withNames = false): Promise<OverturePoints> {
  const column = typeof cat === "number" ? "cat" : "class";
  const value = typeof cat === "number" ? cat : `'${cat}'`;
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  const reader = await con.runAndReadAll(
    `SELECT lng, lat${withNames ? ", name" : ""} FROM read_parquet('${file}') WHERE ${column} = ${value} AND lng IS NOT NULL AND lat IS NOT NULL`
  );
  const rows = reader.getRows();
  const lng = new Float64Array(rows.length);
  const lat = new Float64Array(rows.length);
  const names: (string | null)[] | null = withNames ? new Array(rows.length) : null;
  rows.forEach((r, i) => {
    lng[i] = Number(r[0]);
    lat[i] = Number(r[1]);
    if (names) names[i] = (r[2] as string | null) ?? null;
  });
  return { lng, lat, names };
}

// `tsx pipeline/overture.ts [places|rail|beaches|medical]` pre-extracts ahead of a build.
if (process.argv[1]?.endsWith("overture.ts")) {
  (process.argv[2] === "rail" ? extractOvertureRail() : process.argv[2] === "beaches" ? extractOvertureBeaches() : process.argv[2] === "medical" ? extractOvertureMedical() : extractOverturePlaces()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
