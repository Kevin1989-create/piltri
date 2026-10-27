import path from "path";
import { readdirSync } from "fs";
import { fromFile } from "geotiff";
import { cached, downloadOnce, log, pointsKey, unzipOnce, WORK_DIR } from "./util";

/**
 * Population density around each city centre from GHS-POP (European
 * Commission JRC, Global Human Settlement Layer, R2023A, 2025 epoch,
 * 30 arc-second ≈ 1 km grid, CC BY 4.0): everyone living within 5 km of
 * the centre, divided by that circle's area. The same fixed area for every
 * place - so a dense district, a sprawling suburb and a small town are
 * directly comparable, unlike densities over administrative boundaries of
 * wildly different sizes.
 */

const EPOCH = 2025;
/** Population growth compares the same 5 km circle with this epoch. */
const EARLIER_EPOCH = 2020;
const RADIUS_KM = 5;
/** Below this many people within 5 km, a growth rate is mostly noise. */
const GROWTH_MIN_PEOPLE = 1000;

const ghsName = (epoch: number) => `GHS_POP_E${epoch}_GLOBE_R2023A_4326_30ss_V1_0`;
const ghsUrl = (epoch: number) =>
  `https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E${epoch}_GLOBE_R2023A_4326_30ss/V1-0/${ghsName(epoch)}.zip`;

export const POPULATION_SOURCE = `GHS-POP R2023A, ${EPOCH} epoch, 1 km grid (European Commission JRC, CC BY 4.0)`;
export const POPULATION_GROWTH_SOURCE = `GHS-POP R2023A, ${EARLIER_EPOCH} and ${EPOCH} epochs, 1 km grid (European Commission JRC, CC BY 4.0) - change within ${RADIUS_KM} km of the centre`;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** The sum of a 1 km population grid's cells within `radiusKm` of each
 *  point (null outside the grid) - GHS-POP here, WorldPop's age groups in
 *  ageStructure.ts. */
