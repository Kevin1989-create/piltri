import path from "path";
import { weightedMeanNearCities } from "./nearCities";
import { cached, downloadOnce, log, pointsKey, round } from "./util";

/**
 * Internet speed from Ookla's Speedtest open data (AWS Open Data, free, no
 * account; CC BY-NC-SA 4.0 - non-commercial, see PIPELINE_COMMERCIAL
 * below): every ~600 m map tile with its average download speed and test
 * count, one file per quarter for fixed broadband and one for mobile.
 *
 * A city's figure is the test-weighted average over tiles around its
 * centre: within 5 km when that holds at least MIN_TESTS tests, otherwise
 * widening to 15 km, then 30 km - so a small town gets its surrounding
 * area's speed rather than nothing. The radius used is stored alongside
 * and shown on the page.
 */

const BUCKET = "https://ookla-open-data.s3.us-west-2.amazonaws.com";
const RADII_KM = [5, 15, 30];
const MIN_TESTS = 30;

/** Ookla's licence is non-commercial: a commercial deployment builds with
 *  PIPELINE_COMMERCIAL=1, which leaves the speed fields empty (hidden). */
export const INCLUDE_OOKLA = !process.env.PIPELINE_COMMERCIAL;

/** Newest published quarter, e.g. "year=2026/quarter=2/2026-04-01". */
async function latestQuarter(type: "fixed" | "mobile"): Promise<{ key: string; date: string }> {
  const res = await fetch(`${BUCKET}/?list-type=2&prefix=parquet/performance/type=${type}/`, { signal: AbortSignal.timeout(60_000) });
  const keys = [...(await res.text()).matchAll(/<Key>([^<]+_performance_[a-z]+_tiles\.parquet)<\/Key>/g)].map((m) => m[1]).sort();
  const key = keys[keys.length - 1];
  if (!key) throw new Error(`No Ookla ${type} files found`);
  return { key, date: key.match(/(\d{4}-\d{2}-\d{2})_performance/)![1] };
}

export interface SpeedResult {
  mbps: (number | null)[];
  /** Radius (km) the figure was averaged over, or null with no figure. */
  radiusKm: (number | null)[];
}

export interface BroadbandResult {
  fixed: SpeedResult;
  mobile: SpeedResult;
  quarter: string | null;
}

async function speeds(file: string, cities: { lat: number; lng: number }[], label: string): Promise<SpeedResult> {
  const out: SpeedResult = { mbps: cities.map(() => null), radiusKm: cities.map(() => null) };
  let remaining = cities.map((_, i) => i);
  for (const radius of RADII_KM) {
    if (remaining.length === 0) break;
    const kbps = await weightedMeanNearCities(
      `SELECT tile_y AS lat, tile_x AS lng, avg_d_kbps AS v, tests AS w FROM read_parquet('${file}')`,
      remaining.map((i) => cities[i]),
      radius,
      MIN_TESTS
    );
    const stillMissing: number[] = [];
    kbps.forEach((v, j) => {
      const i = remaining[j];
      if (v == null) stillMissing.push(i);
      else {
        out.mbps[i] = round(v / 1000, 0);
        out.radiusKm[i] = radius;
      }
    });
    log("broadband", `${label}: ${remaining.length - stillMissing.length} cities resolved within ${radius} km`);
    remaining = stillMissing;
  }
  return out;
}

export async function sampleBroadband(cities: { lat: number; lng: number }[]): Promise<BroadbandResult> {
  const none: SpeedResult = { mbps: cities.map(() => null), radiusKm: cities.map(() => null) };
  if (!INCLUDE_OOKLA) {
    log("broadband", "PIPELINE_COMMERCIAL set - skipping Ookla speeds (non-commercial licence)");
    return { fixed: none, mobile: none, quarter: null };
  }
  const fixed = await latestQuarter("fixed");
  const mobile = await latestQuarter("mobile");
  return cached(`broadband-v2-${fixed.date}-${pointsKey(cities)}`, async () => {
    const file = async (type: "fixed" | "mobile", q: { key: string; date: string }) =>
      (await downloadOnce(`${BUCKET}/${q.key}`, `ookla-${type}-${q.date}.parquet`)).split(path.sep).join("/");
    return {
      fixed: await speeds(await file("fixed", fixed), cities, "fixed"),
      mobile: await speeds(await file("mobile", mobile), cities, "mobile"),
      quarter: fixed.date,
    };
  });
}
