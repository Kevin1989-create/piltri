import { readdirSync, readFileSync } from "fs";
import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { cached, downloadOnce, fetchWithRetry, log, pointsKey, unzipOnce, WORK_DIR } from "./util";
import { haversineKm } from "@/lib/geo";

/**
 * Economic growth of the region each place is in (2026-11-20, local data
 * Wave 1): real GDP (constant prices, as reported by each national
 * statistics office and harmonised by the OECD Regional Database), average
 * growth per year over the ten years to the region's latest reported year.
 * The finest region linked: small regions (TL3: départements, Kreise,
 * provinces, counties...) where a place can be tied to one, otherwise large
 * regions (TL2: states, provinces, regions). Values flagged as estimates
 * are not used; provisional ones (first official releases) are.
 *
 * Places are tied to regions without boundary files (the EU's NUTS outlines
 * forbid commercial use): through their GeoNames administrative divisions,
 * matched to OECD regions by the NUTS code Wikidata records for that
 * division (CC0), or failing that by name within the country.
 */

const SPAN_YEARS = 10;
/** A place matched by municipality name further than this from its region's other places is a namesake. */
const NAME_MATCH_MAX_KM = 120;
/** A region's series must reach at least this year. */
const LATEST_FROM = 2022;
const OECD_GDP =
  "https://sdmx.oecd.org/public/rest/data/OECD.CFE.EDS,DSD_REG_ECO@DF_GDP,/A....GDP..Q.XDC?startPeriod=2008&format=csv";
const OECD_STRUCTURE = "https://sdmx.oecd.org/public/rest/dataflow/OECD.CFE.EDS/DSD_REG_ECO@DF_GDP/latest?references=all";
/** Normal and provisional values; E (estimated), F (forecast) and the rest are left out. */
const ACCEPTED_STATUS = new Set(["A", "P"]);
/** Regional wealth (2026-11-22, owner: a 2018 figure "is useless"): GDP per
 *  person of the same regions, current prices - in national currency for
 *  the share of the country's figure, in US dollars at purchasing-power
 *  parity for the amount - each region's latest year, 2021 or later only. */
const OECD_GDP_PER_HEAD =
  "https://sdmx.oecd.org/public/rest/data/OECD.CFE.EDS,DSD_REG_ECO@DF_GDP,/A....GDP._T.V.XDC_PS+USD_PPP_PS+XDC?startPeriod=2019&format=csv";
const WEALTH_FROM = 2021;
/** US counties: BEA's GDP (current dollars) over BEA's residents. */
const BEA_COUNTY_GDP_CURRENT = "https://apps.bea.gov/regional/zip/CAGDP2.zip";
const BEA_COUNTY_PEOPLE = "https://apps.bea.gov/regional/zip/CAINC1.zip";
/** US Bureau of Economic Analysis, real GDP by county (chained dollars), public domain. */
const BEA_COUNTY_GDP = "https://apps.bea.gov/regional/zip/CAGDP9.zip";

/** "TX.453" (GeoNames admin1.admin2: state, county FIPS) -> growth over the
 *  same span as the OECD figures. Counties BEA combines (Virginia's
 *  independent cities) aren't keyed and fall back to the state. */
