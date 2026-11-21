import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { CRIME_COUNTRIES, CRIME_KINDS, CRIME_SOURCES, CRIME_TOO_FEW, decodeBoundary, type EncodedBoundary } from "@/lib/dataset/schema";
import { cached, downloadOnce, fetchJson, fetchWithRetry, log, pointsKey, RAW_DIR, WORK_DIR } from "./util";

/**
 * Recorded crime by town (2026-11-21, owner: "focus on safety: we need more
 * criteria at city level"), country by country from each one's official
 * open figures - never estimated: a town without its own figure has none.
 *
 * Five kinds (CRIME_KINDS), each a yearly rate per 1,000 residents over the
 * last three years, beside the same rate for the whole country - recording
 * differs between countries, so a town is judged against its own country.
 *
 * France: SSMSI (the Interior Ministry's statistics service), crimes and
 * offences recorded by the police and gendarmerie by commune, Licence
 * Ouverte 2.0. A commune's figure is published only when more than 5 were
 * recorded in each of three successive years: below that, CRIME_TOO_FEW.
 */

export const CRIME_SOURCE = Object.values(CRIME_SOURCES).join("; ");

export interface PlaceCrime {
  /** Per CRIME_KINDS: a yearly rate per 1,000 residents, CRIME_TOO_FEW, or null. */
  rates: (number | null)[];
  national: (number | null)[];
  years: string;
  /** The country whose figures these are (its CRIME_SOURCES entry). */
  source: string;
}

// ---- France -------------------------------------------------------------

const FR_DATASET = "https://www.data.gouv.fr/api/1/datasets/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales/";

/** Each kind from SSMSI's indicators (summed). Physical violence outside
 *  the family - in-family violence happens behind closed doors, not in the
 *  street; theft from people without violence; vehicles stolen or broken
 *  into. */
const FR_KINDS: Record<(typeof CRIME_KINDS)[number], string[]> = {
  violent: ["Violences physiques hors cadre familial"],
  burglary: ["Cambriolages de logement"],
  theft: ["Vols sans violence contre des personnes"],
  vehicle: ["Vols de véhicule", "Vols dans les véhicules"],
  vandalism: ["Destructions et dégradations volontaires"],
};

/** The French overseas departments are their own countries in GeoNames. */
const FR_COUNTRIES = new Set(Object.keys(CRIME_COUNTRIES).filter((cc) => CRIME_COUNTRIES[cc] === "FR"));

async function franceFiles(): Promise<{ communes: string; departments: string; tag: string }> {
  const dataset = await fetchJson<{ resources: { title: string; url: string; last_modified: string }[] }>(FR_DATASET);
  const find = (re: RegExp) => {
    const r = dataset.resources.find((x) => re.test(x.title));
    if (!r) throw new Error(`SSMSI: no resource matching ${re}`);
    return r;
  };
  const com = find(/^COM - .*parquet/i);
  const dep = find(/^DEP - /i);
  // Named by the release, so a new one is downloaded.
  const tag = path.basename(com.url).replace(/\.parquet$/, "");
  return {
    communes: await downloadOnce(com.url, `ssmsi/${tag}.parquet`),
    departments: await downloadOnce(dep.url, `ssmsi/${path.basename(dep.url)}`),
    tag,
  };
}

