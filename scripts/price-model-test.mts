/**
 * Price model test (BACKLOG 11.5, owner 2026-11-12: "if we can find a model
 * we work out ourselves based on a lot of data, this would be great").
 * A measurement, not a feature: how close can a model built on what the
 * dataset knows about each place get to its real home prices, depending on
 * what real figures it can lean on?
 *
 * Real prices (open data, cached in <pipeline cache>/raw/prices):
 *  - France: DVF statistics, median price per m2 of homes sold by commune
 *    over the last 5 years (data.gouv.fr, Licence Ouverte) - communes with
 *    20+ sales; matched by INSEE code (GeoNames admin4).
 *  - US: ACS 5-year 2019-2023, median value of owner-occupied homes
 *    (B25077) / median rooms (B25018) by Census place - $ per room, the
 *    closest to a per-m2 price (Census Bureau, public domain); matched by
 *    name within 8 km (2023 Gazetteer).
 *  - Netherlands: CBS Kerncijfers wijken en buurten 2024, average WOZ
 *    value per home, by municipality or district (CC BY 4.0); matched by
 *    municipality code (GeoNames admin2) and name.
 *
 * Situations measured, each against the plain baseline of giving every
 * town its region's (or country's) average:
 *  1. Dense data - a country with open prices, a town missing (20% hidden
 *     at random): features + the prices of its nearest known towns.
 *  2. Regional averages only (what many statistics offices publish): whole
 *     regions hidden, their average known; the model learns from the other
 *     regions how towns differ from their region's average.
 *  3. Learned abroad + regional average: the same, trained in the two other
 *     countries.
 *  4. Learned abroad + national average only.
 *
 * Results, 2026-11-13 (dataset 20261111), typical (median) error FR / US / NL:
 *   national average 36/44/17%, regional average 18/31/15%;
 *   1. 7/14/8%; 2. 12/22/12%; 3. 21/30/15% (halfway: 17/29/14%);
 *   4. 24/34/25% (halfway: 27/38/18%). Summary in BACKLOG.md item 11.5.
 *
 * Usage: node --max-old-space-size=6144 --import tsx scripts/price-model-test.mts
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { CITY_FIELDS, INSIDE_KINDS } from "../lib/dataset/schema";

const CACHE = process.env.PIPELINE_CACHE_DIR ?? path.join(os.homedir(), ".piltri-pipeline-cache");
const PRICES = path.join(CACHE, "raw", "prices");
const DATA_ROOT = path.join(process.cwd(), "public", "data");
const DATA = path.join(DATA_ROOT, readdirSync(DATA_ROOT).filter((d) => /^\d{8}-/.test(d)).sort().at(-1)!);

// ---------------------------------------------------------------- places

type Row = (string | number | boolean | (number | null)[] | null)[];
interface Place {
  cc: string;
  name: string;
  lat: number;
  lng: number;
  population: number;
  row: Row;
  region: string;
  logPrice: number;
}

const F = Object.fromEntries(CITY_FIELDS.map((k, i) => [k, i])) as Record<(typeof CITY_FIELDS)[number], number>;

function datasetRows(cc: string): Row[] {
  const dir = path.join(DATA, "cities");
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${cc}-`))
    .flatMap((f) => (JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { rows: Row[] }).rows);
}

interface Gn {
  name: string;
  lat: number;
  lng: number;
  admin1: string;
  admin2: string;
  admin4: string;
}
let gnByCc: Map<string, Gn[]> | null = null;
function geonames(cc: string): Gn[] {
  if (!gnByCc) {
    gnByCc = new Map();
    for (const line of readFileSync(path.join(CACHE, "work", "geonames", "cities1000.txt"), "utf8").split("\n")) {
      const c = line.split("\t");
      if (c.length < 15) continue;
      if (!gnByCc.has(c[8])) gnByCc.set(c[8], []);
      gnByCc.get(c[8])!.push({ name: c[1], lat: +c[4], lng: +c[5], admin1: c[10], admin2: c[11], admin4: c[13] });
    }
  }
  return gnByCc.get(cc) ?? [];
}

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111.32;

/** The GeoNames entry a dataset place came from (same point, within 1 km). */
function gnFor(cc: string, lat: number, lng: number): Gn | null {
  let best: Gn | null = null;
  let bestKm = 1;
  for (const g of geonames(cc)) {
    if (Math.abs(g.lat - lat) > 0.02) continue;
    const d = km(g, { lat, lng });
    if (d < bestKm) [best, bestKm] = [g, d];
  }
  return best;
}

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function places(cc: string, price: (p: { name: string; lat: number; lng: number; gn: Gn | null }) => { logPrice: number; region: string } | null): Place[] {
  const out: Place[] = [];
  for (const row of datasetRows(cc)) {
    const name = row[F.name] as string;
    const lat = row[F.lat] as number;
    const lng = row[F.lng] as number;
    const got = price({ name, lat, lng, gn: gnFor(cc, lat, lng) });
    if (!got || !Number.isFinite(got.logPrice)) continue;
    out.push({ cc, name, lat, lng, population: (row[F.population] as number) ?? 0, row, ...got });
  }
  return out;
}