function loadUsCounties(dir: string): Map<string, { name: string; growth: number; from: number; to: number }> {
  const file = readdirSync(dir).find((f) => /^CAGDP9__ALL_AREAS_.*\.csv$/.test(f));
  const out = new Map<string, { name: string; growth: number; from: number; to: number }>();
  if (!file) return out;
  const rows = parseCsv(readFileSync(path.join(dir, file), "latin1"));
  const h = rows[0].map((c) => c.trim());
  const series = new Map<string, { name: string; byYear: Map<number, number> }>();
  for (const r of rows.slice(1)) {
    if (r[h.indexOf("LineCode")]?.trim() !== "1") continue;
    const fips = r[0].replace(/\D/g, "");
    const m = r[1].match(/^(.*), ([A-Z]{2})\*?$/);
    if (fips.length !== 5 || fips.endsWith("000") || !m) continue;
    const byYear = new Map(h.map((c, i) => [Number(c), Number(r[i])] as const).filter(([y, v]) => y > 1990 && v > 0));
    series.set(`${m[2]}.${fips.slice(2)}`, { name: m[1], byYear });
  }
  // New York City is five counties (its boroughs): their sum.
  const boroughs = ["NY.005", "NY.047", "NY.061", "NY.081", "NY.085"].map((k) => series.get(k));
  if (boroughs.every(Boolean)) {
    const byYear = new Map<number, number>();
    for (const [y] of boroughs[0]!.byYear) if (boroughs.every((b) => b!.byYear.has(y))) byYear.set(y, boroughs.reduce((s, b) => s + b!.byYear.get(y)!, 0));
    series.set(NYC, { name: "New York City", byYear });
  }
  for (const [key, { name, byYear }] of series) {
    const to = Math.max(...byYear.keys());
    const from = to - SPAN_YEARS;
    const a = byYear.get(from);
    const b = byYear.get(to);
    if (!a || !b || to < LATEST_FROM) continue;
    out.set(key, { name, growth: (Math.pow(b / a, 1 / SPAN_YEARS) - 1) * 100, from, to });
  }
  return out;
}
const NYC = "NYC";
/** GeoNames' New York City has no county (it spans five). */
const NYC_GEONAME_ID = 5128581;

/** Eurostat's municipality (LAU) to small region (NUTS 3) table, 2024
 *  (Eurostat re-use policy: commercial use allowed with attribution). */
const EUROSTAT_LAU = "https://ec.europa.eu/eurostat/documents/345175/501971/EU-27-LAU-2024-NUTS-2024.xlsx/12971f56-c035-dbab-4d9f-ff1dcc617bb3?t=1737036272863";
const EU_SHEETS = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];
const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    // Municipality words GeoNames or Eurostat put around the name.
    .replace(/\b(municipal commune of|municipal community of|local community of|gemeente|gmina|municipality of|municipality|kommune|kommun|obcina|dimos|dimou|concelho|city of|comune di|commune)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "PL|krakow" -> NUTS 3 codes of the municipalities (and Eurostat cities) of that name. */
async function loadLau(file: string): Promise<Map<string, Set<string>>> {
  const con = await (await DuckDBInstance.create(":memory:")).connect();
  await con.run("INSTALL excel; LOAD excel;");
  const out = new Map<string, Set<string>>();
  const xlsx = file.split(path.sep).join("/");
  for (const sheet of EU_SHEETS) {
    let rows: unknown[][];
    try {
      rows = (await con.runAndReadAll(`SELECT "NUTS3", "LAU NAME NATIONAL", "LAU NAME LATIN", "CITY NAME" FROM read_xlsx('${xlsx}', sheet='${sheet}', all_varchar=true)`)).getRowsJS();
    } catch {
      continue;
    }
    const cc = sheet === "EL" ? "GR" : sheet;
    for (const [nuts, ...names] of rows) {
      if (typeof nuts !== "string" || nuts.length !== 5) continue;
      for (const n of names) {
        if (typeof n !== "string" || !n.trim()) continue;
        const key = `${cc}|${plain(n.replace(/\(.*?\)/g, ""))}`;
        if (!out.has(key)) out.set(key, new Set());
        out.get(key)!.add(nuts);
      }
    }
  }
  return out;
}

export const REGIONAL_GROWTH_SOURCE = `OECD Regional Database, real GDP by region (constant prices, national statistics offices), average growth per year over the ${SPAN_YEARS} years to each region's latest reported year; regions linked through GeoNames, Wikidata and Eurostat's municipality table (OECD and Eurostat terms: commercial use allowed); US counties from the Bureau of Economic Analysis (real GDP by county, public domain)`;
export const REGIONAL_WEALTH_SOURCE = `OECD Regional Database, GDP per person by region (current prices; the share of the national figure in national currency, the amount in US dollars at purchasing-power parity), each region's latest year, ${WEALTH_FROM} or later only; US counties from the Bureau of Economic Analysis (GDP and residents by county, public domain)`;

export interface RegionalGrowth {
  /** Average real GDP growth per year, %. */
  pctPerYear: number | null;
  fromYear: number | null;
  toYear: number | null;
  /** The region's name, e.g. "Rhône". */
  region: string | null;
  /** "TL3" (small region) or "TL2" (large region). */
  level: string | null;
}

interface Region { code: string; iso3: string; level: string; name: string; growth: number; from: number; to: number }

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

const tsv = (file: string) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));

