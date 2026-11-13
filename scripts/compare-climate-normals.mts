/**
 * Compares the climate figures from TerraClimate 1991-2020 (what the build
 * uses since 2026-11-13) with WorldClim 1970-2000 (before) - at reference
 * cities, and the spread of differences over every GeoNames cities1000
 * place. Sunshine is also set against measured yearly sunshine hours at
 * the 11 cities its x1.1 calibration was checked on (WMO / national
 * weather service normals, as quoted on Wikipedia - approximate).
 *
 * Usage: node --max-old-space-size=6144 --import tsx scripts/compare-climate-normals.mts
 * (needs the WorldClim rasters in the pipeline cache - any full build
 * downloads them - and pipeline/static/terraclimate-1991-2020.bin.gz).
 */
import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { climateFromMonthly, sampleNormalsMonthly, sampleWorldClimMonthly, type ClimateResult } from "../pipeline/worldclim";

const CACHE = process.env.PIPELINE_CACHE_DIR ?? path.join(os.homedir(), ".piltri-pipeline-cache");

/** Name, country, measured sunshine hours a year (null = none to hand). */
const REFERENCE: [string, string, number | null][] = [
  ["Olivet", "FR", null],
  ["Paris", "FR", null],
  ["London", "GB", 1633],
  ["Madrid", "ES", 2769],
  ["Moscow", "RU", 1731],
  ["Phoenix", "US", 3872],
  ["Singapore", "SG", 2022],
  ["Dubai", "AE", 3509],
  ["Sydney", "AU", 2636],
  ["Denver", "US", 3106],
  ["Miami", "US", 3154],
  ["Tokyo", "JP", 1927],
  ["Cairo", "EG", 3451],
  ["Reykjavík", "IS", null],
  ["Yakutsk", "RU", null],
  ["Nairobi", "KE", null],
  ["La Paz", "BO", null],
  ["Mumbai", "IN", null],
  ["Ushuaia", "AR", null],
];

type Place = { id: number; name: string; cc: string; pop: number; lat: number; lng: number };

function places(): Place[] {
  const txt = path.join(CACHE, "work", "geonames", "cities1000.txt");
  if (!existsSync(txt)) throw new Error(`cities1000.txt not found at ${txt}`);
  const out: Place[] = [];
  for (const line of readFileSync(txt, "utf8").split("\n")) {
    const c = line.split("\t");
    if (c.length < 15) continue;
    out.push({ id: Number(c[0]), name: c[1], cc: c[8], pop: Number(c[14]) || 0, lat: Number(c[4]), lng: Number(c[5]) });
  }
  return out;
}

const pct = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const fmt = (n: number | null | undefined, digits = 0) => (n == null ? "-" : n.toFixed(digits));

async function main() {
  const all = places();
  console.log(`${all.length} places; sampling WorldClim (72 rasters, a few minutes the first time)...`);
  const wcMonthly = await sampleWorldClimMonthly(all);
  const tcMonthly = sampleNormalsMonthly(all.map((p) => ({ lat: p.lat, lng: p.lng, geonameId: p.id })));
  const wc: ClimateResult[] = all.map((p, i) => climateFromMonthly(p.lat, wcMonthly[i]));
  const tc: ClimateResult[] = all.map((p, i) => climateFromMonthly(p.lat, tcMonthly[i]));

  console.log("\nReference places - WorldClim 1970-2000 -> TerraClimate 1991-2020");
  console.log("place            | mean °C       | summer high   | winter low    | rain mm       | sunshine h (measured)   | humidity %  | snow cm");
  let sunWc = 0;
  let sunTc = 0;
  let sunN = 0;
  for (const [name, cc, measured] of REFERENCE) {
    const i = all.reduce((best, p, k) => (p.name === name && p.cc === cc && (best < 0 || p.pop > all[best].pop) ? k : best), -1);
    if (i < 0) {
      console.log(`${name}: not found`);
      continue;
    }
    const a = wc[i];
    const b = tc[i];
    const pair = (x: number | null, y: number | null, d = 1) => `${fmt(x, d)} -> ${fmt(y, d)}`.padEnd(13);
    console.log(
      `${name.padEnd(16)} | ${pair(a.avgAnnualTemperatureC, b.avgAnnualTemperatureC)} | ${pair(a.hottestMonthHighC, b.hottestMonthHighC)} | ${pair(a.coldestMonthLowC, b.coldestMonthLowC)} | ${pair(a.avgAnnualRainfallMm, b.avgAnnualRainfallMm, 0)} | ${`${pair(a.avgAnnualSunshineHrs, b.avgAnnualSunshineHrs, 0)} (${measured ?? "-"})`.padEnd(23)} | ${pair(a.avgAnnualHumidityPct, b.avgAnnualHumidityPct, 0).trim().padEnd(11)} | ${pair(a.avgAnnualSnowfallCm, b.avgAnnualSnowfallCm, 0).trim()}`
    );
    if (measured && a.avgAnnualSunshineHrs && b.avgAnnualSunshineHrs) {
      sunWc += Math.abs(a.avgAnnualSunshineHrs / measured - 1);
      sunTc += Math.abs(b.avgAnnualSunshineHrs / measured - 1);
      sunN++;
    }
  }
  console.log(`\nSunshine vs measured, mean absolute error: WorldClim ${((sunWc / sunN) * 100).toFixed(1)}%, TerraClimate ${((sunTc / sunN) * 100).toFixed(1)}% (${sunN} cities)`);

  // Spread of the differences over every place both have.
  const diffs: Record<string, number[]> = { temp: [], high: [], low: [], rainPct: [], sunPct: [], humidity: [] };
  let both = 0;
  let onlyWc = 0;
  let onlyTc = 0;
  all.forEach((_, i) => {
    const a = wc[i];
    const b = tc[i];
    const has = (r: ClimateResult) => r.avgAnnualTemperatureC != null;
    if (has(a) && !has(b)) onlyWc++;
    if (!has(a) && has(b)) onlyTc++;
    if (!has(a) || !has(b)) return;
    both++;
    diffs.temp.push(b.avgAnnualTemperatureC! - a.avgAnnualTemperatureC!);
    if (a.hottestMonthHighC != null && b.hottestMonthHighC != null) diffs.high.push(b.hottestMonthHighC - a.hottestMonthHighC);
    if (a.coldestMonthLowC != null && b.coldestMonthLowC != null) diffs.low.push(b.coldestMonthLowC - a.coldestMonthLowC);
    if (a.avgAnnualRainfallMm! >= 100) diffs.rainPct.push((b.avgAnnualRainfallMm! / a.avgAnnualRainfallMm! - 1) * 100);
    if (a.avgAnnualSunshineHrs && b.avgAnnualSunshineHrs) diffs.sunPct.push((b.avgAnnualSunshineHrs / a.avgAnnualSunshineHrs - 1) * 100);
    if (a.avgAnnualHumidityPct != null && b.avgAnnualHumidityPct != null) diffs.humidity.push(b.avgAnnualHumidityPct - a.avgAnnualHumidityPct);
  });
  console.log(`\n${both} places in both; ${onlyWc} only in WorldClim, ${onlyTc} only in TerraClimate`);
  console.log("difference (TerraClimate - WorldClim) | 5%    | 25%   | median | 75%   | 95%");
  for (const [k, v] of Object.entries(diffs)) {
    const s = [...v].sort((x, y) => x - y);
    console.log(`${k.padEnd(37)} | ${[0.05, 0.25, 0.5, 0.75, 0.95].map((q) => fmt(pct(s, q), 1).padStart(5)).join(" | ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
