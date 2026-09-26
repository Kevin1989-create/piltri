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
const NAME = `GHS_POP_E${EPOCH}_GLOBE_R2023A_4326_30ss_V1_0`;
const URL = `https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E${EPOCH}_GLOBE_R2023A_4326_30ss/V1-0/${NAME}.zip`;
const RADIUS_KM = 5;

export const POPULATION_SOURCE = `GHS-POP R2023A, ${EPOCH} epoch, 1 km grid (European Commission JRC, CC BY 4.0)`;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export async function sampleDensity(points: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const zip = await downloadOnce(URL, `${NAME}.zip`);
  const dir = path.join(WORK_DIR, "ghs-pop");
  unzipOnce(zip, dir, `${NAME}.tif`);
  return cached(`density-${EPOCH}-${pointsKey(points)}`, async () => {
    const tifName = readdirSync(dir).find((f) => f.endsWith(".tif"))!;
    const image = await (await fromFile(path.join(dir, tifName))).getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const tileW = image.getTileWidth();
    const tileH = image.getTileHeight();
    const [west, , east, north] = image.getBoundingBox();
    const resX = (east - west) / width;
    const resY = (north - image.getBoundingBox()[1]) / height;
    const radiusRows = Math.ceil(RADIUS_KM / (111.32 * resY)) + 1;
    const circleArea = Math.PI * RADIUS_KM * RADIUS_KM;

    // The raster is tiled (256x256): group cities by the tile their centre
    // falls in and decode just that tile plus a margin once per group -
    // most of the planet (ocean, desert, ice) is never read.
    const groups = new Map<string, number[]>();
    points.forEach(({ lat, lng }, i) => {
      const row = Math.floor((north - lat) / resY);
      const col = Math.floor((lng - west) / resX);
      if (row < 0 || row >= height || col < 0 || col >= width) return;
      const key = `${Math.floor(row / tileH)}|${Math.floor(col / tileW)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    });
    log("density", `${width}x${height} grid, ${groups.size} tiles with cities`);

    const out: (number | null)[] = points.map(() => null);
    let done = 0;
    for (const [key, members] of groups) {
      const [tr, tc] = key.split("|").map(Number);
      const maxAbsLat = Math.max(...members.map((i) => Math.abs(points[i].lat)));
      const marginCols = Math.ceil(radiusRows / Math.max(Math.cos((maxAbsLat * Math.PI) / 180), 0.05));
      const x0 = Math.max(0, tc * tileW - marginCols);
      const y0 = Math.max(0, tr * tileH - radiusRows);
      const x1 = Math.min(width, (tc + 1) * tileW + marginCols);
      const y1 = Math.min(height, (tr + 1) * tileH + radiusRows);
      const [win] = (await image.readRasters({ window: [x0, y0, x1, y1] })) as unknown as ArrayLike<number>[];
      const winW = x1 - x0;
      for (const i of members) {
        const { lat, lng } = points[i];
        const row = Math.floor((north - lat) / resY);
        const col = Math.floor((lng - west) / resX);
        const radiusCols = Math.ceil(radiusRows / Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
        let people = 0;
        for (let r = Math.max(y0, row - radiusRows); r <= Math.min(y1 - 1, row + radiusRows); r++) {
          const pixelLat = north - (r + 0.5) * resY;
          for (let c = Math.max(x0, col - radiusCols); c <= Math.min(x1 - 1, col + radiusCols); c++) {
            const v = win[(r - y0) * winW + (c - x0)];
            if (!(v > 0)) continue; // no data or nobody
            if (haversineKm(lat, lng, pixelLat, west + (c + 0.5) * resX) <= RADIUS_KM) people += v;
          }
        }
        out[i] = Math.round(people / circleArea);
      }
      if (++done % 200 === 0) log("density", `${done}/${groups.size} tiles`);
    }
    return out;
  });
}
