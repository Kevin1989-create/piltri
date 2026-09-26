import path from "path";
import { fromFile } from "geotiff";
import { classifyKoppen } from "@/lib/data-sources/koppen";
import { cached, downloadOnce, log, round, unzipOnce, WORK_DIR } from "./util";

/** WorldClim 2.1 monthly climate normals (1970-2000), 2.5 arc-minute
 *  (~4.5 km) grid - free, CC BY 4.0 (commercial use allowed), read with
 *  geotiff.js (pure JS, no GDAL). Replaces ~2 Open-Meteo calls per city
 *  (whose free tier is also non-commercial only). Climate normals are the
 *  standard basis for Köppen classification and don't change year to year,
 *  so this only ever needs re-running if WorldClim publishes a new edition. */
const VARIABLES = ["tavg", "prec", "srad", "vapr"] as const;
type Variable = (typeof VARIABLES)[number];

export interface ClimateResult {
  avgAnnualTemperatureC: number | null;
  avgAnnualRainfallMm: number | null;
  avgAnnualSunshineHrs: number | null;
  avgAnnualSnowfallCm: number | null;
  avgAnnualHumidityPct: number | null;
  koppenCode: string | null;
}

async function variableDir(variable: Variable): Promise<string> {
  const zip = await downloadOnce(
    `https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_2.5m_${variable}.zip`,
    `wc2.1_2.5m_${variable}.zip`
  );
  const dir = path.join(WORK_DIR, "worldclim", variable);
  unzipOnce(zip, dir, `wc2.1_2.5m_${variable}_12.tif`);
  return dir;
}

/** Samples one raster at every point. A coastal city's own pixel can be
 *  sea (no data) at this resolution, so it falls back to the nearest valid
 *  pixel within 4 cells (~18 km) rather than returning nothing. */
async function sampleRaster(file: string, points: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const tiff = await fromFile(file);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [west, south, east, north] = image.getBoundingBox();
  const resX = (east - west) / width;
  const resY = (north - south) / height;
  const noData = image.getGDALNoData();
  const [band] = (await image.readRasters()) as unknown as ArrayLike<number>[];
  const valid = (v: number) => Number.isFinite(v) && v !== noData && v > -1e30 && v !== -32768;

  return points.map(({ lat, lng }) => {
    const col = Math.floor((lng - west) / resX);
    const row = Math.floor((north - lat) / resY);
    for (let radius = 0; radius <= 4; radius++) {
      let best: number | null = null;
      let bestDist = Infinity;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const r = row + dy;
          const c = (((col + dx) % width) + width) % width;
          if (r < 0 || r >= height) continue;
          const v = band[r * width + c];
          if (!valid(v)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            best = v;
          }
        }
      }
      if (best != null) return best;
    }
    return null;
  });
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MID_MONTH_DAY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

/** Estimated monthly sunshine hours from WorldClim solar radiation, via
 *  the FAO-56 Angström-Prescott relation (Rs/Ra = a + b·n/N, a=0.25,
 *  b=0.50), scaled by 1.1. Checked against measured annual sunshine in 11
 *  reference cities (London, Madrid, Moscow, Phoenix, Singapore, Dubai,
 *  Sydney, Denver, Miami, Tokyo, Cairo): the plain formula read a
 *  consistent 3-21% low; x1.1 centres it (mean absolute error ~9%). A
 *  latitude-dependent variant (Glover & McCulloch) was tried and rejected -
 *  its errors scattered from -37% (Singapore) to +22% (Moscow), which is
 *  worse for comparing cities. A disclosed estimate, not a measured count. */
const SUNSHINE_CALIBRATION = 1.1;
function sunshineHoursPerDay(lat: number, month: number, sradKJ: number): number {
  const phi = (lat * Math.PI) / 180;
  const J = MID_MONTH_DAY[month];
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * J) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * J) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  const Ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
  const N = (24 * ws) / Math.PI;
  if (Ra <= 0.1 || N <= 0) return 0;
  const n = ((N * (sradKJ / 1000 / Ra - 0.25)) / 0.5) * SUNSHINE_CALIBRATION;
  return Math.max(0, Math.min(N, n));
}

/** Relative humidity from vapour pressure (kPa) and mean temperature. */
function relativeHumidity(vaprKPa: number, tempC: number): number {
  const es = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  return Math.max(0, Math.min(100, (100 * vaprKPa) / es));
}

/** Share of a month's precipitation falling as snow - all of it at or
 *  below -5 °C, none at or above +3 °C, linear in between (a month
 *  averaging -1 °C still has plenty of freezing days, so a narrow ramp
 *  around 0 °C undercounts continental winters). 1 mm of water ≈ 1 cm of
 *  snow (the standard 10:1 ratio). A disclosed estimate from monthly
 *  means - it can't see individual spring storms (e.g. Denver's). */
function snowFraction(tempC: number): number {
  return Math.max(0, Math.min(1, (3 - tempC) / 8));
}

export async function sampleClimate(points: { lat: number; lng: number }[]): Promise<ClimateResult[]> {
  // Raw monthly samples are the slow part (48 rasters) - cached on their
  // own so tweaking the derivations below never re-reads the rasters.
  const monthly = await cached(`worldclim-monthly-${points.length}`, async () => {
    const out: Record<Variable, (number | null)[][]> = { tavg: [], prec: [], srad: [], vapr: [] };
    for (const variable of VARIABLES) {
      const dir = await variableDir(variable);
      for (let m = 1; m <= 12; m++) {
        const file = path.join(dir, `wc2.1_2.5m_${variable}_${String(m).padStart(2, "0")}.tif`);
        out[variable].push(await sampleRaster(file, points));
        log("worldclim", `${variable} month ${m}`);
      }
    }
    return out;
  });
  {
    return points.map(({ lat }, i) => {
      const T = monthly.tavg.map((m) => m[i]);
      const P = monthly.prec.map((m) => m[i]);
      const S = monthly.srad.map((m) => m[i]);
      const V = monthly.vapr.map((m) => m[i]);
      if (T.some((v) => v == null) || P.some((v) => v == null)) {
        return {
          avgAnnualTemperatureC: null,
          avgAnnualRainfallMm: null,
          avgAnnualSunshineHrs: null,
          avgAnnualSnowfallCm: null,
          avgAnnualHumidityPct: null,
          koppenCode: null,
        };
      }
      const t = T as number[];
      const p = P as number[];
      const sunshine = S.every((v) => v != null)
        ? (S as number[]).reduce((sum, s, m) => sum + sunshineHoursPerDay(lat, m, s) * DAYS_IN_MONTH[m], 0)
        : null;
      const humidity = V.every((v) => v != null) ? (V as number[]).reduce((sum, v, m) => sum + relativeHumidity(v, t[m]), 0) / 12 : null;
      return {
        avgAnnualTemperatureC: round(t.reduce((a, b) => a + b, 0) / 12, 1),
        avgAnnualRainfallMm: Math.round(p.reduce((a, b) => a + b, 0)),
        avgAnnualSunshineHrs: sunshine != null ? Math.round(sunshine) : null,
        avgAnnualSnowfallCm: Math.round(p.reduce((sum, v, m) => sum + v * snowFraction(t[m]), 0)),
        avgAnnualHumidityPct: humidity != null ? Math.round(humidity) : null,
        koppenCode: classifyKoppen(t, p, lat),
      };
    });
  }
}