function france(): Place[] {
  const lines = readFileSync(path.join(PRICES, "dvf-stats-whole-period.csv"), "utf8").split("\n");
  const head = lines[0].split(",");
  const col = (k: string) => head.indexOf(k);
  const [cCode, cScale, cN, cMed] = [col("code_geo"), col("echelle_geo"), col("nb_ventes_whole_apt_maison"), col("med_prix_m2_whole_apt_maison")];
  const byInsee = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    if (c[cScale] !== "commune" || Number(c[cN]) < 20 || !(Number(c[cMed]) > 0)) continue;
    byInsee.set(c[cCode], Number(c[cMed]));
  }
  return places("FR", ({ gn }) => {
    const v = gn?.admin4 ? byInsee.get(gn.admin4) : undefined;
    if (!v || !gn) return null;
    return { logPrice: Math.log(v), region: gn.admin4.startsWith("97") ? gn.admin4.slice(0, 3) : gn.admin4.slice(0, 2) };
  });
}

function unitedStates(): Place[] {
  const table = (t: string) => {
    const m = new Map<string, [number, number]>();
    for (const line of readFileSync(path.join(PRICES, `us-acs5y2023-${t}.dat`), "utf8").split("\n").slice(1)) {
      const [id, e, moe] = line.split("|");
      if (id?.startsWith("1600000US")) m.set(id.slice(9), [Number(e), Number(moe)]);
    }
    return m;
  };
  const value = table("b25077");
  const rooms = table("b25018");
  const gaz = readFileSync(path.join(PRICES, "us-gaz", "2023_Gaz_place_national.txt"), "utf8")
    .split("\n")
    .slice(1)
    .map((l) => l.split("\t").map((s) => s.trim()))
    .filter((c) => c.length >= 12)
    .map((c) => ({
      geoid: c[1],
      name: plain(c[3].replace(/ (city and borough|city|town|village|borough|municipality|cdp|comunidad|zona urbana|urban county|(metropolitan|consolidated|unified) government \(balance\)|metro government \(balance\))$/i, "").replace(/ \(balance\)$/i, "")),
      lat: Number(c[10]),
      lng: Number(c[11]),
    }));
  return places("US", ({ name, lat, lng }) => {
    const n = plain(name);
    const g = gaz.find((x) => x.name === n && Math.abs(x.lat - lat) < 0.1 && km(x, { lat, lng }) < 8);
    if (!g) return null;
    const v = value.get(g.geoid);
    const r = rooms.get(g.geoid);
    // Top-coded at $2,000,001; margins over 30% are too loose to test on.
    if (!v || !r || !(v[0] > 0) || v[0] >= 2000001 || !(r[0] > 0) || v[1] / v[0] > 0.3) return null;
    return { logPrice: Math.log(v[0] / r[0]), region: g.geoid.slice(0, 2) };
  });
}

