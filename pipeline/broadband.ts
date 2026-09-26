import path from "path";
import { weightedMeanNearCities } from "./nearCities";
import { downloadOnce, log, pointsKey, cached, round } from "./util";

/**
 * Internet speed from Ookla's Speedtest open data (AWS Open Data, free, no
 * account; CC BY-NC-SA 4.0 - fine for a non-commercial site): every
 * ~600 m map tile with its average download speed and test count, one file
 * per quarter for fixed broadband and one for mobile. A city's figure is
 * the test-weighted average over tiles within 5 km of its centre - null
 * with fewer than MIN_TESTS tests, too few to mean anything.
 */

const BUCKET = "https://ookla-open-data.s3.us-west-2.amazonaws.com";
const RADIUS_KM = 5;
const MIN_TESTS = 30;

/** Newest published quarter, e.g. "year=2026/quarter=2/2026-04-01". */
async function latestQuarter(type: "fixed" | "mobile"): Promise<{ key: string; date: string }> {
  const res = await fetch(`${BUCKET}/?list-type=2&prefix=parquet/performance/type=${type}/`, { signal: AbortSignal.timeout(60_000) });
  const keys = [...(await res.text()).matchAll(/<Key>([^<]+_performance_[a-z]+_tiles\.parquet)<\/Key>/g)].map((m) => m[1]).sort();
  const key = keys[keys.length - 1];
  if (!key) throw new Error(`No Ookla ${type} files found`);
  return { key, date: key.match(/(\d{4}-\d{2}-\d{2})_performance/)![1] };
}

export interface BroadbandResult {
  fixedMbps: (number | null)[];
  mobileMbps: (number | null)[];
  quarter: string;
}

export async function sampleBroadband(cities: { lat: number; lng: number }[]): Promise<BroadbandResult> {
  const fixed = await latestQuarter("fixed");
  const mobile = await latestQuarter("mobile");
  return cached(`broadband-${fixed.date}-${pointsKey(cities)}`, async () => {
    const result = { fixedMbps: [] as (number | null)[], mobileMbps: [] as (number | null)[], quarter: fixed.date };
    for (const [type, q] of [["fixed", fixed], ["mobile", mobile]] as const) {
      const file = (await downloadOnce(`${BUCKET}/${q.key}`, `ookla-${type}-${q.date}.parquet`)).split(path.sep).join("/");
      log("broadband", `${type} ${q.date}: averaging Speedtest tiles within ${RADIUS_KM} km of every city...`);
      const kbps = await weightedMeanNearCities(
        `SELECT tile_y AS lat, tile_x AS lng, avg_d_kbps AS v, tests AS w FROM read_parquet('${file}')`,
        cities,
        RADIUS_KM,
        MIN_TESTS
      );
      const mbps = kbps.map((v) => (v == null ? null : round(v / 1000, 0)));
      if (type === "fixed") result.fixedMbps = mbps;
      else result.mobileMbps = mbps;
    }
    return result;
  });
}
