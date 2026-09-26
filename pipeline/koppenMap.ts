import path from "path";
import { fromFile } from "geotiff";
import { cached, downloadOnce, log, pointsKey, unzipOnce, WORK_DIR } from "./util";

/**
 * Köppen-Geiger climate type from Beck et al. (2023), "High-resolution
 * (1 km) Köppen-Geiger maps for 1901-2099 based on constrained CMIP6
 * projections" (Scientific Data, CC BY 4.0) - the reference maps: today
 * (1991-2020) and a projection for 2071-2099 under SSP2-4.5 (a
 * middle-of-the-road emissions path). Replaces classifying WorldClim
 * 1970-2000 normals ourselves, which put borderline places on the wrong
 * side (Denver came out "humid subtropical").
 */

const URL = "https://ndownloader.figshare.com/files/61012822";
const TODAY = "1991_2020/koppen_geiger_0p00833333.tif";
const FUTURE = "2071_2099/ssp245/koppen_geiger_0p00833333.tif";
/** Coastal pixels can be sea (0): take the nearest land pixel within ~5 km. */
const RADIUS_PX = 5;

export const KOPPEN_SOURCE = "Beck et al. (2023) 1 km Köppen-Geiger maps: 1991-2020, and 2071-2099 under SSP2-4.5 (CC BY 4.0)";

const LEGEND = [
  null, "Af", "Am", "Aw", "BWh", "BWk", "BSh", "BSk", "Csa", "Csb", "Csc", "Cwa", "Cwb", "Cwc", "Cfa", "Cfb", "Cfc",
  "Dsa", "Dsb", "Dsc", "Dsd", "Dwa", "Dwb", "Dwc", "Dwd", "Dfa", "Dfb", "Dfc", "Dfd", "ET", "EF",
];

/** Nearest non-zero class at each point. The raster is tiled, so points
 *  are grouped by tile and each tile (plus a margin) is decoded once. */
async function sampleClasses(file: string, points: { lat: number; lng: number }[]): Promise<(string | null)[]> {
  const image = await (await fromFile(file)).getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const tileW = image.getTileWidth();
  const tileH = image.getTileHeight();
  const [west, south, east, north] = image.getBoundingBox();
  const resX = (east - west) / width;
  const resY = (north - south) / height;
  const groups = new Map<string, number[]>();
  points.forEach(({ lat, lng }, i) => {
    const key = `${Math.floor(Math.floor((north - lat) / resY) / tileH)}|${Math.floor(Math.floor((lng - west) / resX) / tileW)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  });
  const out: (string | null)[] = points.map(() => null);
  for (const [key, members] of groups) {
    const [tr, tc] = key.split("|").map(Number);
    const x0 = Math.max(0, tc * tileW - RADIUS_PX);
    const y0 = Math.max(0, tr * tileH - RADIUS_PX);
    const x1 = Math.min(width, (tc + 1) * tileW + RADIUS_PX);
    const y1 = Math.min(height, (tr + 1) * tileH + RADIUS_PX);
    const [win] = (await image.readRasters({ window: [x0, y0, x1, y1] })) as unknown as ArrayLike<number>[];
    for (const i of members) {
      const row = Math.floor((north - points[i].lat) / resY);
      const col = Math.floor((points[i].lng - west) / resX);
      let best = 0;
      let bestDist = Infinity;
      for (let r = Math.max(y0, row - RADIUS_PX); r <= Math.min(y1 - 1, row + RADIUS_PX); r++) {
        for (let c = Math.max(x0, col - RADIUS_PX); c <= Math.min(x1 - 1, col + RADIUS_PX); c++) {
          const v = win[(r - y0) * (x1 - x0) + (c - x0)];
          const d = (r - row) ** 2 + (c - col) ** 2;
          if (v > 0 && d < bestDist) {
            best = v;
            bestDist = d;
          }
        }
      }
      out[i] = LEGEND[best] ?? null;
    }
  }
  return out;
}

export async function sampleKoppen(points: { lat: number; lng: number }[]): Promise<{ today: (string | null)[]; future: (string | null)[] }> {
  const zip = await downloadOnce(URL, "koppen_geiger_tif.zip");
  const dir = path.join(WORK_DIR, "koppen");
  unzipOnce(zip, dir, TODAY);
  return cached(`koppen-${pointsKey(points)}`, async () => {
    const today = await sampleClasses(path.join(dir, TODAY), points);
    const future = await sampleClasses(path.join(dir, FUTURE), points);
    log("koppen", `${today.filter(Boolean).length}/${points.length} cities classified`);
    return { today, future };
  });
}
