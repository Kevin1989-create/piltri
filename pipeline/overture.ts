import { closeSync, existsSync, mkdirSync, openSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { log, WORK_DIR } from "./util";

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
};

/** Transit categories live in the finer-grained taxonomy, not basic_category. */
const TAXONOMY_TO_CODE: Record<string, number> = {
  bus_station: POI.bus,
  metro_station: POI.metro,
  light_rail_and_subway_station: POI.metro,
  tram_station: POI.tram,
  tram_stop: POI.tram,
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
    name: "places",
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

interface ExtractSpec {
  /** Local folder suffix, e.g. "places". */
  name: string;
  /** Path under the release, e.g. "theme=places/type=place". */
  source: string;
  select: string;
  where: string;
}

async function extractParts(OVERTURE_RELEASE: string, spec: ExtractSpec): Promise<string> {
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

  async function extractOne(con: Awaited<ReturnType<DuckDBInstance["connect"]>>, i: number, part: string) {
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

// `tsx pipeline/overture.ts [places|rail]` pre-extracts ahead of a build.
if (process.argv[1]?.endsWith("overture.ts")) {
  (process.argv[2] === "rail" ? extractOvertureRail() : extractOverturePlaces()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
