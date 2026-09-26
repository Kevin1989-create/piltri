import { createReadStream, existsSync } from "fs";
import path from "path";
import readline from "readline";
import { cached, downloadOnce, log, unzipOnce, WORK_DIR } from "./util";

/** Point features pulled from GeoNames' full dump (allCountries.txt, ~12M
 *  features, free, CC BY 4.0). Only the feature codes below are kept. */
export interface PointSet {
  lng: number[];
  lat: number[];
  names: string[];
  /** Elevation in metres - only kept for peaks. */
  elev?: number[];
}

export interface GeoNamesFeatures {
  airport: PointSet; // S.AIRP (excludes airfields/heliports/airbases)
  rail: PointSet; // S.RSTN railroad station, S.RSTP railroad stop
  metro: PointSet; // S.MTRO
  bus: PointSet; // S.BUSTN (bus station/terminal, not bus stops)
  tram: PointSet; // S.TRAM
  school: PointSet; // S.SCH
  university: PointSet; // S.UNIV
  beach: PointSet; // T.BCH, T.BCHS
  peak1000: PointSet; // T.PK/PKS/MT/MTS with elevation >= 1,000 m
  forest: PointSet; // V.FRST/FRSTS/WDLD, L.RESF
  volcano: PointSet; // T.VLC
}

const CODE_TO_SET: Record<string, keyof GeoNamesFeatures> = {
  "S.AIRP": "airport",
  "S.RSTN": "rail",
  "S.RSTP": "rail",
  "S.MTRO": "metro",
  "S.BUSTN": "bus",
  "S.TRAM": "tram",
  "S.SCH": "school",
  "S.UNIV": "university",
  "T.BCH": "beach",
  "T.BCHS": "beach",
  "T.PK": "peak1000",
  "T.PKS": "peak1000",
  "T.MT": "peak1000",
  "T.MTS": "peak1000",
  "V.FRST": "forest",
  "V.FRSTS": "forest",
  "V.WDLD": "forest",
  "L.RESF": "forest",
  "T.VLC": "volcano",
};

/** "Mountain" means a real one - a peak of at least this height - not any
 *  named hill (GeoNames' T.MT includes plenty of low hills). build.ts
 *  additionally requires it to rise MOUNTAIN_MIN_RISE_M above the city
 *  itself, so a city already at 1,600 m (Denver) doesn't count the low
 *  bumps on its own plateau as "mountains". */
export const MOUNTAIN_MIN_ELEVATION_M = 1000;
export const MOUNTAIN_MIN_RISE_M = 500;

async function geonamesDir(): Promise<string> {
  const dir = path.join(WORK_DIR, "geonames");
  const allZip = await downloadOnce("https://download.geonames.org/export/dump/allCountries.zip", "allCountries.zip");
  const citiesZip = await downloadOnce("https://download.geonames.org/export/dump/cities5000.zip", "cities5000.zip");
  unzipOnce(allZip, dir, "allCountries.txt");
  unzipOnce(citiesZip, dir, "cities5000.txt");
  return dir;
}

export async function extractGeoNamesFeatures(): Promise<GeoNamesFeatures> {
  return cached("geonames-features", async () => {
    const dir = await geonamesDir();
    const empty = (): PointSet => ({ lng: [], lat: [], names: [] });
    const out: GeoNamesFeatures = {
      airport: empty(),
      rail: empty(),
      metro: empty(),
      bus: empty(),
      tram: empty(),
      school: empty(),
      university: empty(),
      beach: empty(),
      peak1000: empty(),
      forest: empty(),
      volcano: empty(),
    };
    log("geonames", "streaming allCountries.txt (~1.8 GB)...");
    const rl = readline.createInterface({ input: createReadStream(path.join(dir, "allCountries.txt")), crlfDelay: Infinity });
    let lines = 0;
    for await (const line of rl) {
      lines++;
      const cols = line.split("\t");
      const set = CODE_TO_SET[`${cols[6]}.${cols[7]}`];
      if (!set) continue;
      const lat = Number(cols[4]);
      const lng = Number(cols[5]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const target = out[set];
      // GeoNames files some heliports/helistops under AIRP - not airports.
      if (set === "airport" && /heli(port|stop|pad)|helipad/i.test(cols[1])) continue;
      if (set === "peak1000") {
        const elevation = Number(cols[15]) || Number(cols[16]);
        if (!(elevation >= MOUNTAIN_MIN_ELEVATION_M)) continue;
        (target.elev ??= []).push(elevation);
      }
      target.lng.push(lng);
      target.lat.push(lat);
      // Names are only shown for pin-mode categories; keep them small.
      target.names.push(set === "school" || set === "forest" ? "" : cols[1]);
    }
    log("geonames", `${lines} lines scanned; ` + Object.entries(out).map(([k, v]) => `${k}=${v.lng.length}`).join(" "));
    return out;
  });
}

/** GeoNames' SRTM-derived elevation ("dem" column) for every row in
 *  cities5000.txt, keyed by "lat|lng" - the city shortlist
 *  (data/static/discover-cities.json) was generated from this same file,
 *  with the same coordinates, so an exact key match is reliable. */
export async function loadCityElevations(): Promise<Map<string, number>> {
  const obj = await cached("city-elevations", async () => {
    const dir = await geonamesDir();
    const file = path.join(dir, "cities5000.txt");
    if (!existsSync(file)) throw new Error("cities5000.txt missing");
    const result: Record<string, number> = {};
    const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      const cols = line.split("\t");
      const lat = Number(cols[4]);
      const lng = Number(cols[5]);
      const dem = Number(cols[16]);
      const elevation = cols[15] ? Number(cols[15]) : NaN;
      const value = Number.isFinite(elevation) ? elevation : dem;
      // -9999 is GeoNames' "no data" sentinel for dem.
      if (Number.isFinite(value) && value > -1000) result[`${lat}|${lng}`] = value;
    }
    return result;
  });
  return new Map(Object.entries(obj));
}
