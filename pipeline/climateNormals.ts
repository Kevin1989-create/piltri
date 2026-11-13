import { readFileSync } from "fs";
import path from "path";
import { gunzipSync } from "zlib";

/**
 * The 1991-2020 climate averages at every GeoNames cities1000 place
 * (TerraClimate, University of Idaho - public domain, CC0; ~4 km grid),
 * computed once by scripts/build-climate-normals.mts and committed as
 * pipeline/static/terraclimate-1991-2020.bin.gz, so the monthly refresh
 * never downloads the 16 GB of yearly files (2026-11-12, owner: the
 * climate chart "stops in 2000" - WorldClim's 1970-2000).
 *
 * A place is found by its GeoNames id, or - a town GeoNames added since -
 * as the nearest place in the file within NEAREST_KM.
 */

const CLIMATE_NORMALS_FILE = path.join(__dirname, "static", "terraclimate-1991-2020.bin.gz");

const VARIABLES = ["tmax", "tmin", "ppt", "srad", "vap"] as const;
const STORE_SCALE = { tmax: 10, tmin: 10, ppt: 1, srad: 10, vap: 1000 } as const;
const NEAREST_KM = 10;

/** One place's 12 monthly values: daily high and low (°C), precipitation
 *  (mm), solar radiation (kJ m⁻² day⁻¹, WorldClim's unit - from W/m²), and
 *  vapour pressure (kPa); null where the grid has none. */
export interface MonthlyNormals {
  tmax: number[];
  tmin: number[];
  ppt: number[];
  srad: number[];
  vap: number[];
}

interface Table {
  ids: Map<number, number>;
  lat: Float64Array;
  lng: Float64Array;
  values: Int16Array; // place i: VARIABLES x 12, in order
  grid: Map<string, number[]>;
}

let table: Table | null = null;
const cellKey = (lat: number, lng: number) => `${Math.floor(lat * 10)},${Math.floor(lng * 10)}`;

function load(): Table {
  if (table) return table;
  const buf = gunzipSync(readFileSync(CLIMATE_NORMALS_FILE));
  if (buf.toString("ascii", 0, 4) !== "PTC1") throw new Error("climate normals: not a PTC1 file");
  const n = buf.readUInt32LE(4);
  const per = VARIABLES.length * 12;
  const record = 12 + per * 2;
  const ids = new Map<number, number>();
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  const values = new Int16Array(n * per);
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const o = 8 + i * record;
    ids.set(buf.readUInt32LE(o), i);
    lat[i] = buf.readInt32LE(o + 4) / 1e5;
    lng[i] = buf.readInt32LE(o + 8) / 1e5;
    for (let k = 0; k < per; k++) values[i * per + k] = buf.readInt16LE(o + 12 + k * 2);
    const key = cellKey(lat[i], lng[i]);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(i);
  }
  table = { ids, lat, lng, values, grid };
  return table;
}

function nearest(t: Table, la: number, lo: number): number {
  const cy = Math.floor(la * 10);
  const cx = Math.floor(lo * 10);
  let best = -1;
  let bestKm = NEAREST_KM;
  const kx = Math.cos((la * Math.PI) / 180);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -2; dx <= 2; dx++)
      for (const i of t.grid.get(`${cy + dy},${cx + dx}`) ?? []) {
        const km = Math.hypot((t.lng[i] - lo) * kx, t.lat[i] - la) * 111.32;
        if (km < bestKm) [best, bestKm] = [i, km];
      }
  return best;
}

/** Each point's 1991-2020 monthly averages, or null. */
export function climateNormalsFor(points: { lat: number; lng: number; geonameId?: number | null }[]): (MonthlyNormals | null)[] {
  const t = load();
  const per = VARIABLES.length * 12;
  return points.map((p) => {
    const i = (p.geonameId != null ? t.ids.get(p.geonameId) : undefined) ?? nearest(t, p.lat, p.lng);
    if (i == null || i < 0) return null;
    const out = {} as Record<(typeof VARIABLES)[number], number[]>;
    for (let v = 0; v < VARIABLES.length; v++) {
      const name = VARIABLES[v];
      const months: number[] = [];
      for (let m = 0; m < 12; m++) {
        const raw = t.values[i * per + v * 12 + m];
        if (raw === -32768) return null;
        const value = raw / STORE_SCALE[name];
        // W/m² averaged over the day -> kJ per m² per day.
        months.push(name === "srad" ? value * 86.4 : value);
      }
      out[name] = months;
    }
    return out;
  });
}
