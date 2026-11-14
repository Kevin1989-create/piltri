/**
 * Momentum test (BACKLOG 11.2-3, owner 2026-11-14: "test the momentum").
 * A measurement, not a feature: does what changed in a place - measured,
 * not projected - tell where its prices went next?
 *
 * Signal: night-time lights (annual VIIRS composites, 500 m - Hengl et
 * al. on Zenodo 17294744, CC BY 4.0; measured from 2012), summed within
 * 2 km and 5 km of each place's centre: 2014-2015 vs 2020-2021.
 * Outcome: France, DVF monthly statistics per commune (data.gouv.fr,
 * Licence Ouverte) - sales-weighted price per m2, 2022 vs 2025 (the file
 * keeps 5 years, from July 2021).
 * Benchmarks: static figures (the lights' level, population, density).
 *
 * Measured as rank correlations (Spearman) - nationally, and within each
 * département (both sides less the département's median), so a regional
 * trend can't pass for a local signal - and as growth by quintile.
 *
 * Usage: node --max-old-space-size=8192 --import tsx scripts/momentum-test.mts
 * (inputs in <pipeline cache>/raw/momentum, GeoNames in work/geonames).
 */
import { readdirSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { fromFile } from "geotiff";
import { CITY_FIELDS } from "../lib/dataset/schema";

const CACHE = process.env.PIPELINE_CACHE_DIR ?? path.join(os.homedir(), ".piltri-pipeline-cache");
const RAW = path.join(CACHE, "raw", "momentum");
const DATA_ROOT = path.join(process.cwd(), "public", "data");
const DATA = path.join(DATA_ROOT, readdirSync(DATA_ROOT).filter((d) => /^\d{8}-/.test(d)).sort().at(-1)!);
const F = Object.fromEntries(CITY_FIELDS.map((k, i) => [k, i])) as Record<(typeof CITY_FIELDS)[number], number>;
const MIN_SALES = 30;

type Row = (string | number | boolean | (number | null)[] | null)[];

// ---- French places, with their INSEE code (GeoNames admin4) ----
interface Place {
  name: string;
  lat: number;
  lng: number;
  population: number;
  density: number | null;
  piltri: number | null;
  insee: string;
  dept: string;
}

function frenchPlaces(): Place[] {
  const gn: { lat: number; lng: number; admin4: string }[] = [];
  for (const line of readFileSync(path.join(CACHE, "work", "geonames", "cities1000.txt"), "utf8").split("\n")) {
    const c = line.split("\t");
    if (c[8] === "FR" && c[13]) gn.push({ lat: +c[4], lng: +c[5], admin4: c[13] });
  }
  const dir = path.join(DATA, "cities");
  const out: Place[] = [];
  for (const f of readdirSync(dir).filter((f) => f.startsWith("FR-"))) {
    for (const row of (JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { rows: Row[] }).rows) {
      const lat = row[F.lat] as number;
      const lng = row[F.lng] as number;
      let best: (typeof gn)[number] | null = null;
      let bestD = 1e-4;
      for (const g of gn) {
        const d = (g.lat - lat) ** 2 + (g.lng - lng) ** 2;
        if (d < bestD) [best, bestD] = [g, d];
      }
      if (!best) continue;
      const insee = best.admin4;
      out.push({
        name: row[F.name] as string,
        lat,
        lng,
        population: (row[F.population] as number) ?? 0,
        density: (row[F.densityPerKm2] as number) ?? null,
        piltri: null,
        insee,
        dept: insee.startsWith("97") ? insee.slice(0, 3) : insee.slice(0, 2),
      });
    }
  }
  return out;
}

// ---- Night lights within a radius ----
async function lightsSums(file: string, places: Place[], radiiKm: number[]): Promise<Float64Array[]> {
  const image = await (await fromFile(file)).getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const resX = (east - west) / image.getWidth();
  const resY = (north - south) / image.getHeight();
  // One window around all the places (plus the largest radius).
  const pad = Math.max(...radiiKm) / 80;
  const minLng = Math.min(...places.map((p) => p.lng)) - pad;
  const maxLng = Math.max(...places.map((p) => p.lng)) + pad;
  const minLat = Math.min(...places.map((p) => p.lat)) - pad;
  const maxLat = Math.max(...places.map((p) => p.lat)) + pad;
  const x0 = Math.max(0, Math.floor((minLng - west) / resX));
  const x1 = Math.min(image.getWidth(), Math.ceil((maxLng - west) / resX));
  const y0 = Math.max(0, Math.floor((north - maxLat) / resY));
  const y1 = Math.min(image.getHeight(), Math.ceil((north - minLat) / resY));
  const [band] = (await image.readRasters({ window: [x0, y0, x1, y1] })) as unknown as ArrayLike<number>[];
  const w = x1 - x0;
  const noData = image.getGDALNoData();
  return radiiKm.map((r) =>
    Float64Array.from(places, (p) => {
      const kmPerDegY = 111.32;
      const kmPerDegX = 111.32 * Math.cos((p.lat * Math.PI) / 180);
      const dy = Math.ceil(r / kmPerDegY / resY);
      const dx = Math.ceil(r / kmPerDegX / resX);
      const cx = Math.floor((p.lng - west) / resX) - x0;
      const cy = Math.floor((north - p.lat) / resY) - y0;
      let sum = 0;
      for (let y = cy - dy; y <= cy + dy; y++)
        for (let x = cx - dx; x <= cx + dx; x++) {
          if (x < 0 || y < 0 || x >= w || y >= y1 - y0) continue;
          const kmx = (x - cx) * resX * kmPerDegX;
          const kmy = (y - cy) * resY * kmPerDegY;
          if (kmx * kmx + kmy * kmy > r * r) continue;
          const v = band[y * w + x];
          if (Number.isFinite(v) && v !== noData && v > 0) sum += v;
        }
      return sum;
    })
  );
}

// ---- DVF: each commune's sales-weighted price per m2, per year ----
function dvfByYear(years: number[]): Map<string, Map<number, { n: number; price: number }>> {
  const text = readFileSync(path.join(RAW, "dvf-monthly.csv"), "utf8");
  const lines = text.split("\n");
  const head = lines[0].split(",");
  const col = (k: string) => {
    const i = head.indexOf(k);
    if (i < 0) throw new Error(`DVF: no column ${k} - columns: ${head.join(", ")}`);
    return i;
  };
  const [cCode, cScale, cMonth, cN, cMed] = [col("code_geo"), col("echelle_geo"), col("annee_mois"), col("nb_ventes_apt_maison"), col("med_prix_m2_apt_maison")];
  const acc = new Map<string, Map<number, { n: number; sum: number }>>();
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    if (c[cScale] !== "commune") continue;
    const year = Number(String(c[cMonth]).slice(0, 4));
    if (!years.includes(year)) continue;
    const n = Number(c[cN]);
    const med = Number(c[cMed]);
    if (!(n > 0) || !(med > 0)) continue;
    let byYear = acc.get(c[cCode]);
    if (!byYear) acc.set(c[cCode], (byYear = new Map()));
    const a = byYear.get(year) ?? { n: 0, sum: 0 };
    a.n += n;
    a.sum += n * med;
    byYear.set(year, a);
  }
  return new Map([...acc].map(([code, m]) => [code, new Map([...m].map(([y, a]) => [y, { n: a.n, price: a.sum / a.n }]))]));
}