async function loadFrance(): Promise<{ byCommune: Record<string, (number | null)[]>; national: (number | null)[]; years: string }> {
  const files = await franceFiles();
  return cached(`crime-fr-v2-${files.tag}`, async () => {
    const indicators = [...new Set(Object.values(FR_KINDS).flat())];
    const db = await (await DuckDBInstance.create()).connect();
    const last = Number((await db.runAndReadAll(`SELECT max(annee) FROM read_parquet('${files.communes.replace(/\\/g, "/")}')`)).getRows()[0][0]);
    const first = last - 2;
    const rows = (
      await db.runAndReadAll(
        `SELECT CODGEO_2026 AS code, annee, indicateur, nombre, est_diffuse = 'diff' AS published, insee_pop
         FROM read_parquet('${files.communes.replace(/\\/g, "/")}')
         WHERE annee BETWEEN ${first} AND ${last} AND indicateur IN (${indicators.map((i) => `'${i.replace(/'/g, "''")}'`).join(",")})`
      )
    ).getRowObjectsJson() as { code: string; annee: number; indicateur: string; nombre: number | null; published: boolean; insee_pop: number | null }[];

    // commune -> indicator -> year -> count (null: not published)
    const counts = new Map<string, Map<string, Map<number, number | null>>>();
    const pop = new Map<string, number>();
    for (const r of rows) {
      if (!counts.has(r.code)) counts.set(r.code, new Map());
      const byInd = counts.get(r.code)!;
      if (!byInd.has(r.indicateur)) byInd.set(r.indicateur, new Map());
      byInd.get(r.indicateur)!.set(Number(r.annee), r.published ? Number(r.nombre) : null);
      if (Number(r.annee) === last && r.insee_pop) pop.set(r.code, Number(r.insee_pop));
    }
    const byCommune: Record<string, (number | null)[]> = {};
    for (const [code, byInd] of counts) {
      const residents = pop.get(code);
      if (!residents) continue;
      byCommune[code] = CRIME_KINDS.map((kind) => {
        let total = 0;
        for (const ind of FR_KINDS[kind])
          for (let y = first; y <= last; y++) {
            const n = byInd.get(ind)?.get(y);
            if (n === undefined) return null;
            if (n === null) return CRIME_TOO_FEW;
            total += n;
          }
        return Math.round((total / 3 / residents) * 1000 * 100) / 100;
      });
    }

    // The whole country (departments, overseas included): the same rates.
    const dep = readFileSync(files.departments, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
    const head = dep[0].split(";").map((h) => h.replace(/"/g, ""));
    const col = (name: string) => head.indexOf(name);
    const [cYear, cInd, cN, cPop, cDep] = [col("annee"), col("indicateur"), col("nombre"), col("insee_pop"), col("Code_departement")];
    const natCount = new Map<string, number>();
    const depPop = new Map<string, number>();
    for (const line of dep.slice(1)) {
      const c = line.split(";").map((v) => v.replace(/"/g, ""));
      const year = Number(c[cYear]);
      if (year < first || year > last) continue;
      if (indicators.includes(c[cInd])) natCount.set(c[cInd], (natCount.get(c[cInd]) ?? 0) + Number(c[cN]));
      if (year === last) depPop.set(c[cDep], Number(c[cPop]));
    }
    const residents = [...depPop.values()].reduce((a, b) => a + b, 0);
    const national = CRIME_KINDS.map((kind) => {
      const n = FR_KINDS[kind].reduce((s, ind) => s + (natCount.get(ind) ?? 0), 0);
      return n && residents ? Math.round((n / 3 / residents) * 1000 * 100) / 100 : null;
    });
    log("crime", `France ${first}-${last}: ${Object.keys(byCommune).length} communes; national per 1,000: ${CRIME_KINDS.map((k, i) => `${k} ${national[i]}`).join(", ")}`);
    return { byCommune, national, years: `${first}-${last}` };
  });
}

// ---- England and Wales ---------------------------------------------------

/**
 * data.police.uk (Open Government Licence v3.0): every crime recorded by the
 * police forces of England and Wales, placed on a nearby street and tagged
 * with its census neighbourhood (LSOA, ~1,600 residents), the last 36 months
 * in one archive. A town's figure: the crimes of the neighbourhoods inside
 * its outline, per their residents at the 2021 census (ONS via Nomis, OGL).
 * Each neighbourhood sits where the middle of its recorded crimes is. A
 * force's crimes are averaged over the months it supplied; a town reached by
 * one with under two years of them has no figure (never estimated).
 */
const UK_KINDS: Record<(typeof CRIME_KINDS)[number], string[]> = {
  violent: ["Violence and sexual offences", "Robbery"],
  burglary: ["Burglary"],
  theft: ["Theft from the person", "Bicycle theft", "Other theft"],
  vehicle: ["Vehicle crime"],
  vandalism: ["Criminal damage and arson"],
};
const NOMIS_LSOA_RESIDENTS =
  "https://www.nomisweb.co.uk/api/v01/dataset/NM_2021_1.data.csv?date=latest&geography=TYPE151&c2021_restype_3=0&measures=20100&select=geography_code,obs_value";

interface Neighbourhood {
  lng: number;
  lat: number;
  residents: number;
  /** Crimes a year, per CRIME_KINDS. */
  perYear: number[];
  complete: boolean;
}

const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function loadEnglandWales(): Promise<{ hoods: Neighbourhood[]; national: (number | null)[]; years: string }> {
  const page = await (await fetchWithRetry("https://data.police.uk/data/archive/")).text();
  const latest = page.match(/\/data\/archive\/(\d{4}-\d{2})\.zip/)?.[1];
  if (!latest) throw new Error("police.uk: no archive listed");
  return cached(`crime-ew-v4-${latest}`, async () => {
    const zip = await downloadOnce(`https://data.police.uk/data/archive/${latest}.zip`, `police-uk/${latest}.zip`);
    const dir = path.join(WORK_DIR, "police-uk", latest);
    if (!existsSync(path.join(dir, ".done"))) {
      mkdirSync(dir, { recursive: true });
      log("crime", `unzipping the street-level files of police.uk ${latest}...`);
      execSync(`unzip -o -q "${zip}" "*/*-street.csv" -d "${dir}"`, { stdio: "inherit" });
      writeFileSync(path.join(dir, ".done"), "");
    }
    const glob = path.join(dir, "*", "*-street.csv").replace(/\\/g, "/");
    const db = await (await DuckDBInstance.create()).connect();
    const src = `read_csv('${glob}', header = true, all_varchar = true, union_by_name = true)`;
    // British Transport Police (crimes on the railways, across the country)
    // are left out: they aren't the town's police, and their months are patchy.
    const forceMonths = (
      await db.runAndReadAll(
        `SELECT "Falls within" AS force, count(DISTINCT "Month") AS months, min("Month") AS first, max("Month") AS last FROM ${src} WHERE "Falls within" <> 'British Transport Police' GROUP BY 1`
      )
    ).getRowObjectsJson() as { force: string; months: number; first: string; last: string }[];
    // A force's crimes are averaged over the months it supplied; one with
    // under two years of them is left out (its towns get no figure).
    const monthsOf = new Map(forceMonths.map((f) => [f.force, Number(f.months)]));
    const usable = (force: string) => (monthsOf.get(force) ?? 0) >= 24;
    const first = forceMonths.map((f) => f.first).sort()[0];
    const last = forceMonths.map((f) => f.last).sort().pop()!;
    const months = Math.max(...monthsOf.values());
    const partial = forceMonths.filter((f) => Number(f.months) < months).map((f) => `${f.force} ${f.months}`);
    log("crime", `police.uk ${first} to ${last}: ${forceMonths.length} forces${partial.length ? `, some months missing: ${partial.join(", ")}` : ""}`);

    const typeCase = `CASE ${CRIME_KINDS.map((kind, k) => `WHEN "Crime type" IN (${UK_KINDS[kind].map(sqlText).join(",")}) THEN ${k}`).join(" ")} ELSE -1 END`;
    const rows = (
      await db.runAndReadAll(
        `SELECT "LSOA code" AS lsoa, any_value("LSOA name") AS lsoaName, "Falls within" AS force, ${typeCase} AS kind, count(*) AS n,
                median(TRY_CAST("Longitude" AS DOUBLE)) AS lng, median(TRY_CAST("Latitude" AS DOUBLE)) AS lat
         FROM ${src} WHERE "LSOA code" IS NOT NULL AND "LSOA code" <> '' AND "Falls within" <> 'British Transport Police' GROUP BY ALL`
      )
    ).getRowObjectsJson() as { lsoa: string; lsoaName: string | null; force: string; kind: number; n: number; lng: number | null; lat: number | null }[];

    // The 2021 census, residents by neighbourhood (Nomis pages of 25,000).
    const residents = new Map<string, number>();
    for (let offset = 0; ; offset += 25000) {
      const lines = readFileSync(await downloadOnce(`${NOMIS_LSOA_RESIDENTS}&RecordOffset=${offset}`, `census2021-lsoa-residents-${offset}.csv`), "utf8")
        .split(/\r?\n/)
        .slice(1)
        .filter(Boolean);
      for (const line of lines) {
        const [code, n] = line.replace(/"/g, "").split(",");
        if (code) residents.set(code, Number(n));
      }
      if (lines.length < 25000) break;
    }

    // Each neighbourhood where the middle of its crimes is (each kind's
    // median position, weighted by its count), and its crimes a year by kind.
    const byLsoa = new Map<string, { lngSum: number; latSum: number; w: number; perYear: number[]; allPerYear: number; complete: boolean; area: string }>();
    for (const r of rows) {
      const e = byLsoa.get(r.lsoa) ?? { lngSum: 0, latSum: 0, w: 0, perYear: CRIME_KINDS.map(() => 0), allPerYear: 0, complete: true, area: (r.lsoaName ?? "").replace(/\s+\w+$/, "") };
      const n = Number(r.n);
      if (r.lng != null && r.lat != null) {
        e.lngSum += Number(r.lng) * n;
        e.latSum += Number(r.lat) * n;
        e.w += n;
      }
      if (!usable(r.force)) e.complete = false;
      else {
        const perYear = n / (monthsOf.get(r.force)! / 12);
        e.allPerYear += perYear;
        if (Number(r.kind) >= 0) e.perYear[Number(r.kind)] += perYear;
      }
      byLsoa.set(r.lsoa, e);
    }
    // A force that supplies nothing (Greater Manchester Police, since 2019)
    // leaves its council areas with only the odd crime a neighbouring force
    // recorded there: a council area (the neighbourhood names' "Manchester"
    // in "Manchester 001A") with under a tenth of the usual level of crime
    // of all kinds is taken as unreported, not safe.
    const areas = new Map<string, { crimes: number; people: number }>();
    let allCrimes = 0;
    let allResidents = 0;
    for (const [code, e] of byLsoa) {
      const people = residents.get(code);
      if (!people || !e.complete) continue;
      const a = areas.get(e.area) ?? { crimes: 0, people: 0 };
      a.crimes += e.allPerYear;
      a.people += people;
      areas.set(e.area, a);
      allCrimes += e.allPerYear;
      allResidents += people;
    }
    const floor = (allCrimes / allResidents) * 0.1;
    const unreported = new Set([...areas].filter(([, a]) => a.crimes / a.people < floor).map(([name]) => name));
    for (const e of byLsoa.values()) if (unreported.has(e.area)) e.complete = false;
    log("crime", `council areas with almost nothing recorded, taken as unreported: ${[...unreported].join(", ") || "none"}`);
    const hoods: Neighbourhood[] = [];
    let natResidents = 0;
    const natPerYear = CRIME_KINDS.map(() => 0);
    let unmatched = 0;
    for (const [code, e] of byLsoa) {
      const people = residents.get(code);
      if (!people || !e.w) {
        unmatched++;
        continue;
      }
      hoods.push({ lng: e.lngSum / e.w, lat: e.latSum / e.w, residents: people, perYear: e.perYear, complete: e.complete });
      if (e.complete) {
        natResidents += people;
        e.perYear.forEach((n, k) => (natPerYear[k] += n));
      }
    }
    const national = natPerYear.map((n) => (natResidents ? Math.round((n / natResidents) * 1000 * 100) / 100 : null));
    log("crime", `England and Wales: ${hoods.length} neighbourhoods (${unmatched} without census residents, e.g. Northern Ireland's); national per 1,000: ${CRIME_KINDS.map((k, i) => `${k} ${national[i]}`).join(", ")}`);
    return { hoods, national, years: `${first.slice(0, 7)} to ${last.slice(0, 7)}` };
  });
}

// ---- United States ---------------------------------------------------------

/**
 * The FBI's Crime in the United States, Table 8 - offences known to the
 * police of each city that reports, with the population it serves (US
 * government work, public domain). The last three years; a city needs two
 * of them. No vandalism in the table: that row has no figure.
 */
const US_YEARS = 3;
/** Table 8's columns, after state, city and population. */
const US_COLUMNS = ["violent", "murder", "rape", "robbery", "assault", "property", "burglary", "larceny", "vehicleTheft", "arson"] as const;
const US_KINDS: Record<(typeof CRIME_KINDS)[number], (typeof US_COLUMNS)[number] | null> = {
  violent: "violent",
  burglary: "burglary",
  theft: "larceny",
  vehicle: "vehicleTheft",
  vandalism: null,
};

/** The FBI's file for a year, through the Crime Data Explorer's download
 *  link (no key needed). */
async function fbiTable8(year: number): Promise<string | null> {
  const key = `cius/${year}/offenses-known-to-le-${year}.zip`;
  const zipName = `fbi/offenses-known-to-le-${year}.zip`;
  let zip: string;
  try {
    const signed = await fetchJson<Record<string, string>>(`https://cde.ucr.cjis.gov/LATEST/s3/signedurl?key=${encodeURIComponent(key)}`);
    if (!signed[key]) return null;
    zip = await downloadOnce(signed[key], zipName);
  } catch {
    return null;
  }
  const dir = path.join(WORK_DIR, "fbi", String(year));
  if (!existsSync(path.join(dir, ".done"))) {
    mkdirSync(dir, { recursive: true });
    execSync(`unzip -o -q "${zip}" "*Table_8*" -d "${dir}"`, { stdio: "inherit" });
    writeFileSync(path.join(dir, ".done"), "");
  }
  const file = readdirSync(dir).find((f) => /Table_8.*\.xlsx$/i.test(f));
  return file ? path.join(dir, file) : null;
}

/** "Chicago3" -> "chicago": footnote digits, accents and case away. */
const usPlain = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\d,]+$/g, "")
    .replace(/\bst\.? /g, "saint ")
    .replace(/\bft\.? /g, "fort ")
    .replace(/\bmt\.? /g, "mount ")
    .replace(/\s+/g, " ")
    .trim();

async function loadUnitedStates(): Promise<{ byCity: Record<string, (number | null)[]>; national: (number | null)[]; years: string }> {
  // The latest year published: from next year back.
  const now = new Date().getUTCFullYear();
  const files: [number, string][] = [];
  for (let year = now; year >= now - 6 && files.length < US_YEARS; year--) {
    const file = await fbiTable8(year);
    if (file) files.push([year, file]);
  }
  if (!files.length) throw new Error("FBI: no Table 8 found");
  const tag = files.map(([y]) => y).join("-");
  return cached(`crime-us-v2-${tag}`, async () => {
    const db = await (await DuckDBInstance.create()).connect();
    await db.run("INSTALL excel; LOAD excel;");
    // "<state>|<city>" -> per year: [population, ...counts]
    const byCityYears = new Map<string, number[][]>();
    for (const [, file] of files) {
      const rows = (await db.runAndReadAll(`SELECT * FROM read_xlsx('${file.replace(/\\/g, "/")}', header = true, all_varchar = true, range = 'A4:M20000')`)).getRows();
      let state = "";
      for (const row of rows) {
        const cells = row.map((v) => (v == null ? null : String(v)));
        if (cells[0]) state = usPlain(cells[0]);
        const city = cells[1] ? usPlain(cells[1]) : "";
        const people = Number(cells[2]?.replace(/,/g, ""));
        if (!state || !city || !people) continue;
        const counts = US_COLUMNS.map((_, k) => Number(cells[3 + k]?.replace(/,/g, "") ?? NaN));
        const key = `${state}|${city}`;
        if (!byCityYears.has(key)) byCityYears.set(key, []);
        byCityYears.get(key)!.push([people, ...counts]);
      }
    }
    const byCity: Record<string, (number | null)[]> = {};
    const natCount = CRIME_KINDS.map(() => 0);
    const natPeople = CRIME_KINDS.map(() => 0);
    for (const [key, years] of byCityYears) {
      // At least two of the three years.
      if (years.length < Math.min(2, files.length)) continue;
      const rates = CRIME_KINDS.map((kind, k) => {
        const col = US_KINDS[kind];
        if (!col) return null;
        const at = 1 + US_COLUMNS.indexOf(col);
        const valid = years.filter((y) => Number.isFinite(y[at]));
        if (valid.length < Math.min(2, files.length)) return null;
        const crimes = valid.reduce((s, y) => s + y[at], 0);
        const people = valid.reduce((s, y) => s + y[0], 0);
        natCount[k] += crimes;
        natPeople[k] += people;
        return Math.round((crimes / people) * 1000 * 100) / 100;
      });
      byCity[key] = rates;
    }
    const national = CRIME_KINDS.map((kind, k) => (US_KINDS[kind] && natPeople[k] ? Math.round((natCount[k] / natPeople[k]) * 1000 * 100) / 100 : null));
    const years = files.map(([y]) => y).sort();
    log("crime", `FBI ${years.join(", ")}: ${Object.keys(byCity).length} cities; all reporting cities per 1,000: ${CRIME_KINDS.map((k, i) => `${k} ${national[i]}`).join(", ")}`);
    return { byCity, national, years: `${years[0]}-${years[years.length - 1]}` };
  });
}

/** Ray casting over a GeoJSON-style multipolygon ([lng, lat] rings, holes after the outer one). */
function inside(lng: number, lat: number, polygons: number[][][][]): boolean {
  let hit = false;
  for (const rings of polygons)
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
      }
  return hit;
}

/** A town's rates from the neighbourhoods inside its outline - null when
 *  there are none (Scotland, Northern Ireland), when a force missed months,
 *  or under 1,000 residents. */
function englandWalesRates(ew: Awaited<ReturnType<typeof loadEnglandWales>>, grid: Map<string, Neighbourhood[]>, encoded: EncodedBoundary): (number | null)[] | null {
  const polygons = decodeBoundary(encoded);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polygons) for (const [x, y] of rings[0]) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const within: Neighbourhood[] = [];
  for (let gx = Math.floor(x0 * 10); gx <= Math.floor(x1 * 10); gx++)
    for (let gy = Math.floor(y0 * 10); gy <= Math.floor(y1 * 10); gy++)
      for (const h of grid.get(`${gx},${gy}`) ?? []) if (inside(h.lng, h.lat, polygons)) within.push(h);
  if (!within.length || within.some((h) => !h.complete)) return null;
  const people = within.reduce((sum, h) => sum + h.residents, 0);
  if (people < 1000) return null;
  return CRIME_KINDS.map((_, k) => Math.round((within.reduce((sum, h) => sum + h.perYear[k], 0) / people) * 1000 * 100) / 100);
}

