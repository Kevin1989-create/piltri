import path from "path";
import { readdirSync } from "fs";
import { fromFile } from "geotiff";
import { DuckDBInstance } from "@duckdb/node-api";
import type { EncodedBoundary } from "@/lib/dataset/schema";
import { encodeGeoJson } from "./boundaries";
import { log, WORK_DIR } from "./util";

/**
 * Built-up area outlines, for towns with no boundary of their own in the
 * open map data (pipeline/boundaries.ts) - most of India, China, Vietnam,
 * Pakistan, South Africa... where OpenStreetMap maps districts, wards or
 * metropolitan municipalities, not towns (2026-10-01).
 *
 * From the GHS-POP grid already used for density (~1 km cells): the cells
 * around the town dense enough to count as built up, joined to it - the
 * extent of the town as people actually live in it, not a legal border, and
 * shown as such (dashed, "built-up area"). Where towns sit in one built-up
 * mass (a metropolis and its satellites), each cell goes to the town whose
 * pull is strongest - distance divided by the square root of population -
 * so a big city keeps its suburbs and a small town keeps its own centre.
 */
export const BUILTUP_SOURCE = "GHS-POP R2023A, 2025, 1 km grid (European Commission JRC, CC BY 4.0) - built-up extent";

const CELL_KM = (30 / 3600) * 111.32; // 30 arc-seconds, ~0.93 km
/** A cell counts as built up from this many people per km² - the GHSL
 *  "urban cluster" threshold - up to 1,500 ("urban centre") for dense
 *  cities: a fifth of the density at the town's centre, within that range. */
const MIN_DENSITY = 300;
const MAX_DENSITY = 1500;
/** Below this density at its centre, a place gets no built-up outline. */
const MIN_CENTRE_DENSITY = 150;
/** How far a town's outline may reach, from its population: 1.5x the
 *  radius of a disc of it at 1,500 people/km², between 2 and 40 km. */
const reachKm = (population: number) => Math.min(40, Math.max(2, 1.5 * Math.sqrt(population / (Math.PI * 1500))));
/** A town's centre may be up to this far from its first built-up cell. */
const SEED_KM = 1.5;

export type Town = { lat: number; lng: number; population: number };

/** Built-up outlines for the towns at `wanted` (indexes into `towns`; all
 *  towns compete for shared cells), aligned with `wanted`. */