function netherlands(): Place[] {
  const woz = new Map<string, number>();
  for (const s of [0, 10000]) {
    const f = path.join(PRICES, `nl-cbs-85984-${s}.json`);
    if (!existsSync(f)) continue;
    for (const r of JSON.parse(readFileSync(f, "utf8")).value as Record<string, string | number | null>[]) {
      const v = r.GemiddeldeWOZWaardeVanWoningen_39;
      if (typeof v === "number" && v > 0) woz.set(String(r.Codering_3).trim(), v);
    }
  }
  const areas = (JSON.parse(readFileSync(path.join(PRICES, "nl-cbs-85984-areas-0.json"), "utf8")).value as { Key: string; Title: string; Municipality: string }[]).map((a) => ({
    key: a.Key.trim(),
    title: a.Title,
    gm: a.Municipality.trim(),
  }));
  const gmName = new Map(areas.filter((a) => a.key.startsWith("GM")).map((a) => [a.key, plain(a.title)]));
  const wijken = new Map<string, { key: string; name: string }[]>();
  for (const a of areas)
    if (a.key.startsWith("WK")) {
      const name = plain(a.title.replace(/^Wijk \d+\s*/i, ""));
      if (!wijken.has(a.gm)) wijken.set(a.gm, []);
      wijken.get(a.gm)!.push({ key: a.key, name });
    }
  return places("NL", ({ name, gn }) => {
    if (!gn?.admin2) return null;
    const gm = `GM${gn.admin2.padStart(4, "0")}`;
    const n = plain(name);
    let v: number | undefined;
    if (gmName.get(gm) === n) v = woz.get(gm);
    if (v == null) {
      const w = (wijken.get(gm) ?? []).find((x) => x.name === n || x.name.startsWith(`${n} `) || x.name.endsWith(` ${n}`));
      if (w) v = woz.get(w.key);
    }
    if (v == null) return null;
    return { logPrice: Math.log(v * 1000), region: gn.admin1 };
  });
}

// -------------------------------------------------------------- features

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : NaN);
const log1p = (v: unknown) => (typeof v === "number" ? Math.log1p(Math.max(0, v)) : NaN);
const field = (k: (typeof CITY_FIELDS)[number], how: (v: unknown) => number = num) => (r: Row) => how(r[F[k]]);

const BASE_FEATURES: [string, (r: Row) => number][] = [
  ["log population", (r) => Math.log(Math.max(1, num(r[F.population]) || 1))],
  ["log density 5 km", field("densityPerKm2", log1p)],
  ["elevation", field("elevationM")],
  ["mean temperature", field("avgAnnualTemperatureC")],
  ["rainfall", field("avgAnnualRainfallMm")],
  ["sunshine", field("avgAnnualSunshineHrs")],
  ["snowfall", field("avgAnnualSnowfallCm", log1p)],
  ["humidity", field("avgAnnualHumidityPct")],
  ["summer high", field("hottestMonthHighC")],
  ["winter low", field("coldestMonthLowC")],
  ["PM2.5", field("avgAnnualPm25")],
  ["coast km", field("distanceToCoastKm", log1p)],
  ["beach km", field("distanceToBeachKm", log1p)],
  ["lake beach km", field("distanceToLakeBeachKm", log1p)],
  ["mountain km", field("distanceToMountainKm", log1p)],
  ["forest km", field("distanceToForestKm", log1p)],
  ["capital km", field("distanceToCapitalKm", log1p)],
  ["intl airport km", field("distanceToIntlAirportKm", log1p)],
  ["train station km", field("distanceToTrainStationKm", log1p)],
  ["large city km", field("nearestLargeCityKm", log1p)],
  ["hospital km", field("distanceToHospitalKm", log1p)],
  ["restaurants 5 km", field("restaurantsBarsWithin5km", log1p)],
  ["parks 5 km", field("parksWithin5km", log1p)],
  ["culture 5 km", field("culturalVenuesWithin5km", log1p)],
  ["family 5 km", field("familyActivitiesWithin5km", log1p)],
  // Restaurants per resident within 5 km: visitors, second homes, money.
  [
    "restaurants per resident",
    (r) => {
      const d = num(r[F.densityPerKm2]);
      const n = num(r[F.restaurantsBarsWithin5km]);
      return d > 0 && n >= 0 ? Math.log((n + 1) / (d * 78.5 + 100)) : NaN;
    },
  ],
  ["broadband Mbps", field("broadbandDownloadMbps")],
  ["mobile Mbps", field("mobileDownloadMbps")],
  ["growth 5 yr", field("populationGrowth5yrPct")],
  ["median age", field("medianAge")],
  ["water stress", field("waterStressPct")],
  ...INSIDE_KINDS.map((k, i): [string, (r: Row) => number] => [
    `in town: ${k}`,
    (r) => {
      const v = (r[F.insideCounts] as (number | null)[] | null)?.[i];
      return v == null ? NaN : Math.log1p(v < 0 ? 0.5 : v);
    },
  ]),
];