/** Lower-case, no accents, no generic words ("Province", "Landkreis"...). */
export function normName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(province|provincia|provincie|provinz|prefecture|state|region|regione|regiao|departement|department|county|kreisfreie stadt|landkreis|stadtkreis|kreis|district|voivodeship|wojewodztwo|autonomous community|comunidad autonoma|comunidad|canton|kanton|of|du|de|del|della|di|la|le|les|des|do|da|dos|das|the|y|and|et|und|dki|d i|special|capital|territory|federal|governorate|land|freistaat)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function loadRegions(): Promise<Region[]> {
  const csv = await downloadOnce(OECD_GDP, "oecd-regional-real-gdp.csv");
  const structure = await (await fetchWithRetry(OECD_STRUCTURE, { headers: { accept: "application/vnd.sdmx.structure+json" } })).json();
  const regional = structure.data.codelists.find((c: { id: string }) => c.id === "CL_REGIONAL");
  const nameOf = new Map<string, string>(regional.codes.map((c: { id: string; name: string }) => [c.id, c.name]));

  const rows = parseCsv(readFileSync(csv, "utf8"));
  const h = rows[0];
  const col = (n: string) => h.indexOf(n);
  const [cLevel, cArea, cYear, cValue, cCountry, cStatus] = ["TERRITORIAL_LEVEL", "REF_AREA", "TIME_PERIOD", "OBS_VALUE", "COUNTRY", "OBS_STATUS"].map(col);
  const series = new Map<string, { iso3: string; level: string; byYear: Map<number, number> }>();
  for (const r of rows.slice(1)) {
    if (!ACCEPTED_STATUS.has(r[cStatus])) continue;
    const level = r[cLevel];
    if (level !== "TL2" && level !== "TL3" && level !== "CTRY") continue;
    const value = Number(r[cValue]);
    if (!(value > 0)) continue;
    const key = r[cArea];
    if (!series.has(key)) series.set(key, { iso3: r[cCountry], level, byYear: new Map() });
    series.get(key)!.byYear.set(Number(r[cYear]), value);
  }
  const out: Region[] = [];
  for (const [code, s] of series) {
    const to = Math.max(...s.byYear.keys());
    const from = to - SPAN_YEARS;
    const a = s.byYear.get(from);
    const b = s.byYear.get(to);
    // Series that stop early (Russia: 2019) would break the common window.
    if (!a || !b || to < LATEST_FROM) continue;
    out.push({ code, iso3: s.iso3, level: s.level, name: nameOf.get(code) ?? code, growth: (Math.pow(b / a, 1 / SPAN_YEARS) - 1) * 100, from, to });
  }
  return out;
}

