/**
 * One-off: the 1991-2020 climate averages at every GeoNames cities1000
 * place, from TerraClimate (Climatology Lab, University of California
 * Merced / University of Idaho - public domain, CC0; 1/24 degree ~4 km,
 * the same grid as WorldClim's 2.5 arc-minutes, which it builds on).
 * Owner, 2026-11-12: the climate chart "stops in 2000" (WorldClim
 * 1970-2000) - "any chance to have more recent data?".
 *
 * Reads TerraClimate's own 1991-2020 summary files (each month averaged
 * over the 30 years; 5 files, ~490 MB, kept in the pipeline cache) - the
 * 150 yearly files they're made from are ~14.5 GB, and their server
 * (northwestknowledge.net:8080) dropped every connection for hours on
 * 2026-11-12/13; the same Northwest Knowledge Network serves them at
 * reacchpna.org, tried first. Takes each place's grid cell (the nearest
 * land cell within 4 cells for a coastal town whose own cell is sea - as
 * worldclim.ts does) and writes pipeline/static/terraclimate-1991-2020.bin.gz,
 * committed, so the monthly refresh never downloads any of it
 * (pipeline/climateNormals.ts reads it).
 *
 * Usage: node --max-old-space-size=4096 --import tsx scripts/build-climate-normals.mts
 */
import { spawnSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import h5wasm from "h5wasm/node";

/** TerraClimate's names: max and min temperature (°C), precipitation (mm),
 *  downward shortwave radiation at the surface (W/m²), vapour pressure (kPa). */
const VARIABLES = ["tmax", "tmin", "ppt", "srad", "vap"] as const;
type Variable = (typeof VARIABLES)[number];
/** How each is stored, as a 16-bit integer: value x scale. */
const STORE_SCALE: Record<Variable, number> = { tmax: 10, tmin: 10, ppt: 1, srad: 10, vap: 1000 };
const SERVERS = [
  "https://reacchpna.org/thredds/fileServer/TERRACLIMATE_ALL/climatology",
  "http://thredds.northwestknowledge.net:8080/thredds/fileServer/TERRACLIMATE_ALL/climatology",
];
const SEARCH_RADIUS = 4;

const CACHE = process.env.PIPELINE_CACHE_DIR ?? path.join(os.homedir(), ".piltri-pipeline-cache");
const RAW = path.join(CACHE, "raw", "terraclimate");
const OUT = path.join(process.cwd(), "pipeline", "static", "terraclimate-1991-2020.bin.gz");
mkdirSync(RAW, { recursive: true });
mkdirSync(path.dirname(OUT), { recursive: true });

const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const nameFor = (v: Variable) => `TerraClimate_19912020_${v}.nc`;

/** Variables averaged from the 30 yearly files instead: the summary keeps
 *  vapour pressure in steps of 0.1 kPa - a cold town's winter month
 *  (~0.1-0.3 kPa) read 0 or 100% humidity, and 14% of places could be
 *  off by over 5 points a year; the yearly files keep 0.001 kPa. */
const FROM_YEARS: Variable[] = ["vap"];
const FIRST_YEAR = 1991;
const LAST_YEAR = 2020;
const PARALLEL = 4;
/** A connection that has sent nothing for this long is dropped and resumed. */
const STALL_MS = 60_000;
/** Attempts in a row that bring no new bytes before giving up. */
const MAX_FRUITLESS = 12;

/** One file, resumable: a partial download is finished with a range
 *  request, from whichever server answers; a stalled read is aborted, and
 *  only attempts that bring nothing count towards giving up. */
async function download(folder: "climatology" | "data", name: string): Promise<string> {
  const file = path.join(RAW, name);
  if (existsSync(file)) return file;
  const part = `${file}.part`;
  for (let attempt = 0, fruitless = 0; ; attempt++) {
    const base = SERVERS[attempt % SERVERS.length].replace(/climatology$/, folder);
    // Resumes 1 MB early, over the stretch just before the cut - where a
    // resumed download had its wrong bytes (2026-11-13).
    if (existsSync(part)) truncateSync(part, Math.max(0, statSync(part).size - (1 << 20)));
    const have = existsSync(part) ? statSync(part).size : 0;
    const abort = new AbortController();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const watch = () => {
      clearTimeout(stall);
      stall = setTimeout(() => abort.abort(new Error("stalled")), STALL_MS);
    };
    try {
      watch();
      const res = await fetch(`${base}/${name}`, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: abort.signal });
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const out = createWriteStream(part, { flags: res.status === 206 && have > 0 ? "a" : "w" });
      try {
        const reader = res.body!.getReader();
        for (;;) {
          watch();
          const { done, value } = await reader.read();
          if (done) break;
          // A copy: a resumed download wrote ~2 KB of wrong bytes where it
          // had been cut off (2026-11-13) - a chunk's memory reused before
          // the write had gone out.
          if (!out.write(Buffer.from(value))) await new Promise<void>((r) => out.once("drain", () => r()));
        }
      } finally {
        await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
      }
      clearTimeout(stall);
      const range = res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
      const expected = Number(range ?? res.headers.get("content-length") ?? 0) || 0;
      if (expected && statSync(part).size !== expected) throw new Error(`got ${statSync(part).size} of ${expected} bytes`);
      renameSync(part, file);
      log(`downloaded ${name} (${(statSync(file).size / 1e6).toFixed(0)} MB)`);
      return file;
    } catch (err) {
      clearTimeout(stall);
      const gained = (existsSync(part) ? statSync(part).size : 0) > have;
      fruitless = gained ? 0 : fruitless + 1;
      if (fruitless >= MAX_FRUITLESS) throw err;
      log(`${name} from ${new URL(base).host}: ${String(err).slice(0, 80)} - resuming`);
      await new Promise((r) => setTimeout(r, Math.min(60_000, 5000 * Math.max(1, fruitless))));
    }
  }
}