// ------------------------------------------------------------------ model

/** A small gradient-boosted tree model (squared loss, histogram splits). */
interface Tree {
  feat: number[];
  bin: number[];
  left: number[];
  right: number[];
  value: number[];
}
const BINS = 32;

function binner(cols: Float64Array[]): ((f: number, v: number) => number)[] {
  return cols.map((col) => {
    const vals = Array.from(col).filter(Number.isFinite).sort((a, b) => a - b);
    const cuts: number[] = [];
    for (let q = 1; q < BINS - 1; q++) {
      const c = vals[Math.floor((q / (BINS - 1)) * (vals.length - 1))];
      if (c !== undefined && c !== cuts.at(-1)) cuts.push(c);
    }
    return (_f: number, v: number) => {
      if (!Number.isFinite(v)) return 0;
      let lo = 0;
      let hi = cuts.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (v <= cuts[mid]) hi = mid;
        else lo = mid + 1;
      }
      return lo + 1;
    };
  });
}

interface Gbm {
  trees: Tree[];
  base: number;
  bin: ((f: number, v: number) => number)[];
  gain: Float64Array;
}

function fitGbm(X: Float64Array[], y: Float64Array, opts = { rounds: 400, lr: 0.05, depth: 5, minLeaf: 15, lambda: 2, subsample: 0.8, colsample: 0.8 }, seed = 1): Gbm {
  const n = y.length;
  const nf = X.length;
  const bin = binner(X);
  const B = X.map((col, f) => Uint8Array.from(col, (v) => bin[f](f, v)));
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const base = y.reduce((a, b) => a + b, 0) / n;
  const pred = new Float64Array(n).fill(base);
  const res = new Float64Array(n);
  const trees: Tree[] = [];
  const gain = new Float64Array(nf);
  const sum = new Float64Array(BINS + 1);
  const cnt = new Float64Array(BINS + 1);
  for (let round = 0; round < opts.rounds; round++) {
    for (let i = 0; i < n; i++) res[i] = y[i] - pred[i];
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (rand() < opts.subsample) rows.push(i);
    const feats: number[] = [];
    for (let f = 0; f < nf; f++) if (rand() < opts.colsample) feats.push(f);
    const t: Tree = { feat: [], bin: [], left: [], right: [], value: [] };
    const grow = (idx: number[], depth: number): number => {
      const id = t.feat.length;
      t.feat.push(-1);
      t.bin.push(0);
      t.left.push(-1);
      t.right.push(-1);
      let S = 0;
      for (const i of idx) S += res[i];
      t.value.push((opts.lr * S) / (idx.length + opts.lambda));
      if (depth >= opts.depth || idx.length < 2 * opts.minLeaf) return id;
      const parent = (S * S) / (idx.length + opts.lambda);
      let best = 1e-9;
      let bf = -1;
      let bb = 0;
      for (const f of feats) {
        sum.fill(0);
        cnt.fill(0);
        const col = B[f];
        for (const i of idx) {
          sum[col[i]] += res[i];
          cnt[col[i]]++;
        }
        let sl = 0;
        let cl = 0;
        for (let b = 0; b < BINS; b++) {
          sl += sum[b];
          cl += cnt[b];
          const cr = idx.length - cl;
          if (cl < opts.minLeaf || cr < opts.minLeaf) continue;
          const sr = S - sl;
          const g = (sl * sl) / (cl + opts.lambda) + (sr * sr) / (cr + opts.lambda) - parent;
          if (g > best) [best, bf, bb] = [g, f, b];
        }
      }
      if (bf < 0) return id;
      gain[bf] += best;
      const L: number[] = [];
      const R: number[] = [];
      for (const i of idx) (B[bf][i] <= bb ? L : R).push(i);
      t.feat[id] = bf;
      t.bin[id] = bb;
      t.left[id] = grow(L, depth + 1);
      t.right[id] = grow(R, depth + 1);
      return id;
    };
    grow(rows, 0);
    trees.push(t);
    for (let i = 0; i < n; i++) pred[i] += leafValue(t, (f) => B[f][i]);
  }
  return { trees, base, bin, gain };
}