/** GeoNames id -> NUTS codes, from Wikidata (CC0). */
async function loadNutsByGeonameId(): Promise<Map<number, string[]>> {
  const query = "SELECT ?nuts ?gn WHERE { ?i wdt:P605 ?nuts ; wdt:P1566 ?gn . }";
  const res = await fetchWithRetry(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}`, { headers: { accept: "text/csv" } });
  const map = new Map<number, string[]>();
  for (const [nuts, gn] of parseCsv(await res.text()).slice(1)) {
    const id = Number(gn);
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push(nuts.trim());
  }
  return map;
}

/** GeoNames countries whose small regions are third-level divisions (Kreise). */
const ADMIN3_COUNTRIES = ["DE", "BE"];

/** GeoNames division names the OECD spells differently: "ISO3|normalised name" -> OECD code. */
const ALIASES: Record<string, string> = {
  "MEX|mexico city": "ME09",
};

/** Places Eurostat can't place by name: "ISO3|plain city name" -> OECD small region. */
const CITY_ALIASES: Record<string, string> = {
  "PRT|lisbon": "PT1A0",
  "PRT|porto": "PT11A",
  "IRL|dublin": "IE061",
  "IRL|cork": "IE053",
  "IRL|galway": "IE042",
  "IRL|limerick": "IE051",
  "GRC|athens": "EL303",
  "GRC|piraeus": "EL307",
};

export interface RegionalWealth {
  /** GDP per person, % of the country's (same year, same source). */
  vsNationalPct: number | null;
  /** GDP per person, US dollars at purchasing-power parity (current). */
  perHeadPpp: number | null;
  year: number | null;
  region: string | null;
}

/** OECD region code -> latest year (2021+) with GDP per person in both units. */
type PerHead = { year: number; local: number; ppp: number; localByYear: Map<number, number>; totalByYear: Map<number, number> };
async function loadPerHead(): Promise<Map<string, PerHead>> {
  const rows = parseCsv(readFileSync(await downloadOnce(OECD_GDP_PER_HEAD, "oecd-regional-gdp-per-head-v2.csv"), "utf8"));
  const h = rows[0];
  const [cArea, cYear, cValue, cStatus, cUnit] = ["REF_AREA", "TIME_PERIOD", "OBS_VALUE", "OBS_STATUS", "UNIT_MEASURE"].map((n) => h.indexOf(n));
  const byArea = new Map<string, Map<number, { local?: number; ppp?: number; total?: number }>>();
  for (const r of rows.slice(1)) {
    if (!ACCEPTED_STATUS.has(r[cStatus])) continue;
    const v = Number(r[cValue]);
    if (!(v > 0)) continue;
    const years = byArea.get(r[cArea]) ?? new Map();
    const y = years.get(Number(r[cYear])) ?? {};
    if (r[cUnit] === "XDC_PS") y.local = v;
    else if (r[cUnit] === "USD_PPP_PS") y.ppp = v;
    else if (r[cUnit] === "XDC") y.total = v;
    years.set(Number(r[cYear]), y);
    byArea.set(r[cArea], years);
  }
  const out = new Map<string, PerHead>();
  for (const [area, years] of byArea) {
    const latest = [...years].filter(([y, v]) => y >= WEALTH_FROM && v.local && v.ppp).sort((a, b) => b[0] - a[0])[0];
    // Every year's national-currency figure too: a country is compared at its region's year.
    const localByYear = new Map([...years].filter(([, v]) => v.local).map(([y, v]) => [y, v.local!] as const));
    const totalByYear = new Map([...years].filter(([, v]) => v.total).map(([y, v]) => [y, v.total!] as const));
    out.set(area, { year: latest?.[0] ?? 0, local: latest?.[1].local ?? 0, ppp: latest?.[1].ppp ?? 0, localByYear, totalByYear });
  }
  return out;
}

/** "TX.453" -> GDP per person (current dollars) and year; and the US's. */
function loadUsCountyPerHead(gdpDir: string, peopleDir: string): { counties: Map<string, { perHead: number; year: number }>; national: { perHead: number; year: number } | null } {
  const read = (dir: string, prefix: RegExp, line: string) => {
    const file = readdirSync(dir).find((f) => prefix.test(f));
    const out = new Map<string, Map<number, number>>();
    if (!file) return out;
    const rows = parseCsv(readFileSync(path.join(dir, file), "latin1"));
    const h = rows[0].map((c) => c.trim());
    for (const r of rows.slice(1)) {
      if (r[h.indexOf("LineCode")]?.trim() !== line) continue;
      const fips = r[0].replace(/\D/g, "");
      const m = r[1].match(/^(.*), ([A-Z]{2})\*?$/);
      const key = fips === "00000" ? "US" : fips.length === 5 && !fips.endsWith("000") && m ? `${m[2]}.${fips.slice(2)}` : null;
      if (!key) continue;
      out.set(key, new Map(h.map((c, i) => [Number(c), Number(r[i])] as const).filter(([y, v]) => y > 2000 && v > 0)));
    }
    return out;
  };
  // CAGDP2 line 1: all-industry GDP, thousands of dollars; CAINC1 line 2: residents.
  const gdp = read(gdpDir, /^CAGDP2__ALL_AREAS_.*\.csv$/, "1");
  const people = read(peopleDir, /^CAINC1__ALL_AREAS_.*\.csv$/, "2");
  const perHead = (key: string) => {
    const g = gdp.get(key);
    const p = people.get(key);
    if (!g || !p) return null;
    const year = Math.max(...[...g.keys()].filter((y) => p.has(y)));
    return year >= WEALTH_FROM ? { perHead: (g.get(year)! * 1000) / p.get(year)!, year } : null;
  };
  const counties = new Map<string, { perHead: number; year: number }>();
  for (const key of gdp.keys()) {
    if (key === "US") continue;
    const v = perHead(key);
    if (v) counties.set(key, v);
  }
  // New York City: its five counties together.
  const boroughs = ["NY.005", "NY.047", "NY.061", "NY.081", "NY.085"];
  const years = [...(gdp.get("NY.061")?.keys() ?? [])].filter((y) => boroughs.every((b) => gdp.get(b)?.has(y) && people.get(b)?.has(y)));
  const y = Math.max(...years);
  if (years.length && y >= WEALTH_FROM)
    counties.set(NYC, { perHead: (boroughs.reduce((s, b) => s + gdp.get(b)!.get(y)!, 0) * 1000) / boroughs.reduce((s, b) => s + people.get(b)!.get(y)!, 0), year: y });
  return { counties, national: perHead("US") };
}

export async function sampleRegionalGrowth(
  places: { geonameId: number; countryCode: string; lat: number; lng: number; cityName?: string; altNames?: string[] }[],
  iso3Of: (string | null)[],
): Promise<{ places: RegionalGrowth[]; wealth: RegionalWealth[]; national: Map<string, { pctPerYear: number; fromYear: number; toYear: number }> }> {
  const admin1File = await downloadOnce("https://download.geonames.org/export/dump/admin1CodesASCII.txt", "admin1CodesASCII.txt");
  const admin2File = await downloadOnce("https://download.geonames.org/export/dump/admin2Codes.txt", "admin2Codes.txt");
  const admin3Dirs: string[] = [];
  for (const cc of ADMIN3_COUNTRIES) {
    const dir = path.join(WORK_DIR, `geonames-${cc}`);
    unzipOnce(await downloadOnce(`https://download.geonames.org/export/dump/${cc}.zip`, `geonames-${cc}.zip`), dir, `${cc}.txt`);
    admin3Dirs.push(path.join(dir, `${cc}.txt`));
  }
  const beaDir = path.join(WORK_DIR, "bea-cagdp9");
  unzipOnce(await downloadOnce(BEA_COUNTY_GDP, "bea-CAGDP9.zip"), beaDir, "CAGDP9__definition.xml");
  const lauFile = await downloadOnce(EUROSTAT_LAU, "eurostat-EU-27-LAU-2024-NUTS-2024.xlsx");
  const beaGdpDir = path.join(WORK_DIR, "bea-cagdp2");
  unzipOnce(await downloadOnce(BEA_COUNTY_GDP_CURRENT, "bea-CAGDP2.zip"), beaGdpDir, "CAGDP2__definition.xml");
  const beaPeopleDir = path.join(WORK_DIR, "bea-cainc1");
  unzipOnce(await downloadOnce(BEA_COUNTY_PEOPLE, "bea-CAINC1.zip"), beaPeopleDir, "CAINC1__definition.xml");
  const result = await cached(`regional-growth-v15-${pointsKey(places)}`, async () => {
    const regions = await loadRegions();
    const nutsByGid = await loadNutsByGeonameId();
    const usCounties = loadUsCounties(beaDir);
    const lau = await loadLau(lauFile);
    log("regionGrowth", `${lau.size} EU municipality names (Eurostat)`);
    log("regionGrowth", `${usCounties.size} US counties (BEA)`);
    log("regionGrowth", `${regions.length} regions with ${SPAN_YEARS}-year real GDP growth; ${nutsByGid.size} GeoNames divisions with a NUTS code`);

    const byCode = new Map(regions.map((r) => [r.code, r]));
    const byCountry = new Map<string, Region[]>();
    for (const r of regions) {
      if (r.level === "CTRY") continue;
      if (!byCountry.has(r.iso3)) byCountry.set(r.iso3, []);
      byCountry.get(r.iso3)!.push(r);
    }

    // Division code -> [name, GeoNames id].
    const division = new Map<string, [string, number]>();
    for (const [code, name, , gid] of [...tsv(admin1File), ...tsv(admin2File)]) division.set(code, [name, Number(gid)]);
    for (const file of admin3Dirs)
      for (const c of tsv(file)) if (c[7] === "ADM3") division.set(`${c[8]}.${c[10]}.${c[11]}.${c[12]}`, [c[1], Number(c[0])]);

    // Each place's divisions, from GeoNames' cities file (already unpacked by the shortlist).
    const codesOf = new Map<number, string[]>();
    for (const c of tsv(path.join(WORK_DIR, "geonames", "cities1000.txt"))) codesOf.set(Number(c[0]), [c[8], c[10], c[11], c[12]]);

    const regionFor = (gidChain: (number | undefined)[], nameChain: string[], iso3: string): Region | null => {
      // Small regions first, by NUTS code then by name; large regions the
      // same way; a country with a single large region gets that one.
      const candidates = byCountry.get(iso3) ?? [];
      for (const level of ["TL3", "TL2"]) {
        for (const gid of gidChain) {
          const hit = (nutsByGid.get(gid ?? 0) ?? []).map((c) => byCode.get(c)).find((r) => r && r.iso3 === iso3 && r.level === level);
          if (hit) return hit;
        }
        for (const name of nameChain) {
          const n = normName(name);
          const alias = byCode.get(ALIASES[`${iso3}|${n}`] ?? "");
          const hit = alias?.level === level ? alias : n ? candidates.find((r) => r.level === level && normName(r.name) === n) : undefined;
          if (hit) return hit;
        }
      }
      const large = candidates.filter((r) => r.level === "TL2");
      return large.length === 1 ? large[0] : null;
    };

    // Each place's region code, and - for places placed by municipality
    // name - what they had before (a large region, or nothing).
    const code: (string | undefined)[] = [];
    const countyOf: (string | undefined)[] = [];
    const byName: Record<number, Region | undefined> = {};
    const out: RegionalGrowth[] = places.map((p, i) => {
      const empty: RegionalGrowth = { pctPerYear: null, fromYear: null, toYear: null, region: null, level: null };
      const iso3 = iso3Of[i];
      const codes = codesOf.get(p.geonameId);
      if (!iso3 || !codes || !byCountry.has(iso3)) return empty;
      const [cc, a1, a2, a3] = codes;
      const keys = [a3 && `${cc}.${a1}.${a2}.${a3}`, a2 && `${cc}.${a1}.${a2}`, a1 && `${cc}.${a1}`].filter(Boolean) as string[];
      const divs = keys.map((k) => division.get(k)).filter((d): d is [string, number] => !!d);
      // US counties: BEA's own county figures, finer than the OECD's areas.
      const countyKey = p.geonameId === NYC_GEONAME_ID ? NYC : `${a1}.${a2}`;
      if (cc === "US") countyOf[i] = countyKey;
      const county = cc === "US" ? usCounties.get(countyKey) : undefined;
      if (county) return { pctPerYear: Math.round(county.growth * 10) / 10, fromYear: county.from, toYear: county.to, region: division.get(`US.${a1}.${a2}`)?.[0] ?? county.name, level: "county" };
      // A few big cities Eurostat lists only by parish, district or a "greater city" across two regions.
      const cityAlias = byCode.get(CITY_ALIASES[`${iso3}|${plain(p.cityName ?? "")}`] ?? "");
      let r = cityAlias ?? regionFor(divs.map((d) => d[1]), divs.map((d) => d[0]), iso3);
      // EU places still without a small region: their municipality's, from
      // Eurostat, by name - within the large region already found, and only
      // when the name points to a single small region.
      if (r?.level !== "TL3") {
        for (const name of [p.cityName ?? "", ...(p.altNames ?? []), ...divs.map((d) => d[0])]) {
          const nuts = [...(lau.get(`${cc}|${plain(name)}`) ?? [])].filter((c) => !r || c.startsWith(r.code.slice(0, 3)));
          const hits = [...new Set(nuts)].map((c) => byCode.get(c)).filter((x): x is Region => x?.level === "TL3");
          if (hits.length === 1) { byName[i] = r ?? undefined; r = hits[0]; break; }
          if (nuts.length) break;
        }
      }
      if (!r) return empty;
      code[i] = r.code;
      return { pctPerYear: Math.round(r.growth * 10) / 10, fromYear: r.from, toYear: r.to, region: r.name, level: r.level };
    });
    // A same-named village elsewhere can mislead the name match (Seixal, near
    // Lisbon, has a namesake on Madeira): a place matched by name that lies
    // far from the other places of its region goes back to what it had.
    const where = new Map<string, { lat: number[]; lng: number[] }>();
    places.forEach((p, i) => {
      if (!code[i]) return;
      const w = where.get(code[i]!) ?? { lat: [], lng: [] };
      w.lat.push(p.lat);
      w.lng.push(p.lng);
      where.set(code[i]!, w);
    });
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    let reverted = 0;
    places.forEach((p, i) => {
      if (!(i in byName)) return;
      const w = where.get(code[i]!)!;
      if (w.lat.length < 3 || haversineKm(p.lat, p.lng, median(w.lat), median(w.lng)) <= NAME_MATCH_MAX_KM) return;
      const back = byName[i];
      code[i] = back?.code;
      out[i] = back
        ? { pctPerYear: Math.round(back.growth * 10) / 10, fromYear: back.from, toYear: back.to, region: back.name, level: back.level }
        : { pctPerYear: null, fromYear: null, toYear: null, region: null, level: null };
      reverted++;
    });
    log("regionGrowth", `${Object.keys(byName).length} places placed by municipality name, ${reverted} of them undone as too far from their region`);
    const national: Record<string, { pctPerYear: number; fromYear: number; toYear: number }> = {};
    for (const r of regions) if (r.level === "CTRY") national[r.iso3] = { pctPerYear: Math.round(r.growth * 10) / 10, fromYear: r.from, toYear: r.to };

    // Regional wealth: the same region's GDP per person, against the country's.
    const perHead = await loadPerHead();
    const us = loadUsCountyPerHead(beaGdpDir, beaPeopleDir);
    // The country's figure: its large regions together, the same year -
    // GDP over residents - so output belonging to no region (Norway's
    // offshore oil and gas, "extra-regio") doesn't make every region look
    // poor. Never two years mixed.
    const regionsPerHead = (iso3: string, year: number): number | null => {
      let gdp = 0;
      let people = 0;
      for (const r of byCountry.get(iso3) ?? []) {
        if (r.level !== "TL2") continue;
        const v = perHead.get(r.code);
        const total = v?.totalByYear.get(year);
        const each = v?.localByYear.get(year);
        if (!total || !each) continue;
        gdp += total;
        people += total / each;
      }
      return people ? gdp / people : null;
    };
    const noWealth: RegionalWealth = { vsNationalPct: null, perHeadPpp: null, year: null, region: null };
    const wealth: RegionalWealth[] = places.map((p, i) => {
      const county = countyOf[i] ? us.counties.get(countyOf[i]!) : undefined;
      if (county && us.national) {
        const nat = us.national;
        return { vsNationalPct: Math.round((county.perHead / nat.perHead) * 100), perHeadPpp: Math.round(county.perHead), year: county.year, region: out[i].region ?? null };
      }
      const r = code[i] ? byCode.get(code[i]!) : undefined;
      const v = r ? perHead.get(r.code) : undefined;
      if (!r || !v || v.year < WEALTH_FROM) return noWealth;
      const nat = regionsPerHead(r.iso3, v.year);
      return { vsNationalPct: nat ? Math.round((v.local / nat) * 100) : null, perHeadPpp: Math.round(v.ppp), year: v.year, region: r.name };
    });
    log("regionGrowth", `regional wealth (2021+): ${wealth.filter((w) => w.vsNationalPct != null).length} places, years ${[...new Set(wealth.map((w) => w.year).filter(Boolean))].sort().join(", ")}`);

    // Coverage per country, for the log.
    const per = new Map<string, [number, number, number]>();
    places.forEach((_, i) => {
      const iso3 = iso3Of[i];
      if (!iso3 || !byCountry.has(iso3)) return;
      const c = per.get(iso3) ?? [0, 0, 0];
      c[0]++;
      if (out[i].level === "TL3" || out[i].level === "county") c[1]++;
      else if (out[i].level === "TL2") c[2]++;
      per.set(iso3, c);
    });
    log("regionGrowth", [...per].map(([k, [n, t3, t2]]) => `${k} ${n}: ${t3}/${t2}`).join(", "));
    return { places: out, wealth, national };
  });
  return { places: result.places, wealth: result.wealth, national: new Map(Object.entries(result.national)) };
}