/** Runs the jobs PARALLEL at a time. */
async function inParallel<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < jobs.length) {
        const k = next++;
        out[k] = await jobs[k]();
      }
    })
  );
  return out;
}

/** Whether a file is damaged: a damaged file doesn't throw - the HDF5
 *  library writes "HDF5-DIAG" straight to the error output and hands back
 *  wrong values - so every month is read in a separate process (this
 *  script with --check), whose error output is looked at. */
function damaged(file: string, v: Variable): boolean {
  const run = spawnSync(process.execPath, [...process.execArgv, process.argv[1], "--check", file, v], { encoding: "utf8", maxBuffer: 64 << 20 });
  return run.status !== 0 || run.stderr.includes("HDF5-DIAG");
}

/** One file's 12 months at each place's cell (NaN = none). */
function readMonths(file: string, v: Variable, cells: Int32Array): { months: Float64Array; scale: number } {
  const f = new h5wasm.File(file, "r");
  const ds = f.get(v) as any;
  const scale = Number(ds.attrs.scale_factor?.value?.[0] ?? 1);
  const offset = Number(ds.attrs.add_offset?.value?.[0] ?? 0);
  const fill = Number(ds.attrs._FillValue?.value?.[0] ?? -32768);
  if (ds.shape[0] !== 12) throw new Error(`${file}: expected 12 months, got ${ds.shape}`);
  const months = new Float64Array(cells.length * 12).fill(NaN);
  for (let m = 0; m < 12; m++) {
    const month = ds.slice([[m, m + 1], [], []]) as Int16Array;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] < 0) continue;
      const raw = month[cells[i]];
      if (raw !== fill) months[i * 12 + m] = raw * scale + offset;
    }
  }
  f.close();
  return { months, scale };
}

// Every cities1000 place: GeoNames id, lat, lng.
function places(): { id: number; lat: number; lng: number }[] {
  const txt = path.join(CACHE, "work", "geonames", "cities1000.txt");
  if (!existsSync(txt)) throw new Error(`cities1000.txt not found at ${txt} - run the pipeline's shortlist step once (it unzips it there)`);
  const out: { id: number; lat: number; lng: number }[] = [];
  for (const line of readFileSync(txt, "utf8").split("\n")) {
    const c = line.split("\t");
    if (c.length < 6) continue;
    const id = Number(c[0]);
    const lat = Number(c[4]);
    const lng = Number(c[5]);
    if (Number.isFinite(id) && Number.isFinite(lat) && Number.isFinite(lng)) out.push({ id, lat, lng });
  }
  return out;
}