function leafValue(t: Tree, binOf: (f: number) => number): number {
  let node = 0;
  while (t.feat[node] >= 0) node = binOf(t.feat[node]) <= t.bin[node] ? t.left[node] : t.right[node];
  return t.value[node];
}

function predictGbm(m: Gbm, X: Float64Array[]): Float64Array {
  const n = X[0].length;
  const out = new Float64Array(n).fill(m.base);
  for (let i = 0; i < n; i++) {
    const cache = new Map<number, number>();
    const binOf = (f: number) => {
      let b = cache.get(f);
      if (b === undefined) cache.set(f, (b = m.bin[f](f, X[f][i])));
      return b;
    };
    for (const t of m.trees) out[i] += leafValue(t, binOf);
  }
  return out;
}

// ---------------------------------------------------------------- helpers

function weightedMedian(values: number[], weights: number[]): number {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of order) {
    acc += weights[i];
    if (acc >= total / 2) return values[i];
  }
  return values[order.at(-1)!];
}

/** Each region's (population-weighted) median log price - what a
 *  statistics office's regional average stands for. */
function regionLevels(ps: Place[]): Map<string, number> {
  const by = new Map<string, Place[]>();
  for (const p of ps) {
    if (!by.has(p.region)) by.set(p.region, []);
    by.get(p.region)!.push(p);
  }
  return new Map(
    [...by].map(([r, list]) => [
      r,
      weightedMedian(
        list.map((p) => p.logPrice),
        list.map((p) => Math.max(1000, p.population))
      ),
    ])
  );
}
const nationalLevel = (ps: Place[]) =>
  weightedMedian(
    ps.map((p) => p.logPrice),
    ps.map((p) => Math.max(1000, p.population))
  );

/** The prices of the nearest known towns: their distance-weighted mean
 *  log price (8 nearest within 100 km), and the distance to the nearest. */
function neighbours(query: Place[], known: Place[], skipSelf: boolean): [Float64Array, Float64Array] {
  const grid = new Map<string, Place[]>();
  const key = (lat: number, lng: number) => `${Math.floor(lat)},${Math.floor(lng)}`;
  for (const p of known) {
    const k = key(p.lat, p.lng);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(p);
  }
  const mean = new Float64Array(query.length).fill(NaN);
  const near = new Float64Array(query.length).fill(NaN);
  query.forEach((q, i) => {
    const cand: [number, number][] = [];
    const la = Math.floor(q.lat);
    const lo = Math.floor(q.lng);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const p of grid.get(`${la + dy},${lo + dx}`) ?? []) {
          if (skipSelf && p === q) continue;
          const d = km(p, q);
          if (d <= 100) cand.push([d, p.logPrice]);
        }
    if (!cand.length) return;
    cand.sort((a, b) => a[0] - b[0]);
    let sw = 0;
    let sv = 0;
    for (const [d, v] of cand.slice(0, 8)) {
      const w = 1 / (d + 2);
      sw += w;
      sv += w * v;
    }
    mean[i] = sv / sw;
    near[i] = Math.log1p(cand[0][0]);
  });
  return [mean, near];
}

function matrix(ps: Place[], extra: [string, Float64Array][] = [], withLatLng = false): { X: Float64Array[]; names: string[] } {
  const cols: [string, Float64Array][] = BASE_FEATURES.map(([name, f]) => [name, Float64Array.from(ps, (p) => f(p.row))]);
  if (withLatLng) cols.push(["latitude", Float64Array.from(ps, (p) => p.lat)], ["longitude", Float64Array.from(ps, (p) => p.lng)]);
  cols.push(...extra);
  return { X: cols.map((c) => c[1]), names: cols.map((c) => c[0]) };
}

