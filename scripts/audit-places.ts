// Worldwide data audit of the published dataset (2026-11-10, owner: "the
// same rigorous approach on all cities in the world"): per country, the
// share of 50k+ places with a train station / hospital / tram / metro in the
// city; station and hospital names that read like something else;
// hospitals named after a faraway city; 200k+ places with none.
// Usage: npx tsx scripts/audit-places.ts public/data/<version> <out dir>
import { readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { INSIDE_KINDS, decodeCity } from "../lib/dataset/schema";

const dir = process.argv[2];
const out = process.argv[3];
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
const K = (k: string) => (INSIDE_KINDS as readonly string[]).indexOf(k);
const TRAIN = K("train"), TRAM = K("tram"), METRO = K("metro"), HOSP = K("hospital");

type P = [number, number, string];
type C = { id: string; cc: string; name: string; lat: number; lng: number; pop: number; counts: number[] | null; nearest: (number | null)[] | null; inside: (P[] | 0)[] | null };
const cities: C[] = [];
for (const f of readdirSync(path.join(dir, "cities"))) {
  const cc = f.split("-")[0];
  const rows = JSON.parse(readFileSync(path.join(dir, "cities", f), "utf8")).rows;
  let inside: Record<string, (P[] | 0)[]> = {};
  try { inside = JSON.parse(readFileSync(path.join(dir, "inside", f), "utf8")); } catch {}
  for (const row of rows) {
    const r = decodeCity(row, cc) as any;
    cities.push({ id: r.id, cc, name: r.name, lat: r.lat, lng: r.lng, pop: r.population ?? 0, counts: r.insideCounts ?? null, nearest: r.insideNearestKm ?? null, inside: inside[r.id] ?? null });
  }
}
const lines: string[] = [];
const log = (s = "") => lines.push(s);
log(`dataset ${manifest.version}: ${cities.length} places`);

// A. Per country, places of 50k+: share with a train station / hospital / tram in the city.
const byCc = new Map<string, C[]>();
for (const c of cities) if (c.pop >= 50000) (byCc.get(c.cc) ?? byCc.set(c.cc, []).get(c.cc)!).push(c);
const has = (c: C, k: number) => (c.counts?.[k] ?? 0) !== 0;
const rowsA = [...byCc].filter(([, v]) => v.length >= 5).map(([cc, v]) => ({
  cc, name: manifest.countryNames[cc], n: v.length,
  train: Math.round((100 * v.filter((c) => has(c, TRAIN)).length) / v.length),
  hosp: Math.round((100 * v.filter((c) => has(c, HOSP)).length) / v.length),
  tram: Math.round((100 * v.filter((c) => has(c, TRAM)).length) / v.length),
  metro: Math.round((100 * v.filter((c) => has(c, METRO)).length) / v.length),
}));
log("\n== A. Places of 50k+ with a hospital in the city, lowest first (countries with 5+ such places)");
for (const r of [...rowsA].sort((a, b) => a.hosp - b.hosp)) log(`${r.cc} ${r.name.padEnd(28)} n=${String(r.n).padStart(4)}  hospital ${String(r.hosp).padStart(3)}%  train ${String(r.train).padStart(3)}%  tram ${String(r.tram).padStart(3)}%  metro ${String(r.metro).padStart(3)}%`);

// B. Station names that read like something else.
const NOT_TRAIN = /\b(tram|tramway|straßenbahn|strassenbahn|bus|busbahnhof|autobus|coach|u-bahn|subway|metro|métro|metrô|arr[eê]t|haltestelle|ferry|cable car|funicular|light rail|lrt|brt|parking|depot|dépôt|yard|museum|heritage)\b/i;
const sus: Record<string, string[]> = {};
let trainCount = 0;
for (const c of cities) {
  const t = c.inside?.[TRAIN];
  if (!t) continue;
  for (const [, , n] of t) {
    trainCount++;
    if (NOT_TRAIN.test(n)) (sus[c.cc] ??= []).push(`${c.name}: ${n}`);
  }
}
const susN = Object.values(sus).reduce((a, v) => a + v.length, 0);
log(`\n== B. Train stations named like a tram/bus/metro/other: ${susN} of ${trainCount}`);
for (const [cc, v] of Object.entries(sus).sort((a, b) => b[1].length - a[1].length).slice(0, 25)) log(`${cc} ${v.length}: ${v.slice(0, 6).join(" | ")}`);

// C. Hospital names that read like something else.
const NOT_HOSP = /(dental|dentist|dentaire|zahn|veterin|v[eé]t[eé]rinaire|animal|pet |tierklinik|tier|rééducation|reeducation|réadaptation|readaptation|\bssr\b|rehab|\breha\b|kur|spa\b|beauty|esth[eé]ti|laser|cosmetic|plastic surgery|fertility|ivf|optic|eye clinic|pharmac|apotheke|labor|laboratoire|imaging|radiolog|blood bank|hospice|nursing home|ehpad|maison de retraite|care home|psycholog|counsel|physio|kiné|chiropract|day hospital|hôpital de jour|parking|car park|entrance|entrée|pavillon|building|bâtiment|office|bureau|administration|foundation|fondation|school|école|universit)/i;
const susH: Record<string, string[]> = {};
let hospCount = 0;
for (const c of cities) {
  const h = c.inside?.[HOSP];
  if (!h) continue;
  for (const [, , n] of h) {
    hospCount++;
    if (NOT_HOSP.test(n)) (susH[c.cc] ??= []).push(`${c.name}: ${n}`);
  }
}
const susHN = Object.values(susH).reduce((a, v) => a + v.length, 0);
log(`\n== C. Hospitals named like something else: ${susHN} of ${hospCount}`);
for (const [cc, v] of Object.entries(susH).sort((a, b) => b[1].length - a[1].length).slice(0, 30)) log(`${cc} ${v.length}: ${v.slice(0, 8).join(" | ")}`);

// D. Hospitals named after a big city far away (Hyderabad listed in London).
const big = cities.filter((c) => c.pop >= 250000 && c.name.length >= 5);
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const bigByName = new Map<string, C[]>();
for (const c of cities.filter((c) => c.pop >= 20000)) (bigByName.get(norm(c.name)) ?? bigByName.set(norm(c.name), []).get(norm(c.name))!).push(c);
const km = (a: number, b: number, c: number, d: number) => {
  const R = 6371, r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const bigNames = [...new Set(big.map((c) => norm(c.name)))];
const bigRe = new RegExp(`\\b(${bigNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`);
const far: string[] = [];
for (const kind of [HOSP, TRAIN]) {
  for (const c of cities) {
    const list = c.inside?.[kind];
    if (!list) continue;
    for (const [lng, lat, n] of list) {
      const m = norm(n).match(bigRe);
      if (!m) continue;
      const namesakes = bigByName.get(m[1]) ?? [];
      const nearest = Math.min(...namesakes.map((s) => km(lat, lng, s.lat, s.lng)));
      if (nearest > 150) far.push(`${kind === HOSP ? "hospital" : "station"} ${c.cc} ${c.name}: "${n}" - nearest ${m[1]} ${Math.round(nearest)} km`);
    }
  }
}
log(`\n== D. Hospitals and stations named after a big city 150+ km away: ${far.length}`);
for (const s of far.slice(0, 120)) log(s);

// E. Big places (200k+) with no hospital / no train station in the city.
for (const [label, k] of [["hospital", HOSP], ["train station", TRAIN]] as const) {
  const miss = cities.filter((c) => c.pop >= 200000 && c.counts && !has(c, k));
  log(`\n== E. Places of 200k+ with no ${label} in the city: ${miss.length} of ${cities.filter((c) => c.pop >= 200000).length}`);
  const g: Record<string, string[]> = {};
  for (const c of miss.sort((a, b) => b.pop - a.pop)) (g[c.cc] ??= []).push(`${c.name} (${Math.round(c.pop / 1000)}k, nearest ${c.nearest?.[k] ?? "-"} km)`);
  for (const [cc, v] of Object.entries(g).sort((a, b) => b[1].length - a[1].length)) log(`${cc} ${v.length}: ${v.slice(0, 10).join(", ")}`);
}

writeFileSync(path.join(out, "audit.txt"), lines.join("\n"));
console.log(lines.slice(0, 3).join("\n"), "\n... written", lines.length, "lines");