async function main() {
  await h5wasm.ready;
  const pts = places();
  log(`${pts.length} places`);
  const summaries = await inParallel(
    VARIABLES.map((v) => async () => {
      const file = await download("climatology", nameFor(v));
      if (!damaged(file, v)) return file;
      log(`${nameFor(v)} is damaged - downloading it again`);
      unlinkSync(file);
      const again = await download("climatology", nameFor(v));
      if (damaged(again, v)) throw new Error(`${nameFor(v)} is damaged twice over`);
      return again;
    })
  );

  // Each place's grid cell: its own, or the nearest land cell within
  // SEARCH_RADIUS (land = a value in the first summary's January).
  const cells = new Int32Array(pts.length).fill(-1);
  {
    const f = new h5wasm.File(summaries[0], "r");
    const ds = f.get(VARIABLES[0]) as any;
    const fill = Number(ds.attrs._FillValue?.value?.[0] ?? -32768);
    const [, height, width] = ds.shape;
    const lat = f.get("lat") as any;
    const lon = f.get("lon") as any;
    const lat0 = Number(lat.value[0]);
    const dLat = Number(lat.value[0]) - Number(lat.value[1]);
    const lon0 = Number(lon.value[0]);
    const dLon = Number(lon.value[1]) - Number(lon.value[0]);
    const jan = ds.slice([[0, 1], [], []]) as Int16Array;
    let found = 0;
    pts.forEach((p, i) => {
      const row = Math.round((lat0 - p.lat) / dLat);
      const col = Math.round((p.lng - lon0) / dLon);
      for (let r = 0; r <= SEARCH_RADIUS && cells[i] < 0; r++) {
        let best = -1;
        let bestD = Infinity;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const rr = row + dy;
            const cc = (((col + dx) % width) + width) % width;
            if (rr < 0 || rr >= height) continue;
            if (jan[rr * width + cc] === fill) continue;
            const d = dx * dx + dy * dy;
            if (d < bestD) [best, bestD] = [rr * width + cc, d];
          }
        if (best >= 0) {
          cells[i] = best;
          found++;
        }
      }
    });
    f.close();
    log(`grid ${width}x${height}; ${found} of ${pts.length} places on a land cell`);
  }

  const values: Record<string, Float64Array> = {};
  for (const [k, v] of VARIABLES.entries()) {
    const { months, scale } = readMonths(summaries[k], v, cells);
    values[v] = months;
    log(`${v}: summary in steps of ${scale}`);
  }

  for (const v of FROM_YEARS) {
    const years = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, k) => FIRST_YEAR + k);
    const sum = new Float64Array(pts.length * 12);
    const count = new Uint8Array(pts.length * 12);
    // Downloads 4 at a time; each year is averaged in as soon as it's in.
    let scale = 0;
    await inParallel(
      years.map((y) => async () => {
        const name = `TerraClimate_${v}_${y}.nc`;
        let file = await download("data", name);
        if (damaged(file, v)) {
          log(`${name} is damaged - downloading it again`);
          unlinkSync(file);
          file = await download("data", name);
          if (damaged(file, v)) throw new Error(`${name} is damaged twice over`);
        }
        const read = readMonths(file, v, cells);
        scale = read.scale;
        for (let k = 0; k < sum.length; k++)
          if (!Number.isNaN(read.months[k])) {
            sum[k] += read.months[k];
            count[k]++;
          }
        log(`${v} ${y} averaged in`);
      })
    );
    // The summary is the same average, rounded: every place-month should
    // agree with it to within half its step.
    const summary = values[v];
    const averaged = new Float64Array(sum.length).fill(NaN);
    let checked = 0;
    let off = 0;
    for (let k = 0; k < sum.length; k++) {
      if (count[k] !== years.length) continue;
      averaged[k] = sum[k] / count[k];
      if (Number.isNaN(summary[k])) continue;
      checked++;
      if (Math.abs(averaged[k] - summary[k]) > 0.051) off++;
    }
    log(`${v}: 30-year average in steps of ${scale}; ${checked - off} of ${checked} place-months within the summary's rounding (${off} not)`);
    if (off > checked * 0.0001) throw new Error(`${v}: the yearly average and the summary disagree - check before using it`);
    values[v] = averaged;
  }

  // Record: id (uint32), lat, lng (int32 x 1e5), then 12 values per
  // variable (int16, value x STORE_SCALE; -32768 = none).
  const RECORD = 12 + VARIABLES.length * 12 * 2;
  const buf = Buffer.alloc(8 + pts.length * RECORD);
  buf.write("PTC1", 0, "ascii");
  buf.writeUInt32LE(pts.length, 4);
  pts.forEach((p, i) => {
    let o = 8 + i * RECORD;
    buf.writeUInt32LE(p.id, o);
    buf.writeInt32LE(Math.round(p.lat * 1e5), o + 4);
    buf.writeInt32LE(Math.round(p.lng * 1e5), o + 8);
    o += 12;
    for (const v of VARIABLES)
      for (let m = 0; m < 12; m++, o += 2) {
        const x = values[v][i * 12 + m];
        const stored = Number.isNaN(x) ? -32768 : Math.max(-32767, Math.min(32767, Math.round(x * STORE_SCALE[v])));
        buf.writeInt16LE(stored, o);
      }
  });
  writeFileSync(OUT, gzipSync(buf, { level: 9 }));
  log(`wrote ${OUT}: ${(statSync(OUT).size / 1e6).toFixed(1)} MB for ${pts.length} places`);
}

/** --check <file> <variable>: reads every month (see damaged()). */
async function check(file: string, v: string) {
  await h5wasm.ready;
  const f = new h5wasm.File(file, "r");
  const ds = f.get(v) as any;
  for (let m = 0; m < ds.shape[0]; m++) ds.slice([[m, m + 1], [], []]);
  f.close();
}

(process.argv[2] === "--check" ? check(process.argv[3], process.argv[4]) : main()).catch((err) => {
  console.error(err);
  process.exit(1);
});
