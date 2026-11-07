// Country silhouettes for the city map's locator (2026-11-07, owner: "a
// small square with the country where it is"): public/geo/countries/<CC>.json,
// one small file per country, read by components/explore/CountryLocator.tsx.
//
// From Natural Earth's 1:10m countries (public domain), the same source as
// the pipeline's coastline. A country's parts are grouped into clusters -
// parts less than GAP_KM apart - so mainland France and Corsica are one,
// and Réunion, Guiana... others; the locator draws the cluster the city is
// in. GeoNames lists some territories as countries of their own (Réunion
// RE, Puerto Rico PR...) where Natural Earth folds them into another: those
// get the cluster their largest town is in.
//
// A fixed release: run by hand when it changes (node scripts/build-country-
// shapes.mjs) and commit the output.
import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const CACHE = process.env.PIPELINE_CACHE_DIR ?? path.join(os.homedir(), ".piltri-pipeline-cache");
const RAW = path.join(CACHE, "raw");
const OUT = path.join(process.cwd(), "public", "geo", "countries");
const NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson";
const GAP_KM = 400;
const KM_PER_DEG = 111.32;

async function download(url, file) {
  const dest = path.join(RAW, file);
  if (existsSync(dest)) return dest;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

const bboxOf = (rings) => {
  let [minx, miny, maxx, maxy] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  return [minx, miny, maxx, maxy];
};

/** Kilometres between two boxes (0 if they touch). */
function gapKm(a, b) {
  const midLat = ((Math.max(a[1], b[1]) + Math.min(a[3], b[3])) / 2) * (Math.PI / 180);
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]) * KM_PER_DEG * Math.cos(midLat);
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]) * KM_PER_DEG;
  return Math.hypot(dx, dy);
}

