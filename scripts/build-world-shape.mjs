// The world's land for the Saved page's globe (2026-11-08, owner: "a
// beautiful 3D world map"): public/geo/world.json, every country's outline
// simplified for a whole-globe view, from Natural Earth's 1:10m countries
// (public domain) - the file scripts/build-country-shapes.mjs downloads.
// A fixed release: run by hand when it changes and commit the output.
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const CACHE = process.env.PIPELINE_CACHE_DIR ?? path.join(os.homedir(), ".piltri-pipeline-cache");
const SOURCE = path.join(CACHE, "raw", "ne_10m_admin_0_countries.geojson");
const OUT = path.join(process.cwd(), "public", "geo", "world.json");
/** Degrees: about 15 km - finer than a phone shows of a whole globe. */
const TOLERANCE = 0.14;
/** Islands smaller than this (degrees across) are left out. */
const MIN_SIZE = 0.5;

function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const px = points[i][0] - ax;
      const py = points[i][1] - ay;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = (px - t * dx) ** 2 + (py - t * dy) ** 2;
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

const ne = JSON.parse(readFileSync(SOURCE, "utf8"));
const features = [];
let bytes = 0;
for (const f of ne.features) {
  if (!f.geometry) continue;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const out = [];
  for (const rings of polys) {
    const outer = rings[0];
    const xs = outer.map((p) => p[0]);
    const ys = outer.map((p) => p[1]);
    if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < MIN_SIZE) continue;
    const simple = rings
      .map((ring) => simplify(ring, TOLERANCE).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]))
      .filter((ring) => ring.length >= 4);
    if (simple.length) out.push(simple);
  }
  if (!out.length) continue;
  const code = [f.properties.ISO_A2_EH, f.properties.ISO_A2].find((c) => /^[A-Z]{2}$/.test(c ?? "")) ?? "";
  features.push({ type: "Feature", properties: { cc: code }, geometry: { type: "MultiPolygon", coordinates: out } });
}
mkdirSync(path.dirname(OUT), { recursive: true });
const json = JSON.stringify({ type: "FeatureCollection", features });
writeFileSync(OUT, json);
bytes = json.length;
console.log(`${features.length} countries, ${Math.round(bytes / 1024)} KB`);
