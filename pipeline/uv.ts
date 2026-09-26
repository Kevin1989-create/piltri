import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { MID_MONTH_DAY } from "./worldclim";
import { fetchJson, log, RAW_DIR, round, sleep } from "./util";

/**
 * Average noon UV index, including cloud, from NASA POWER's all-sky UV
 * climatology (CERES SYN1deg, 2001-2020, 1° grid - free, no key). POWER
 * publishes the UV index as a 24-hour MEAN (e.g. Lisbon, July: 2.2), not
 * the noon peak people know from forecasts (~9). The peak is recovered
 * from the sun's path: UV scales with cos(solar zenith)^2.42 over the day
 * (Madronich's clear-sky relation; cloud scales the whole day roughly
 * uniformly), so
 *     peak = mean24 × 2π / ∫ (cos Z(ω) / cos Z(noon))^2.42 dω
 * over the daylight hour angles ω. The yearly figure is the average of the
 * 12 monthly noon peaks. A disclosed estimate.
 *
 * POWER's regional endpoint serves 10°x10° boxes; each is fetched once and
 * kept in RAW_DIR (the climatology never changes).
 */

const BOX = 10;
const UV_EXPONENT = 2.42;

async function powerBox(lat0: number, lng0: number): Promise<Map<string, number[]>> {
  const dir = path.join(RAW_DIR, "power-uv");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${lat0}_${lng0}.json`);
  let json: any;
  if (existsSync(file)) {
    json = JSON.parse(readFileSync(file, "utf8"));
  } else {
    json = await fetchJson(
      `https://power.larc.nasa.gov/api/temporal/climatology/regional?parameters=ALLSKY_SFC_UV_INDEX&community=RE` +
        `&latitude-min=${lat0}&latitude-max=${lat0 + BOX}&longitude-min=${lng0}&longitude-max=${lng0 + BOX}&format=JSON`
    );
    writeFileSync(file, JSON.stringify(json));
    await sleep(500);
  }
  const cells = new Map<string, number[]>();
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  for (const f of json.features ?? []) {
    const [lng, lat] = f.geometry.coordinates as [number, number];
    const values = f.properties?.parameter?.ALLSKY_SFC_UV_INDEX;
    if (!values) continue;
    const monthly = months.map((m) => values[m] as number);
    if (monthly.some((v) => v == null || v < 0)) continue; // -999 = fill value
    cells.set(`${Math.floor(lat)}|${Math.floor(lng)}`, monthly);
  }
  return cells;
}

/** Noon-peak UV index for a month, from its 24-hour mean. */
export function noonPeakFromDailyMean(mean24: number, lat: number, month: number): number {
  const phi = (lat * Math.PI) / 180;
  const delta = 0.409 * Math.sin((2 * Math.PI * MID_MONTH_DAY[month]) / 365 - 1.39);
  const cosNoon = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta);
  if (cosNoon <= 0.05) return 0; // polar night / sun barely up
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  const steps = 200;
  const dw = (2 * ws) / steps;
  let integral = 0;
  for (let i = 0; i < steps; i++) {
    const w = -ws + (i + 0.5) * dw;
    const cosZ = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(w);
    if (cosZ > 0) integral += (cosZ / cosNoon) ** UV_EXPONENT * dw;
  }
  return integral > 0 ? (mean24 * 2 * Math.PI) / integral : 0;
}

export async function sampleUvIndex(points: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const boxes = new Map<string, Map<string, number[]>>();
  const boxKey = (lat: number, lng: number) => `${Math.floor(lat / BOX) * BOX}|${Math.floor(lng / BOX) * BOX}`;
  const needed = [...new Set(points.map((p) => boxKey(p.lat, p.lng)))];
  log("uv", `${needed.length} NASA POWER boxes (cached after the first run)`);
  for (const key of needed) {
    const [lat0, lng0] = key.split("|").map(Number);
    boxes.set(key, await powerBox(lat0, lng0));
  }
  return points.map(({ lat, lng }) => {
    const monthly = boxes.get(boxKey(lat, lng))?.get(`${Math.floor(lat)}|${Math.floor(lng)}`);
    if (!monthly) return null;
    const peaks = monthly.map((mean, m) => noonPeakFromDailyMean(mean, lat, m));
    return round(peaks.reduce((a, b) => a + b, 0) / 12, 1);
  });
}