export async function sampleBuiltUp(towns: Town[], wanted: number[]): Promise<(EncodedBoundary | null)[]> {
  const dir = path.join(WORK_DIR, "ghs-pop");
  const image = await (await fromFile(path.join(dir, readdirSync(dir).find((f) => f.endsWith(".tif"))!))).getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [west, south, east, north] = image.getBoundingBox();
  const resX = (east - west) / width;
  const resY = (north - south) / height;

  // Towns by 0.1-degree bucket, to find the ones competing for a cell.
  const buckets = new Map<string, number[]>();
  const bucketOf = (lat: number, lng: number) => `${Math.floor(lat * 10)}|${Math.floor(lng * 10)}`;
  towns.forEach((t, i) => {
    const key = bucketOf(t.lat, t.lng);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(i);
  });
  const townsNear = (lat: number, lng: number, km: number): number[] => {
    const dLat = km / 111.32;
    const dLng = km / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
    const out: number[] = [];
    for (let y = Math.floor((lat - dLat) * 10); y <= Math.floor((lat + dLat) * 10); y++)
      for (let x = Math.floor((lng - dLng) * 10); x <= Math.floor((lng + dLng) * 10); x++) out.push(...(buckets.get(`${y}|${x}`) ?? []));
    return out;
  };

  // Each wanted town's cells, as runs along a row: [row, colStart, colEnd].
  const runs: { k: number; row: number; c0: number; c1: number }[] = [];
  let found = 0;
  let done = 0;
  // A town's own stretch of the grid: within its reach of its centre.
  const boxOf = (k: number) => {
    const me = towns[wanted[k]];
    const reach = reachKm(me.population);
    const cosLat = Math.max(Math.cos((me.lat * Math.PI) / 180), 0.05);
    const row0 = Math.floor((north - me.lat) / resY);
    const col0 = Math.floor((me.lng - west) / resX);
    const dr = Math.ceil(reach / CELL_KM) + 1;
    const dc = Math.ceil(reach / (CELL_KM * cosLat)) + 1;
    return { k, me, reach, cosLat, row0, col0, y0: Math.max(0, row0 - dr), y1: Math.min(height, row0 + dr + 1), x0: Math.max(0, col0 - dc), x1: Math.min(width, col0 + dc + 1) };
  };
  // Towns grouped by raster tile, so each stretch of the grid is decoded
  // once for all the towns in it rather than once per town.
  const tileW = image.getTileWidth();
  const tileH = image.getTileHeight();
  const groups = new Map<string, number[]>();
  wanted.forEach((i, k) => {
    const key = `${Math.floor((north - towns[i].lat) / resY / tileH)}|${Math.floor((towns[i].lng - west) / resX / tileW)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(k);
  });
  for (const members of groups.values()) {
    const boxes = members.map(boxOf).filter((b) => b.y0 < b.y1 && b.x0 < b.x1);
    if (!boxes.length) continue;
    const gy0 = Math.min(...boxes.map((b) => b.y0));
    const gy1 = Math.max(...boxes.map((b) => b.y1));
    const gx0 = Math.min(...boxes.map((b) => b.x0));
    const gx1 = Math.max(...boxes.map((b) => b.x1));
    const [win] = (await image.readRasters({ window: [gx0, gy0, gx1, gy1] })) as unknown as ArrayLike<number>[];
    const gw = gx1 - gx0;
    for (const { k, me, reach, cosLat, row0, col0, y0, y1, x0, x1 } of boxes) {
      if (++done % 10000 === 0) log("builtup", `${done}/${wanted.length} towns`);
      const cellArea = CELL_KM * CELL_KM * cosLat;
      const w = x1 - x0;
      const density = (r: number, c: number) => {
        const v = win[(r - gy0) * gw + (c - gx0)];
        return v > 0 ? v / cellArea : 0;
      };
      const cellLat = (r: number) => north - (r + 0.5) * resY;
      const cellLng = (c: number) => west + (c + 0.5) * resX;
      const km = (r: number, c: number, t: Town) => {
        const dy = (cellLat(r) - t.lat) * 111.32;
        const dx = (cellLng(c) - t.lng) * 111.32 * cosLat;
        return Math.sqrt(dx * dx + dy * dy);
      };

      // Density at the centre: the densest cell within SEED_KM.
      let centre = 0;
      const seedR = Math.ceil(SEED_KM / CELL_KM);
      const seedC = Math.ceil(SEED_KM / (CELL_KM * cosLat));
      for (let r = Math.max(y0, row0 - seedR); r <= Math.min(y1 - 1, row0 + seedR); r++)
        for (let c = Math.max(x0, col0 - seedC); c <= Math.min(x1 - 1, col0 + seedC); c++)
          if (km(r, c, me) <= SEED_KM) centre = Math.max(centre, density(r, c));
      if (centre < MIN_CENTRE_DENSITY) continue;
      const threshold = Math.min(MAX_DENSITY, Math.max(Math.min(MIN_DENSITY, centre * 0.5), centre * 0.2));

      // Who pulls each cell: smallest distance / sqrt(population).
      const rivals = townsNear(me.lat, me.lng, reach * 2 + 2).filter((i) => i !== wanted[k]);
      const mine = (r: number, c: number) => {
        const own = km(r, c, me) / Math.sqrt(Math.max(me.population, 1));
        for (const i of rivals) if (km(r, c, towns[i]) / Math.sqrt(Math.max(towns[i].population, 1)) < own) return false;
        return true;
      };
      const ok = (r: number, c: number) => r >= y0 && r < y1 && c >= x0 && c < x1 && density(r, c) >= threshold && km(r, c, me) <= reach && mine(r, c);

      // Seed: the qualifying cell nearest the centre, within SEED_KM.
      let seed: [number, number] | null = null;
      let seedKm = Infinity;
      for (let r = Math.max(y0, row0 - seedR); r <= Math.min(y1 - 1, row0 + seedR); r++)
        for (let c = Math.max(x0, col0 - seedC); c <= Math.min(x1 - 1, col0 + seedC); c++) {
          const d = km(r, c, me);
          if (d <= SEED_KM && d < seedKm && ok(r, c)) {
            seed = [r, c];
            seedKm = d;
          }
        }
      if (!seed) continue;

      // Flood fill, 8-connected.
      const seen = new Set<number>();
      const keyOf = (r: number, c: number) => (r - y0) * w + (c - x0);
      const stack: [number, number][] = [seed];
      seen.add(keyOf(...seed));
      const cells: [number, number][] = [];
      while (stack.length) {
        const [r, c] = stack.pop()!;
        cells.push([r, c]);
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++) {
            if (!a && !b) continue;
            const nr = r + a;
            const nc = c + b;
            const key = keyOf(nr, nc);
            if (nr < y0 || nr >= y1 || nc < x0 || nc >= x1 || seen.has(key)) continue;
            seen.add(key);
            if (ok(nr, nc)) stack.push([nr, nc]);
          }
      }
      // Rows into runs.
      cells.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      for (let i = 0; i < cells.length; ) {
        let j = i;
        while (j + 1 < cells.length && cells[j + 1][0] === cells[i][0] && cells[j + 1][1] === cells[j][1] + 1) j++;
        runs.push({ k, row: cells[i][0], c0: cells[i][1], c1: cells[j][1] });
        i = j + 1;
      }
      found++;
    }
  }
  log("builtup", `${found} of ${wanted.length} towns have a built-up area; drawing outlines`);

  // Cells to outlines: union of the row runs, one-cell gaps closed (grown
  // and shrunk by a third of a cell), the 1 km staircase straightened
  // (simplified to half a cell), then corners rounded (smoothRing) and
  // small holes dropped - a soft shape rather than a block of squares.
  const instance = await DuckDBInstance.create(":memory:", { memory_limit: "4GB", threads: "4" });
  const con = await instance.connect();
  await con.run("INSTALL spatial; LOAD spatial;");
  await con.run("CREATE TABLE runs (k INTEGER, xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE)");
  const appender = await con.createAppender("runs");
  for (const r of runs) {
    appender.appendInteger(r.k);
    appender.appendDouble(west + r.c0 * resX);
    appender.appendDouble(north - (r.row + 1) * resY);
    appender.appendDouble(west + (r.c1 + 1) * resX);
    appender.appendDouble(north - r.row * resY);
    appender.endRow();
  }
  appender.closeSync();
  const soft = resY / 3;
  const reader = await con.runAndReadAll(`
    WITH u AS (SELECT k, ST_Union_Agg(ST_MakeEnvelope(xmin, ymin, xmax, ymax)) AS g FROM runs GROUP BY k)
    SELECT k, ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Buffer(ST_Buffer(g, ${soft}, 2), ${-soft}, 2), ${resY / 2})) FROM u`);
  const out: (EncodedBoundary | null)[] = wanted.map(() => null);
  for (const [k, json] of reader.getRows()) {
    if (!json) continue;
    const geom = JSON.parse(String(json)) as { type: string; coordinates: number[][][] | number[][][][] };
    const polygons = geom.type === "Polygon" ? [geom.coordinates as number[][][]] : geom.type === "MultiPolygon" ? (geom.coordinates as number[][][][]) : [];
    const smooth = polygons.map(([outer, ...holes]) => [smoothRing(outer), ...holes.filter((h) => ringAreaKm2(h) >= MIN_HOLE_KM2).map(smoothRing)]);
    out[Number(k)] = encodeGeoJson(JSON.stringify({ type: "MultiPolygon", coordinates: smooth }));
  }
  return out;
}

/** Holes smaller than this (a park, a lake) are filled. */
const MIN_HOLE_KM2 = 3;

function ringAreaKm2(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  const lat = ring[0]?.[1] ?? 0;
  return (Math.abs(a) / 2) * 111.32 * 111.32 * Math.cos((lat * Math.PI) / 180);
}

/** Chaikin corner cutting on a closed ring - 2 rounds, 3 for small rings
 *  (a one-cell town would otherwise stay a square). */
function smoothRing(ring: number[][]): number[][] {
  let pts = ring.slice(0, -1);
  const rounds = pts.length < 12 ? 3 : 2;
  for (let n = 0; n < rounds; n++) {
    const next: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    pts = next;
  }
  return [...pts, pts[0]];
}