// ---- Statistics ----
function ranks(v: number[]): number[] {
  const order = v.map((_, i) => i).sort((a, b) => v[a] - v[b]);
  const r = new Array<number>(v.length);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && v[order[j + 1]] === v[order[k]]) j++;
    for (let m = k; m <= j; m++) r[order[m]] = (k + j) / 2;
    k = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}
const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
/** Each value less its group's median. */
function demean(v: number[], groups: string[]): number[] {
  const by = new Map<string, number[]>();
  v.forEach((x, i) => {
    if (!by.has(groups[i])) by.set(groups[i], []);
    by.get(groups[i])!.push(x);
  });
  const med = new Map([...by].map(([g, xs]) => [g, median(xs)]));
  return v.map((x, i) => x - med.get(groups[i])!);
}
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

async function main() {
  const t0 = Date.now();
  const places = frenchPlaces();
  console.log(`${places.length} French places matched to an INSEE code (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  // The monthly statistics cover July 2021 on (Etalab keeps 5 years): the
  // outcome is 2022 to 2025, full years; the signal 2014/15 to 2020/21.
  const [BASE, END] = [2022, 2025];
  const dvf = dvfByYear([BASE, END]);
  const radii = [2, 5];
  const lights = new Map<number, Float64Array[]>();
  for (const y of [2014, 2015, 2020, 2021, 2024]) {
    lights.set(y, await lightsSums(path.join(RAW, `lights-${y}.tif`), places, radii));
    console.log(`lights ${y} sampled`);
  }
  const avg = (a: number, b: number, r: number, i: number) => (lights.get(a)![r][i] + lights.get(b)![r][i]) / 2;

  // Places with enough sales in both years, and lights to compare.
  type Obs = { p: Place; growth: number; l2: number; l5: number; level5: number; l5later: number };
  const obs: Obs[] = [];
  places.forEach((p, i) => {
    const d = dvf.get(p.insee);
    const a = d?.get(BASE);
    const b = d?.get(END);
    if (!a || !b || a.n < MIN_SALES || b.n < MIN_SALES) return;
    const before2 = avg(2014, 2015, 0, i);
    const before5 = avg(2014, 2015, 1, i);
    const after5 = avg(2020, 2021, 1, i);
    if (before2 <= 0 || before5 <= 0 || after5 <= 0) return;
    obs.push({
      p,
      growth: Math.log(b.price / a.price),
      l2: Math.log(avg(2020, 2021, 0, i) / before2),
      l5: Math.log(after5 / before5),
      level5: Math.log(after5),
      l5later: Math.log(lights.get(2024)![1][i] / after5),
    });
  });
  // One commune once (several places can share one).
  const seen = new Set<string>();
  const uniq = obs.filter((o) => (seen.has(o.p.insee) ? false : (seen.add(o.p.insee), true)));
  const growth = uniq.map((o) => o.growth);
  const depts = uniq.map((o) => o.p.dept);
  console.log(`\n${uniq.length} communes with ${MIN_SALES}+ sales in ${BASE} and ${END}; median price growth ${BASE}-${END} ${pct(Math.exp(median(growth)) - 1)}`);

  const report = (label: string, values: (number | null)[]) => {
    const idx = values.map((v, i) => (v != null && Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
    const x = idx.map((i) => values[i]!);
    const y = idx.map((i) => growth[i]);
    const g = idx.map((i) => depts[i]);
    const nat = spearman(x, y);
    const within = spearman(demean(x, g), demean(y, g));
    console.log(`  ${label.padEnd(44)} n=${String(idx.length).padStart(5)}  national ${nat.toFixed(2).padStart(5)}   within département ${within.toFixed(2).padStart(5)}`);
  };
  console.log(`\nRank correlation with price growth ${BASE}-${END} (1 = perfect, 0 = none):`);
  report("lights change 2014/15-2020/21, within 2 km", uniq.map((o) => o.l2));
  report("lights change 2014/15-2020/21, within 5 km", uniq.map((o) => o.l5));
  report("benchmark: lights level 2020/21, within 5 km", uniq.map((o) => o.level5));
  report("benchmark: log population", uniq.map((o) => Math.log(Math.max(1, o.p.population))));
  report("benchmark: log density", uniq.map((o) => (o.p.density ? Math.log(o.p.density) : null)));
  report("(same period, not a prediction) lights 2020/21-2024", uniq.map((o) => o.l5later));

  // Growth by quintile of the 5 km lights signal, within département.
  const x = demean(uniq.map((o) => o.l5), depts);
  const y = demean(growth, depts);
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  console.log("\nPrice growth vs the département's median, by quintile of the lights change (5 km):");
  for (let q = 0; q < 5; q++) {
    const part = order.slice(Math.floor((q * order.length) / 5), Math.floor(((q + 1) * order.length) / 5));
    console.log(`  quintile ${q + 1} (${q === 0 ? "dimmed most" : q === 4 ? "brightened most" : "middle"}): ${pct(Math.exp(median(part.map((i) => y[i]))) - 1)}`);
  }
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
