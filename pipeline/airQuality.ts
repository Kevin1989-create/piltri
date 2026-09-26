import type * as H5 from "h5wasm";
import { cached, downloadOnce, log, pointsKey, round } from "./util";

/**
 * Annual mean PM2.5 (µg/m³) from the Atmospheric Composition Analysis
 * Group's satellite-derived surface PM2.5 (Washington University in St.
 * Louis, V6.GL.03, CC BY 4.0) - satellite aerosol retrievals + chemical
 * transport modelling + ground monitors, on a global 0.01° grid, hosted on
 * AWS Open Data (no account). A city's value is the average over ~2 km
 * around its centre, widening to ~10 km for coastal pixels with no data.
 * The grid covers 60°S-70°N: the few towns beyond it (northern Norway,
 * Russia, Alaska) take the nearest grid-edge value within ~400 km - Arctic
 * air is consistently clean, so the edge is a fair proxy.
 */

const YEAR = 2024;
const FILE = `V6GL03.CNNPM25.GL.${YEAR}01-${YEAR}12.nc`;
const URL = `https://satpmdata.s3.us-east-1.amazonaws.com/V6GL03/CNNPM25/Annual/GL/${FILE}`;
const BAND_ROWS = 256;
const EDGE_FALLBACK_KM = 400;

export const PM25_SOURCE = `ACAG satellite-derived PM2.5 V6.GL.03, ${YEAR} annual mean (CC BY 4.0)`;

export async function samplePm25(points: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const file = await downloadOnce(URL, FILE);
  return cached(`pm25-v2-${YEAR}-${pointsKey(points)}`, async () => {
    // ESM-only package - loaded dynamically from this CommonJS-run script.
    const h5wasm: typeof H5 = (await import("h5wasm/node")).default as any;
    await h5wasm.ready;
    const f = new h5wasm.File(file, "r");
    const pm = f.get("PM25") as H5.Dataset;
    const lats = (f.get("lat") as H5.Dataset).value as Float32Array;
    const lons = (f.get("lon") as H5.Dataset).value as Float32Array;
    const [nLat, nLon] = pm.shape as number[];
    const latStep = lats[1] - lats[0];
    const lonStep = lons[1] - lons[0];
    log("pm25", `${nLat}x${nLon} grid, reading in bands...`);

    const rowOf = (lat: number) => Math.round((lat - lats[0]) / latStep);
    const colOf = (lng: number) => Math.round((lng - lons[0]) / lonStep);
    const near = Math.max(1, Math.round(0.02 / Math.abs(latStep)));
    const far = Math.max(near, Math.round(0.1 / Math.abs(latStep)));
    const edge = Math.round(0.5 / Math.abs(latStep));
    // Beyond the grid: clamp onto its edge if the edge is close enough.
    const gridRow = (lat: number): { row: number; beyond: boolean } | null => {
      const row = rowOf(lat);
      if (row >= 0 && row < nLat) return { row, beyond: false };
      const clamped = Math.min(nLat - 1, Math.max(0, row));
      return Math.abs(lat - lats[clamped]) * 111 <= EDGE_FALLBACK_KM ? { row: clamped, beyond: true } : null;
    };

    const out: (number | null)[] = points.map(() => null);
    const order = points.map((_, i) => i).sort((a, b) => (gridRow(points[a].lat)?.row ?? -1) - (gridRow(points[b].lat)?.row ?? -1));
    let bandStart = -Infinity;
    let band: Float32Array | Float64Array | null = null;
    for (const i of order) {
      const at = gridRow(points[i].lat);
      if (!at) continue;
      const { row, beyond } = at;
      const col = colOf(points[i].lng);
      const reach = beyond ? edge : far;
      if (!band || row - reach < bandStart || Math.min(nLat - 1, row + reach) >= bandStart + BAND_ROWS) {
        bandStart = Math.max(0, row - reach);
        band = pm.slice([[bandStart, Math.min(nLat, bandStart + BAND_ROWS)], []]) as Float32Array | Float64Array;
      }
      const rowsInBand = band.length / nLon;
      for (const radius of beyond ? [far, edge] : [near, far]) {
        let sum = 0;
        let n = 0;
        for (let r = row - radius; r <= row + radius; r++) {
          const br = r - bandStart;
          if (br < 0 || br >= rowsInBand) continue;
          for (let c = col - radius; c <= col + radius; c++) {
            const v = band[br * nLon + ((c + nLon) % nLon)];
            if (Number.isFinite(v) && v >= 0 && v < 1000) {
              sum += v;
              n++;
            }
          }
        }
        if (n > 0) {
          out[i] = round(sum / n, 1);
          break;
        }
      }
    }
    f.close();
    log("pm25", `${out.filter((v) => v != null).length}/${points.length} cities have a value`);
    return out;
  });
}