interface Score {
  n: number;
  mdape: number;
  p80: number;
  within20: number;
  within30: number;
  lo: number;
  hi: number;
}
function score(actual: number[], predicted: number[]): Score {
  const e = actual.map((a, i) => a - predicted[i]).sort((x, y) => x - y);
  const ape = actual.map((a, i) => Math.abs(Math.exp(a - predicted[i]) - 1)).sort((x, y) => x - y);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  return {
    n: actual.length,
    mdape: q(ape, 0.5),
    p80: q(ape, 0.8),
    within20: ape.filter((x) => x <= 0.2).length / ape.length,
    within30: ape.filter((x) => x <= 0.3).length / ape.length,
    lo: Math.exp(q(e, 0.1)) - 1,
    hi: Math.exp(q(e, 0.9)) - 1,
  };
}
const pc = (x: number) => `${x >= 0 ? "" : "-"}${Math.round(Math.abs(x) * 100)}%`;
function line(label: string, s: Score) {
  console.log(
    `  ${label.padEnd(46)} n=${String(s.n).padStart(6)}  typical error ${pc(s.mdape).padStart(4)}  (1 in 5 over ${pc(s.p80).padStart(4)})  within 20%: ${pc(s.within20).padStart(4)}  80% range ${pc(s.lo)} to +${pc(s.hi)}`
  );
}

function shuffle<T>(xs: T[], seed = 7): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Splits into k folds - of places, or of whole regions. */
function folds(ps: Place[], k: number, byRegion: boolean): number[][] {
  const out: number[][] = Array.from({ length: k }, () => []);
  if (!byRegion) {
    shuffle(ps.map((_, i) => i)).forEach((i, j) => out[j % k].push(i));
    return out;
  }
  const regions = shuffle([...new Set(ps.map((p) => p.region))].sort());
  const fold = new Map(regions.map((r, j) => [r, j % k]));
  ps.forEach((p, i) => out[fold.get(p.region)!].push(i));
  return out;
}

// -------------------------------------------------------------- scenarios

function withinCountry(label: string, ps: Place[], importance: boolean) {
  console.log(`\n${label}: ${ps.length} places with a real price, ${new Set(ps.map((p) => p.region)).size} regions`);
  const actual = ps.map((p) => p.logPrice);
  const nat = nationalLevel(ps);
  const reg = regionLevels(ps);
  line("baseline: the country's average", score(actual, ps.map(() => nat)));
  line("baseline: the region's average", score(actual, ps.map((p) => reg.get(p.region)!)));

  // 1. Dense data: 20% of towns hidden at random; the model sees the
  //    known towns' prices around each one.
  {
    const pred = new Array<number>(ps.length);
    const gainSum = new Map<string, number>();
    for (const test of folds(ps, 5, false)) {
      const testSet = new Set(test);
      const train = ps.filter((_, i) => !testSet.has(i));
      const tst = test.map((i) => ps[i]);
      const [trM, trN] = neighbours(train, train, true);
      const [teM, teN] = neighbours(tst, train, false);
      const a = matrix(train, [["nearby known price", trM], ["nearest known km", trN]], true);
      const b = matrix(tst, [["nearby known price", teM], ["nearest known km", teN]], true);
      const m = fitGbm(a.X, Float64Array.from(train, (p) => p.logPrice));
      predictGbm(m, b.X).forEach((v, j) => (pred[test[j]] = v));
      a.names.forEach((n, f) => gainSum.set(n, (gainSum.get(n) ?? 0) + m.gain[f]));
    }
    line("1. dense data: a town hidden, its neighbours known", score(actual, pred));
    const big = ps.map((p, i) => (p.population >= 20000 ? i : -1)).filter((i) => i >= 0);
    line("   the same, towns of 20,000+", score(big.map((i) => actual[i]), big.map((i) => pred[i])));
    if (importance) {
      const total = [...gainSum.values()].reduce((a, b) => a + b, 0);
      console.log(
        "   what it leans on: " +
          [...gainSum]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([n, g]) => `${n} ${Math.round((g / total) * 100)}%`)
            .join(", ")
      );
    }
  }

  // 2. Regional averages only: whole regions hidden, their average known -
  //    given to the model as an input (how far the region sits from the
  //    country), not as a fixed starting point: a region's average is
  //    mostly its main city's, and how far a small town sits below it
  //    varies (a first try with the region's average as the starting point
  //    did no better than the average itself).
  {
    const pred = new Array<number>(ps.length);
    for (const test of folds(ps, 5, true)) {
      const testSet = new Set(test);
      const train = ps.filter((_, i) => !testSet.has(i));
      const tst = test.map((i) => ps[i]);
      const level = (list: Place[]): [string, Float64Array][] => [["region level", Float64Array.from(list, (p) => reg.get(p.region)! - nat)]];
      const m = fitGbm(matrix(train, level(train)).X, Float64Array.from(train, (p) => p.logPrice - nat));
      predictGbm(m, matrix(tst, level(tst)).X).forEach((v, j) => (pred[test[j]] = v + nat));
    }
    line("2. regional averages only (learned in-country)", score(actual, pred));
  }

  // National average only, learned in the same country (other regions).
  {
    const pred = new Array<number>(ps.length);
    for (const test of folds(ps, 5, true)) {
      const testSet = new Set(test);
      const train = ps.filter((_, i) => !testSet.has(i));
      const tst = test.map((i) => ps[i]);
      const m = fitGbm(matrix(train).X, Float64Array.from(train, (p) => p.logPrice - nat));
      predictGbm(m, matrix(tst).X).forEach((v, j) => (pred[test[j]] = v + nat));
    }
    line("   national average only (learned in-country)", score(actual, pred));
  }
}

