import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { cached, downloadOnce, log, pointsKey, WORK_DIR } from "./util";

/**
 * GDP per head of the region (province, state, county...) each city is in
 * (2026-10-24, phase 1 of local data), from Kummu et al.'s compilation of
 * nationally reported regional accounts (v4, Zenodo, CC BY 4.0) - in
 * purchasing-power-parity international dollars, so comparable between
 * countries, and as a share of the national figure.
 *
 * Only figures a country actually reported for its regions: the dataset
 * extends every series to 2024 and splits regions into districts with a
 * model, and both are estimates - not used (2026-10-24, on request: no
 * estimates; a place without a reported figure shows none). So each
 * country's latest reported year, from REPORTED_SINCE on; countries that
 * report no regional figures (or only older ones) get none.
 */
const RECORD = "18429133";
const FILES = `https://zenodo.org/api/records/${RECORD}/files`;
/** Older regional figures than this aren't shown. */
const REPORTED_SINCE = 2018;
/** A coastal town whose point falls just outside its region's simplified
 *  outline still gets it, up to this far (degrees, ~5 km). */
const COAST_SLACK_DEG = 0.05;

export const REGIONAL_GDP_SOURCE = `Kummu et al. (2025), gridded GDP per capita v4, reported regional (admin 1) figures only, ${REPORTED_SINCE} or later (Zenodo, CC BY 4.0)`;

export interface RegionalGdp {
  /** PPP international dollars per person. */
  perHead: number | null;
  year: number | null;
  /** % of the national figure for the same year. */
  vsNationalPct: number | null;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(file: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const keys = parseCsvLine(head);
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(keys.map((k, i) => [k, cells[i]]));
  });
}

/** "1990, 2001, 2009-2018" -> its years. */
function yearsIn(ranges: string | undefined): number[] {
  if (!ranges || ranges === "NA") return [];
  return ranges.split(",").flatMap((part) => {
    const [a, b] = part.trim().split("-").map(Number);
    if (!Number.isFinite(a)) return [];
    return b ? Array.from({ length: b - a + 1 }, (_, k) => a + k) : [a];
  });
}

/** `iso3Of[i]`: the ISO3 code of point i's country - a point is only given
 *  a region of its own country (border towns can fall in a neighbour's). */
export async function sampleRegionalGdp(points: { lat: number; lng: number }[], iso3Of: (string | null)[]): Promise<RegionalGdp[]> {
  const gpkg = await downloadOnce(`${FILES}/polyg_adm1_gdp_perCapita_1990_2024.gpkg/content`, "kummu-v4-polyg_adm1_gdp_perCapita_1990_2024.gpkg");
  const meta = await downloadOnce(`${FILES}/adm1_metaData.csv/content`, "kummu-v4-adm1_metaData.csv");
  const national = await downloadOnce(`${FILES}/tabulated_adm0_gdp_perCapita.csv/content`, "kummu-v4-tabulated_adm0_gdp_perCapita.csv");
  return cached(`regional-gdp-v4-${pointsKey(points)}`, async () => {
    // Each country's latest reported regional year.
    const latest = new Map<string, number>();
    for (const row of readCsv(meta)) {
      const years = yearsIn(row.YearRanges).filter((y) => y >= REPORTED_SINCE);
      if (years.length) latest.set(row.iso3, Math.max(...years));
    }
    const nationalByIso = new Map(readCsv(national).map((row) => [row.iso3, row]));
    log("regionGdp", `${latest.size} countries report regional GDP for ${REPORTED_SINCE} or later`);

    const con = await (await DuckDBInstance.create(":memory:")).connect();
    await con.run("INSTALL spatial; LOAD spatial;");
    const file = gpkg.split(path.sep).join("/");
    const isoList = [...latest.keys()].map((c) => `'${c}'`).join(",");
    const yearCols = Array.from({ length: 2024 - REPORTED_SINCE + 1 }, (_, k) => `"${REPORTED_SINCE + k}"`).join(", ");
    await con.run(`CREATE TABLE regions AS SELECT row_number() OVER () AS rid, iso3, ${yearCols}, geom FROM ST_Read('${file}') WHERE iso3 IN (${isoList})`);
    const citiesFile = path.join(WORK_DIR, "cities-for-regions.csv").split(path.sep).join("/");
    writeFileSync(citiesFile, "i,lat,lng,iso3\n" + points.map((p, i) => `${i},${p.lat},${p.lng},${iso3Of[i] ?? ""}`).join("\n"));
    await con.run(`CREATE TABLE cities AS SELECT i, iso3, ST_Point(lng, lat) AS pt FROM read_csv('${citiesFile}', header=true, columns={'i':'INTEGER','lat':'DOUBLE','lng':'DOUBLE','iso3':'VARCHAR'}) WHERE iso3 IN (${isoList})`);
    // Inside the region's outline; failing that, the nearest region of the
    // same country within COAST_SLACK_DEG.
    const reader = await con.runAndReadAll(`
      WITH inside AS (
        SELECT c.i, any_value(r.rid) AS rid FROM cities c JOIN regions r ON c.iso3 = r.iso3 AND ST_Contains(r.geom, c.pt) GROUP BY c.i
      ),
      near AS (
        SELECT c.i, arg_min(r.rid, ST_Distance(r.geom, c.pt)) AS rid
        FROM cities c JOIN regions r ON c.iso3 = r.iso3 AND ST_DWithin(r.geom, c.pt, ${COAST_SLACK_DEG})
        WHERE c.i NOT IN (SELECT i FROM inside) GROUP BY c.i
      )
      SELECT m.i, r.iso3, ${yearCols} FROM (SELECT * FROM inside UNION ALL SELECT * FROM near) m JOIN regions r USING (rid)`);
    const out: RegionalGdp[] = points.map(() => ({ perHead: null, year: null, vsNationalPct: null }));
    for (const row of reader.getRowsJS()) {
      const i = Number(row[0]);
      const iso3 = String(row[1]);
      const year = latest.get(iso3)!;
      const perHead = Number(row[2 + year - REPORTED_SINCE]);
      if (!Number.isFinite(perHead) || perHead <= 0) continue;
      const nat = Number(nationalByIso.get(iso3)?.[String(year)]);
      out[i] = {
        perHead: Math.round(perHead / 100) * 100,
        year,
        vsNationalPct: Number.isFinite(nat) && nat > 0 ? Math.round((perHead / nat) * 100) : null,
      };
    }
    log("regionGdp", `regional GDP per head for ${out.filter((r) => r.perHead != null).length} of ${points.length} places`);
    return out;
  });
}