/** Douglas-Peucker on [x, y] points, x scaled by cos(latitude). */
function simplify(points, tolerance, kx) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const px = (points[i][0] - ax) * kx;
      const py = points[i][1] - ay;
      let d;
      if (len2 === 0) d = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const qx = px - t * dx;
        const qy = py - t * dy;
        d = qx * qx + qy * qy;
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([first, best], [best, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A country's parts (polygons: outer ring + holes), across the
 *  antimeridian kept together (Russia's far east, Fiji). */
function partsOf(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const parts = polys.map((rings) => ({ rings, box: bboxOf([rings[0]]) }));
  const spread = Math.max(...parts.map((p) => p.box[2])) - Math.min(...parts.map((p) => p.box[0]));
  if (spread > 180) {
    // Towards the largest part's side: the Aleutians join the United
    // States west of -180, Chukotka joins Russia east of 180.
    const size = (p) => (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]);
    const largest = parts.reduce((a, b) => (size(b) > size(a) ? b : a));
    const east = largest.box[0] + largest.box[2] > 0;
    for (const p of parts) {
      const shift = east && p.box[2] <= 0 ? 360 : !east && p.box[0] >= 0 ? -360 : 0;
      if (shift) {
        p.rings = p.rings.map((ring) => ring.map(([x, y]) => [x + shift, y]));
        p.box = bboxOf([p.rings[0]]);
      }
    }
  }
  return parts;
}

/** Parts less than GAP_KM apart, grouped (union-find). */
function clustersOf(parts) {
  const parent = parts.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) if (find(i) !== find(j) && gapKm(parts[i].box, parts[j].box) < GAP_KM) parent[find(i)] = find(j);
  const groups = new Map();
  parts.forEach((p, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p);
  });
  return [...groups.values()];
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** One cluster, drawn at the locator's size: rings simplified to about
 *  1/300 of its span, the specks left out, coordinates rounded to match. */
function encodeCluster(parts) {
  const box = bboxOf(parts.map((p) => p.rings[0]));
  const kx = Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180);
  const span = Math.max((box[2] - box[0]) * kx, box[3] - box[1]);
  const tolerance = Math.max(span / 300, 0.0005);
  const digits = tolerance < 0.001 ? 4 : tolerance < 0.01 ? 3 : 2;
  const rings = [];
  let area = 0;
  for (const p of parts) {
    for (const ring of p.rings) {
      const b = bboxOf([ring]);
      const size = Math.max((b[2] - b[0]) * kx, b[3] - b[1]);
      if (size < tolerance * 2.5) continue;
      const simple = simplify(ring, tolerance, kx);
      if (simple.length < 4) continue;
      rings.push(simple.flatMap(([x, y]) => [round(x, digits), round(y, digits)]));
      area += (b[2] - b[0]) * kx * (b[3] - b[1]);
    }
  }
  return { b: box.map((v) => round(v, 3)), r: rings, area };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const ne = JSON.parse(readFileSync(await download(NE_URL, "ne_10m_admin_0_countries.geojson"), "utf8"));
  const code = (p) => [p.ISO_A2_EH, p.ISO_A2, p.WB_A2].find((c) => typeof c === "string" && /^[A-Z]{2}$/.test(c));
  // Features sharing a code are one country (France and Clipperton
  // Island are both FR), named after its biggest.
  const byCode = new Map();
  for (const f of ne.features) {
    const cc = code(f.properties);
    if (!cc || !f.geometry) continue;
    const parts = partsOf(f.geometry);
    const size = parts.reduce((s, p) => s + (p.box[2] - p.box[0]) * (p.box[3] - p.box[1]), 0);
    const c = byCode.get(cc) ?? { cc, name: f.properties.NAME, size: 0, parts: [] };
    if (size > c.size) [c.name, c.size] = [f.properties.NAME, size];
    c.parts.push(...parts);
    byCode.set(cc, c);
  }
  const countries = [...byCode.values()].map((c) => ({ ...c, clusters: clustersOf(c.parts) }));
  const written = new Set();
  let bytes = 0;
  const write = (cc, name, clusters) => {
    const encoded = clusters.map(encodeCluster).filter((c) => c.r.length).sort((a, b) => b.area - a.area).map(({ b, r }) => ({ b, r }));
    if (!encoded.length) return;
    const json = JSON.stringify({ name, clusters: encoded });
    writeFileSync(path.join(OUT, `${cc}.json`), json);
    written.add(cc);
    bytes += json.length;
  };
  for (const c of countries) write(c.cc, c.name, c.clusters);

  // GeoNames' own countries Natural Earth folds into another: the cluster
  // their largest town is in.
  const info = readFileSync(path.join(RAW, "countryInfo.txt"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"))
    .map((c) => ({ cc: c[0], name: c[4] }));
  const missing = new Map(info.filter((c) => !written.has(c.cc)).map((c) => [c.cc, c.name]));
  const tmp = path.join(CACHE, "work", "country-shapes");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  execSync(`unzip -o -q "${path.join(RAW, "cities1000.zip")}" -d "${tmp}"`);
  const biggest = new Map();
  for (const line of readFileSync(path.join(tmp, "cities1000.txt"), "utf8").split("\n")) {
    const c = line.split("\t");
    const cc = c[8];
    if (!missing.has(cc)) continue;
    const pop = Number(c[14]) || 0;
    if (!biggest.has(cc) || pop > biggest.get(cc).pop) biggest.set(cc, { lat: Number(c[4]), lng: Number(c[5]), pop });
  }
  rmSync(tmp, { recursive: true, force: true });
  const aliases = [];
  for (const [cc, at] of biggest) {
    // The part the town is in - or, for a town on the waterline (Fort-de-
    // France), the nearest part within 30 km.
    const xs = [at.lng, at.lng + 360, at.lng - 360];
    const contains = (p) => xs.some((x) => x >= p.box[0] && x <= p.box[2] && at.lat >= p.box[1] && at.lat <= p.box[3] && inRing(x, at.lat, p.rings[0]));
    const kx = Math.cos((at.lat * Math.PI) / 180);
    /** Km to the part's nearest corner of its outline. */
    const nearKm = (p) => {
      let best = Infinity;
      for (const x of xs) for (const [px, py] of p.rings[0]) best = Math.min(best, Math.hypot((px - x) * kx, py - at.lat) * KM_PER_DEG);
      return best;
    };
    let best = null;
    for (const c of countries)
      for (const cluster of c.clusters)
        for (const p of cluster) {
          if (xs.every((x) => gapKm(p.box, [x, at.lat, x, at.lat]) > 30)) continue;
          const d = contains(p) ? 0 : nearKm(p);
          if (d < 30 && (!best || d < best.d)) best = { d, owner: c, cluster };
        }
    if (!best) continue;
    write(cc, missing.get(cc), [best.cluster]);
    aliases.push(`${cc}→${best.owner.cc}`);
  }
  console.log(`${written.size} countries, ${Math.round(bytes / 1024)} KB; from another's shape: ${aliases.join(" ")}`);
  console.log(`no shape: ${info.filter((c) => !written.has(c.cc)).map((c) => c.cc).join(" ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