export async function sumWithinRadius(tifPath: string, points: { lat: number; lng: number }[], radiusKm: number, step: string): Promise<(number | null)[]> {
  const image = await (await fromFile(tifPath)).getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const tileW = image.getTileWidth();
  const tileH = image.getTileHeight();
  const [west, south, east, north] = image.getBoundingBox();
  const resX = (east - west) / width;
  const resY = (north - south) / height;
  const radiusRows = Math.ceil(radiusKm / (111.32 * resY)) + 1;

  // The raster is tiled (256 or 512 cells square): only the tiles around a
  // city are decoded - most of the planet (ocean, desert, ice) is never
  // read - and each just once, kept while the cities around it are summed.
  // A window with a margin decoded each tile up to 9 times, once per
  // neighbour (2026-10-24: 6 minutes per WorldPop grid).
  const tilesAcross = Math.ceil(width / tileW);
  const groups = new Map<number, number[]>();
  points.forEach(({ lat, lng }, i) => {
    const row = Math.floor((north - lat) / resY);
    const col = Math.floor((lng - west) / resX);
    if (row < 0 || row >= height || col < 0 || col >= width) return;
    const key = Math.floor(row / tileH) * tilesAcross + Math.floor(col / tileW);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  });
  log(step, `${path.basename(tifPath)}: ${width}x${height} grid, ${groups.size} tiles with cities`);

  // Cities are taken tile row by tile row, so three rows of decoded tiles
  // cover every neighbour still needed; the oldest go first.
  const decoded = new Map<number, ArrayLike<number>>();
  const keep = tilesAcross * 3 + 8;
  const tileAt = async (tr: number, tc: number): Promise<ArrayLike<number>> => {
    const key = tr * tilesAcross + tc;
    const hit = decoded.get(key);
    if (hit) return hit;
    const window = [tc * tileW, tr * tileH, Math.min(width, (tc + 1) * tileW), Math.min(height, (tr + 1) * tileH)];
    const [data] = (await image.readRasters({ window })) as unknown as ArrayLike<number>[];
    decoded.set(key, data);
    if (decoded.size > keep) decoded.delete(decoded.keys().next().value!);
    return data;
  };
  // An edge tile can be narrower than the others.
  const widthOf = (tc: number) => Math.min(tileW, width - tc * tileW);

  const out: (number | null)[] = points.map(() => null);
  let done = 0;
  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    for (const i of groups.get(key)!) {
      const { lat, lng } = points[i];
      const row = Math.floor((north - lat) / resY);
      const col = Math.floor((lng - west) / resX);
      const radiusCols = Math.ceil(radiusRows / Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
      const [r0, r1] = [Math.max(0, row - radiusRows), Math.min(height - 1, row + radiusRows)];
      const [c0, c1] = [Math.max(0, col - radiusCols), Math.min(width - 1, col + radiusCols)];
      const [tr0, tc0] = [Math.floor(r0 / tileH), Math.floor(c0 / tileW)];
      const tiles: ArrayLike<number>[][] = [];
      for (let tr = tr0; tr <= Math.floor(r1 / tileH); tr++) {
        const rowOfTiles: ArrayLike<number>[] = [];
        for (let tc = tc0; tc <= Math.floor(c1 / tileW); tc++) rowOfTiles.push(await tileAt(tr, tc));
        tiles.push(rowOfTiles);
      }
      let people = 0;
      for (let r = r0; r <= r1; r++) {
        const pixelLat = north - (r + 0.5) * resY;
        const tr = Math.floor(r / tileH);
        const inRow = r - tr * tileH;
        for (let c = c0; c <= c1; c++) {
          const tc = Math.floor(c / tileW);
          const v = tiles[tr - tr0][tc - tc0][inRow * widthOf(tc) + (c - tc * tileW)];
          if (!(v > 0)) continue; // no data or nobody
          if (haversineKm(lat, lng, pixelLat, west + (c + 0.5) * resX) <= radiusKm) people += v;
        }
      }
      out[i] = people;
    }
    if (++done % 500 === 0) log(step, `${done}/${groups.size} tiles`);
  }
  return out;
}

/** GHS-POP's grid for one epoch, downloaded and unzipped once. */
async function ghsTif(epoch: number): Promise<string> {
  const zip = await downloadOnce(ghsUrl(epoch), `${ghsName(epoch)}.zip`);
  // One folder per epoch (2025's predates the others, so keeps its name).
  const dir = path.join(WORK_DIR, epoch === EPOCH ? "ghs-pop" : `ghs-pop-${epoch}`);
  unzipOnce(zip, dir, `${ghsName(epoch)}.tif`);
  return path.join(dir, readdirSync(dir).find((f) => f.endsWith(".tif"))!);
}

export async function sampleDensity(points: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const tif = await ghsTif(EPOCH);
  return cached(`density-${EPOCH}-${pointsKey(points)}`, async () => {
    const circleArea = Math.PI * RADIUS_KM * RADIUS_KM;
    return (await sumWithinRadius(tif, points, RADIUS_KM, "density")).map((people) => (people == null ? null : Math.round(people / circleArea)));
  });
}

/** Population growth within 5 km of the centre, EARLIER_EPOCH to EPOCH, in
 *  % (one decimal) - null where fewer than GROWTH_MIN_PEOPLE lived there. */
export async function samplePopulationGrowth(points: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const [earlierTif, laterTif] = [await ghsTif(EARLIER_EPOCH), await ghsTif(EPOCH)];
  return cached(`population-growth-${EARLIER_EPOCH}-${EPOCH}-${pointsKey(points)}`, async () => {
    const before = await sumWithinRadius(earlierTif, points, RADIUS_KM, "growth");
    const after = await sumWithinRadius(laterTif, points, RADIUS_KM, "growth");
    return points.map((_, i) => {
      const a = before[i];
      const b = after[i];
      if (a == null || b == null || a < GROWTH_MIN_PEOPLE) return null;
      return Math.round((b / a - 1) * 1000) / 10;
    });
  });
}
