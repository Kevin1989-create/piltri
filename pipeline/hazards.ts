import { readFileSync } from "fs";
import { cached, downloadOnce, fetchWithRetry, log, sleep } from "./util";
import type { PointSet } from "./geonames";

/** Natural Earth 1:10m coastline (public domain), densified so no gap
 *  between consecutive points exceeds ~1 km - distance-to-nearest-point is
 *  then within ~0.5 km of the true distance to the line itself. */
export async function loadCoastlinePoints(): Promise<PointSet> {
  return cached("coastline-points", async () => {
    const file = await downloadOnce(
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson",
      "ne_10m_coastline.geojson"
    );
    const geojson = JSON.parse(readFileSync(file, "utf8"));
    const out: PointSet = { lng: [], lat: [], names: [] };
    const MAX_STEP_DEG = 0.009; // ~1 km of latitude
    const addLine = (coords: [number, number][]) => {
      for (let i = 0; i < coords.length; i++) {
        const [x1, y1] = coords[i];
        out.lng.push(x1);
        out.lat.push(y1);
        if (i === coords.length - 1) break;
        const [x2, y2] = coords[i + 1];
        const steps = Math.floor(Math.max(Math.abs(x2 - x1) * Math.cos((y1 * Math.PI) / 180), Math.abs(y2 - y1)) / MAX_STEP_DEG);
        for (let s = 1; s < steps; s++) {
          out.lng.push(x1 + ((x2 - x1) * s) / steps);
          out.lat.push(y1 + ((y2 - y1) * s) / steps);
        }
      }
    };
    for (const f of geojson.features) {
      const g = f.geometry;
      if (g.type === "LineString") addLine(g.coordinates);
      else if (g.type === "MultiLineString") g.coordinates.forEach(addLine);
    }
    out.names = new Array(out.lng.length).fill("");
    log("coastline", `${out.lng.length} densified coastline points`);
    return out;
  });
}

/** Every magnitude-5+ earthquake worldwide since 1970 from the USGS
 *  catalogue (public domain) - ~92,000 events, fetched a decade at a time
 *  (the API caps each query at 20,000 rows). */
export async function loadEarthquakes(): Promise<{ lng: number[]; lat: number[] }> {
  return cached("earthquakes-m5-1970", async () => {
    const lng: number[] = [];
    const lat: number[] = [];
    const now = new Date().getFullYear();
    for (let start = 1970; start <= now; start += 5) {
      const url =
        `https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&minmagnitude=5` +
        `&starttime=${start}-01-01&endtime=${start + 5}-01-01&orderby=time-asc&limit=20000`;
      const text = await (await fetchWithRetry(url)).text();
      const lines = text.split("\n").slice(1);
      for (const line of lines) {
        const cols = line.split(",");
        const la = Number(cols[1]);
        const lo = Number(cols[2]);
        if (Number.isFinite(la) && Number.isFinite(lo) && cols[1] !== "") {
          lat.push(la);
          lng.push(lo);
        }
      }
      log("usgs", `${start}-${start + 4}: total ${lat.length}`);
      await sleep(500);
    }
    return { lng, lat };
  });
}