function abroad(countries: Record<string, Place[]>) {
  console.log("\nLearned abroad (trained on the other countries, prices relative to their region's or country's average):");
  for (const [cc, ps] of Object.entries(countries)) {
    const train = Object.entries(countries)
      .filter(([c]) => c !== cc)
      .flatMap(([, p]) => p);
    const levelsOf = (list: Place[]) => {
      const out = new Map<string, number>();
      for (const c of new Set(list.map((p) => p.cc))) for (const [r, v] of regionLevels(list.filter((p) => p.cc === c))) out.set(`${c}:${r}`, v);
      return out;
    };
    const natOf = new Map(Object.entries(countries).map(([c, p]) => [c, nationalLevel(p)]));
    const trainReg = levelsOf(train);
    const testReg = levelsOf(ps);
    const actual = ps.map((p) => p.logPrice);
    const level = (list: Place[], levels: Map<string, number>): [string, Float64Array][] => [
      ["region level", Float64Array.from(list, (p) => levels.get(`${p.cc}:${p.region}`)! - natOf.get(p.cc)!)],
    ];
    const mR = fitGbm(matrix(train, level(train, trainReg)).X, Float64Array.from(train, (p) => p.logPrice - natOf.get(p.cc)!));
    const deltaR = Array.from(predictGbm(mR, matrix(ps, level(ps, testReg)).X));
    line(`3. ${cc}: regional averages + model from abroad`, score(actual, deltaR.map((v) => v + natOf.get(cc)!)));
    // Halfway between the region's average and the model: a model learned
    // elsewhere can carry the wrong country's patterns.
    line(`   ${cc}: the same, halfway to the region's average`, score(actual, deltaR.map((v, j) => (v + natOf.get(cc)! + testReg.get(`${cc}:${ps[j].region}`)!) / 2)));
    const mN = fitGbm(matrix(train).X, Float64Array.from(train, (p) => p.logPrice - natOf.get(p.cc)!));
    const deltaN = Array.from(predictGbm(mN, matrix(ps).X));
    line(`4. ${cc}: national average + model from abroad`, score(actual, deltaN.map((v) => v + natOf.get(cc)!)));
    line(`   ${cc}: the same, halfway to the national average`, score(actual, deltaN.map((v) => v / 2 + natOf.get(cc)!)));
  }
}

const t0 = Date.now();
console.log(`dataset ${path.basename(DATA)}`);
const countries: Record<string, Place[]> = { FR: france(), US: unitedStates(), NL: netherlands() };
console.log(`matched: ${Object.entries(countries).map(([c, p]) => `${c} ${p.length}`).join(", ")} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
withinCountry("France (median price per m2, DVF)", countries.FR, true);
withinCountry("United States (median home value per room, ACS)", countries.US, true);
withinCountry("Netherlands (average WOZ value per home, CBS)", countries.NL, true);
abroad(countries);
console.log(`\ndone in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