// ---- All countries --------------------------------------------------------

export async function sampleCrime(
  places: { geonameId: number; countryCode: string; lat: number; lng: number; population: number }[],
  /** The place's outline (its border, or its built-up area), if any. */
  outlineOf: (i: number) => EncodedBoundary | null
): Promise<(PlaceCrime | null)[]> {
  return cached(`crime-v8-${pointsKey(places)}`, async () => {
    // Each place's official local code (GeoNames admin4: the INSEE commune code in France).
    const admin4 = new Map<number, string>();
    const usNames = new Map<number, { state: string; names: string[] }>();
    const stateNames = new Map<string, string>();
    for (const line of readFileSync(path.join(RAW_DIR, "admin1CodesASCII.txt"), "utf8").split("\n")) {
      const [code, name] = line.split("\t");
      if (code?.startsWith("US.")) stateNames.set(code.slice(3), usPlain(name));
    }
    for (const line of readFileSync(path.join(WORK_DIR, "geonames", "cities1000.txt"), "utf8").split("\n")) {
      const c = line.split("\t");
      if (FR_COUNTRIES.has(c[8]) && c[13]) admin4.set(Number(c[0]), c[13]);
      if (c[8] === "US" && stateNames.has(c[10])) usNames.set(Number(c[0]), { state: stateNames.get(c[10])!, names: [...new Set([c[1], c[2]].map(usPlain))] });
    }
    const fr = places.some((p) => FR_COUNTRIES.has(p.countryCode)) ? await loadFrance() : null;
    const ew = places.some((p) => p.countryCode === "GB") ? await loadEnglandWales() : null;
    const us = places.some((p) => p.countryCode === "US") ? await loadUnitedStates() : null;
    // A US place's FBI city: same state, same name - or the FBI's name less
    // "township", "village", "borough", "town", "city" ("New York City" is
    // the FBI's "New York"). One FBI city for the largest place of that name.
    const usKeyOf = new Map<number, string>();
    if (us) {
      const fbiShort = new Map<string, string | null>();
      for (const key of Object.keys(us.byCity)) {
        // "Metropolitan Nashville Police Department", "Louisville Metro",
        // "Charlotte-Mecklenburg", "Cherry Hill Township" -> the town.
        const [state, city] = key.split("|");
        const short = city
          .replace(/^metropolitan (.+) police department$/, "$1")
          .replace(/ (metropolitan )?police department$/, "")
          .replace(/ metro$/, "")
          .replace(/-.*$/, "")
          .replace(/ (township|village|borough|town|city)$/, "");
        const shortKey = `${state}|${short}`;
        if (short !== city) fbiShort.set(shortKey, fbiShort.has(shortKey) ? null : key);
      }
      const owner = new Map<string, { i: number; pop: number }>();
      places.forEach((p, i) => {
        if (p.countryCode !== "US") return;
        const names = usNames.get(p.geonameId);
        if (!names) return;
        let key: string | null = null;
        for (const name of names.names) {
          for (const candidate of [name, name.replace(/ city$/, ""), name.replace(/-.*$/, "")]) {
            const k = `${names.state}|${candidate}`;
            if (us.byCity[k]) key ??= k;
            else if (fbiShort.get(k)) key ??= fbiShort.get(k)!;
          }
        }
        if (!key) return;
        const pop = p.population;
        const prev = owner.get(key);
        if (!prev || pop > prev.pop) owner.set(key, { i, pop });
      });
      for (const [key, { i }] of owner) usKeyOf.set(i, key);
    }
    // Neighbourhoods on a 0.1-degree grid, for finding those inside an outline.
    const grid = new Map<string, Neighbourhood[]>();
    for (const h of ew?.hoods ?? []) {
      const key = `${Math.floor(h.lng * 10)},${Math.floor(h.lat * 10)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(h);
    }
    let found = 0;
    const out = places.map((p, i) => {
      if (us && p.countryCode === "US") {
        const key = usKeyOf.get(i);
        if (!key) return null;
        found++;
        return { rates: us.byCity[key], national: us.national, years: us.years, source: "US" };
      }
      if (ew && p.countryCode === "GB") {
        const encoded = outlineOf(i);
        const rates = encoded ? englandWalesRates(ew, grid, encoded) : null;
        if (!rates) return null;
        found++;
        return { rates, national: ew.national, years: ew.years, source: "GB" };
      }
      if (fr && FR_COUNTRIES.has(p.countryCode)) {
        const rates = fr.byCommune[admin4.get(p.geonameId) ?? ""];
        if (!rates) return null;
        found++;
        return { rates, national: fr.national, years: fr.years, source: "FR" };
      }
      return null;
    });
    log("crime", `${found} places with local crime figures`);
    return out;
  });
}
