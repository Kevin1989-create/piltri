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
  /** The area the figures are for when it isn't the place itself: its
   *  municipality, its regional police force, the city it's part of. */
  area?: string;
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

// ---- Netherlands ----------------------------------------------------------

/**
 * Statistics Netherlands (CBS, CC BY 4.0): crimes registered by the police,
 * by municipality - table 83648NED (by kind of crime) and 83651NED (thefts
 * by kind). The last three years. Residents: CBS's own, from its rate per
 * 1,000 of all crimes. GeoNames' second-level code is the municipality's.
 */
const CBS = "https://opendata.cbs.nl/ODataApi/odata";
const NL_KINDS: Record<(typeof CRIME_KINDS)[number], { table: "83648NED" | "83651NED"; codes: string[] }> = {
  // Violent and sexual crimes (assault, threats, sexual offences...).
  violent: { table: "83648NED", codes: ["CRI3000"] },
  // Break-ins and thefts from homes.
  burglary: { table: "83651NED", codes: ["CRI1135"] },
  // Pickpocketing and bicycle theft.
  theft: { table: "83651NED", codes: ["CRI1133", "CRI1122"] },
  // Cars, motorbikes and scooters stolen; thefts from cars.
  vehicle: { table: "83651NED", codes: ["CRI1124", "CRI1125", "CRI1128"] },
  // Destruction and damage.
  vandalism: { table: "83648NED", codes: ["CRI2100"] },
};

type CbsRow = Record<string, string | number | null>;

async function cbsRows(table: string, filter: string): Promise<CbsRow[]> {
  const out: CbsRow[] = [];
  let url: string | null = `${CBS}/${table}/TypedDataSet?$filter=${encodeURIComponent(filter)}`;
  while (url) {
    const page: { value: CbsRow[]; "odata.nextLink"?: string } = await fetchJson(url);
    out.push(...page.value);
    url = page["odata.nextLink"] ?? null;
  }
  return out;
}

async function loadNetherlands(): Promise<{ byMunicipality: Record<string, (number | null)[]>; residents: Record<string, number>; names: Record<string, string>; national: (number | null)[]; years: string }> {
  const periods = (await fetchJson<{ value: { Key: string }[] }>(`${CBS}/83648NED/Perioden`)).value.map((p) => p.Key).filter((k) => /JJ00$/.test(k));
  const years = periods.slice(-3);
  return cached(`crime-nl-v4-${years.join("-")}`, async () => {
    const inYears = `(${years.map((y) => `Perioden eq '${y}'`).join(" or ")})`;
    const places = "(startswith(RegioS,'GM') or startswith(RegioS,'NL01'))";
    const any = (dim: string, codes: string[]) => `(${codes.map((c) => `${dim} eq '${c}'`).join(" or ")})`;
    const crimeCodes = ["T001161", ...NL_KINDS.violent.codes, ...NL_KINDS.vandalism.codes];
    const theftCodes = (["burglary", "theft", "vehicle"] as const).flatMap((k) => NL_KINDS[k].codes);
    const crimes = await cbsRows("83648NED", `${places} and ${inYears} and ${any("SoortMisdrijf", crimeCodes)}`);
    const thefts = await cbsRows("83651NED", `${places} and ${inYears} and GebruikVanGeweld eq 'T001540' and ${any("SoortDiefstal", theftCodes)}`);

    // region -> code -> summed count over the years; region -> residents summed over the years
    const counts = new Map<string, Map<string, number>>();
    const residentYears = new Map<string, number>();
    const add = (region: string, code: string, n: number) => {
      if (!counts.has(region)) counts.set(region, new Map());
      counts.get(region)!.set(code, (counts.get(region)!.get(code) ?? 0) + n);
    };
    for (const r of crimes) {
      const region = String(r.RegioS).trim();
      const n = Number(r.TotaalGeregistreerdeMisdrijven_1);
      if (r.TotaalGeregistreerdeMisdrijven_1 == null || !Number.isFinite(n)) continue;
      add(region, String(r.SoortMisdrijf), n);
      const per1000 = Number(r.GeregistreerdeMisdrijvenPer1000Inw_3);
      if (r.SoortMisdrijf === "T001161" && per1000 > 0) residentYears.set(region, (residentYears.get(region) ?? 0) + (n * 1000) / per1000);
    }
    for (const r of thefts) {
      const n = Number(r.TotaalGeregistreerdeDiefstallen_1);
      if (r.TotaalGeregistreerdeDiefstallen_1 == null || !Number.isFinite(n)) continue;
      add(String(r.RegioS).trim(), String(r.SoortDiefstal), n);
    }
    // Rates per 1,000 residents a year: the years' crimes over the years' residents.
    const ratesOf = (region: string) => {
      const people = residentYears.get(region);
      const c = counts.get(region);
      if (!people || !c) return null;
      return CRIME_KINDS.map((kind) => {
        const { codes } = NL_KINDS[kind];
        if (codes.some((code) => !c.has(code))) return null;
        return Math.round((codes.reduce((s, code) => s + c.get(code)!, 0) / people) * 1000 * 100) / 100;
      });
    };
    const byMunicipality: Record<string, (number | null)[]> = {};
    const residents: Record<string, number> = {};
    for (const region of counts.keys()) {
      if (!region.startsWith("GM")) continue;
      const rates = ratesOf(region);
      if (rates) {
        byMunicipality[region] = rates;
        residents[region] = Math.round(residentYears.get(region)! / years.length);
      }
    }
    const national = ratesOf("NL01") ?? CRIME_KINDS.map(() => null);
    const label = `${years[0].slice(0, 4)}-${years[years.length - 1].slice(0, 4)}`;
    log("crime", `CBS ${label}: ${Object.keys(byMunicipality).length} municipalities; national per 1,000: ${CRIME_KINDS.map((k, i) => `${k} ${national[i]}`).join(", ")}`);
    const names: Record<string, string> = {};
    for (const r of (await fetchJson<{ value: { Key: string; Title: string }[] }>(`${CBS}/83648NED/RegioS`)).value) {
      const key = r.Key.trim();
      // "Utrecht (gemeente)" -> "Utrecht".
      if (byMunicipality[key]) names[key] = r.Title.trim().replace(/ \((gemeente|gem\.)\)$/i, "");
    }
    return { byMunicipality, residents, names, national, years: label };
  });
}

// ---- Canada ---------------------------------------------------------------

/**
 * Statistics Canada (Open Licence): incidents reported by each police
 * service, tables 35-10-0178 to 35-10-0185 (one per province or group),
 * the last three years, through its data service (only the series needed,
 * not the multi-gigabyte files). A town's figure is its municipal police
 * service's (its own force, or the RCMP or OPP policing it under contract);
 * a town policed by a regional service ("Peel Region (Mississauga/Brampton)")
 * gets the region's, marked as such.
 * Residents: Statistics Canada's own, from the service's rate of all
 * incidents. National: table 35-10-0177's Canada.
 */
const STATCAN = "https://www150.statcan.gc.ca/t1/wds/rest";
const CA_TABLES = [35100178, 35100179, 35100180, 35100181, 35100182, 35100183, 35100184, 35100185];
const CA_NATIONAL_TABLE = 35100177;
const CA_TOTAL = "Total, all violations";
const CA_KINDS: Record<(typeof CRIME_KINDS)[number], string[]> = {
  violent: ["Total violent Criminal Code violations"],
  burglary: ["Total breaking and entering"],
  theft: ["Total theft under $5,000 (non-motor vehicle)", "Total theft over $5,000 (non-motor vehicle)"],
  vehicle: ["Total theft of motor vehicle"],
  vandalism: ["Total mischief"],
};

/** The towns a regional police service covers that its name doesn't list. */
const CA_REGIONAL_TOWNS: Record<string, string[]> = {
  "ontario|york region": ["Markham", "Vaughan", "Richmond Hill", "Newmarket", "Aurora", "Whitchurch-Stouffville", "Stouffville", "East Gwillimbury", "Georgina", "King City", "Thornhill", "Woodbridge", "Maple", "Keswick"],
  "ontario|waterloo region (kitchener)": ["Waterloo", "Cambridge", "Woolwich", "Wilmot", "Wellesley", "North Dumfries", "Elmira", "New Hamburg"],
  "ontario|halton region (oakville/burlington)": ["Milton", "Halton Hills", "Georgetown", "Acton"],
  "ontario|durham region (oshawa/whitby/ajax)": ["Pickering", "Clarington", "Bowmanville", "Courtice", "Uxbridge", "Scugog", "Port Perry", "Brock"],
  "ontario|niagara region (saint catharines)": ["Niagara Falls", "Welland", "Fort Erie", "Grimsby", "Thorold", "Port Colborne", "Lincoln", "Niagara-on-the-Lake", "Pelham"],
  "nova scotia|cape breton region": ["Sydney", "Glace Bay", "Sydney Mines", "North Sydney", "New Waterford"],
  "new brunswick|codiac regional": ["Moncton", "Dieppe", "Riverview"],
  "new brunswick|kennebecasis region": ["Rothesay", "Quispamsis"],
  // Montréal's police serves the whole island.
  "quebec|montreal": ["Dollard-Des Ormeaux", "Côte-Saint-Luc", "Pointe-Claire", "Dorval", "Kirkland", "Beaconsfield", "Westmount", "Mount Royal", "Mont-Royal", "Montréal-Est", "Montréal-Ouest", "Hampstead", "Baie-D'Urfé", "Sainte-Anne-de-Bellevue", "Senneville", "Saint-Laurent"],
};

interface CubeMember {
  memberId: number;
  memberNameEn: string;
}

async function statcanPost<T>(method: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(`${STATCAN}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

/** year -> value, for each requested coordinate (missing or suppressed values left out). */
async function statcanSeries(productId: number, coordinates: string[], latestN: number): Promise<Map<string, Map<number, number>>> {
  const out = new Map<string, Map<number, number>>();
  for (let k = 0; k < coordinates.length; k += 100) {
    // All ten positions of a coordinate, unused ones 0.
    const batch = coordinates.slice(k, k + 100).map((c) => ({ productId, coordinate: [...c.split("."), ...Array(10).fill("0")].slice(0, 10).join("."), latestN }));
    const res = await statcanPost<{ status: string; object?: { coordinate: string; vectorDataPoint?: { refPer: string; value: number | null }[] } }[]>("getDataFromCubePidCoordAndLatestNPeriods", batch);
    for (const r of res) {
      if (r.status !== "SUCCESS" || !r.object) continue;
      const byYear = new Map<number, number>();
      for (const p of r.object.vectorDataPoint ?? []) if (p.value != null) byYear.set(Number(p.refPer.slice(0, 4)), p.value);
      out.set(r.object.coordinate.replace(/(\.0)+$/, ""), byYear);
    }
  }
  return out;
}

async function cubeDimensions(productId: number): Promise<CubeMember[][]> {
  const [meta] = await statcanPost<{ object: { dimension: { member: CubeMember[] }[] } }[]>("getCubeMetadata", [{ productId }]);
  return meta.object.dimension.map((d) => d.member);
}

/** Per kind and the total, per year: incidents and residents. */
type CaService = { years: Map<number, { counts: Map<string, number>; people: number }> };

async function loadCanada(): Promise<{ byTown: Record<string, (number | null)[]>; names: Record<string, string>; national: (number | null)[]; years: string }> {
  const kindNames = [CA_TOTAL, ...new Set(Object.values(CA_KINDS).flat())];
  const latest = await statcanPost<{ object: { cubeEndDate: string } }[]>("getCubeMetadata", [{ productId: CA_NATIONAL_TABLE }]);
  const tag = latest[0].object.cubeEndDate.slice(0, 4);
  return cached(`crime-ca-v2-${tag}`, async () => {
    // Each table's services and the members of the violations and statistics.
    const services = new Map<string, CaService>();
    const servicesSeen: string[] = [];
    const displayNames: Record<string, string> = {};
    for (const productId of CA_TABLES) {
      const [geos, violations, statistics] = await cubeDimensions(productId);
      const violationId = new Map(violations.map((m) => [m.memberNameEn, m.memberId]));
      const actual = statistics.find((m) => m.memberNameEn === "Actual incidents")!.memberId;
      const rate = statistics.find((m) => m.memberNameEn === "Rate per 100,000 population")!.memberId;
      const municipal = geos.filter((g) => /, municipal \[\d+\]$/.test(g.memberNameEn));
      const coords: string[] = [];
      for (const g of municipal) {
        for (const name of kindNames) if (violationId.has(name)) coords.push(`${g.memberId}.${violationId.get(name)}.${actual}`);
        coords.push(`${g.memberId}.${violationId.get(CA_TOTAL)}.${rate}`);
      }
      const series = await statcanSeries(productId, coords, 3);
      for (const g of municipal) {
        // "Coaldale, Alberta, Royal Canadian Mounted Police, municipal [48005]" -> "alberta|coaldale"
        const parts = g.memberNameEn.replace(/ \[\d+\]$/, "").split(", ");
        const key = `${usPlain(parts[1])}|${usPlain(parts[0])}`;
        displayNames[key] ??= parts[0];
        const service = services.get(key) ?? { years: new Map() };
        const total = series.get(`${g.memberId}.${violationId.get(CA_TOTAL)}.${actual}`);
        const totalRate = series.get(`${g.memberId}.${violationId.get(CA_TOTAL)}.${rate}`);
        for (const [year, n] of total ?? []) {
          const r = totalRate?.get(year);
          if (!r) continue;
          const y = service.years.get(year) ?? { counts: new Map(), people: 0 };
          // Two services for one town (a switch to the RCMP...): added up.
          y.people += (n / r) * 100000;
          for (const name of kindNames) {
            const v = series.get(`${g.memberId}.${violationId.get(name)}.${actual}`)?.get(year);
            if (v != null) y.counts.set(name, (y.counts.get(name) ?? 0) + v);
          }
          service.years.set(year, y);
        }
        services.set(key, service);
        servicesSeen.push(key);
      }
    }
    const ratesOf = (s: CaService) => {
      const years = [...s.years.values()];
      if (years.length < 2) return null;
      const people = years.reduce((sum, y) => sum + y.people, 0);
      if (people < 1000 * years.length) return null;
      return CRIME_KINDS.map((kind) => {
        const names = CA_KINDS[kind];
        if (years.some((y) => names.some((n) => !y.counts.has(n)))) return null;
        return Math.round((years.reduce((sum, y) => sum + names.reduce((s2, n) => s2 + y.counts.get(n)!, 0), 0) / people) * 1000 * 100) / 100;
      });
    };
    const byTown: Record<string, (number | null)[]> = {};
    const names: Record<string, string> = {};
    for (const [key, s] of services) {
      const rates = ratesOf(s);
      if (rates) {
        byTown[key] = rates;
        names[key] = displayNames[key];
      }
    }

    // The whole country: table 35-10-0177's "Canada".
    const [geos, violations, statistics] = await cubeDimensions(CA_NATIONAL_TABLE);
    const canada = geos.find((g) => g.memberNameEn === "Canada")!.memberId;
    const violationId = new Map(violations.map((m) => [m.memberNameEn, m.memberId]));
    const actual = statistics.find((m) => m.memberNameEn === "Actual incidents")!.memberId;
    const rate = statistics.find((m) => m.memberNameEn === "Rate per 100,000 population")!.memberId;
    const coords = [...kindNames.map((n) => `${canada}.${violationId.get(n)}.${actual}`), `${canada}.${violationId.get(CA_TOTAL)}.${rate}`];
    const series = await statcanSeries(CA_NATIONAL_TABLE, coords, 3);
    const nation: CaService = { years: new Map() };
    const totals = series.get(`${canada}.${violationId.get(CA_TOTAL)}.${actual}`);
    for (const [year, n] of totals ?? []) {
      const r = series.get(`${canada}.${violationId.get(CA_TOTAL)}.${rate}`)?.get(year);
      if (!r) continue;
      const counts = new Map<string, number>();
      for (const name of kindNames) {
        const v = series.get(`${canada}.${violationId.get(name)}.${actual}`)?.get(year);
        if (v != null) counts.set(name, v);
      }
      nation.years.set(year, { counts, people: (n / r) * 100000 });
    }
    const national = ratesOf(nation) ?? CRIME_KINDS.map(() => null);
    const years = [...nation.years.keys()].sort();
    log("crime", `Statistics Canada ${years.join(", ")}: ${servicesSeen.length} municipal police services, ${Object.keys(byTown).length} towns; national per 1,000: ${CRIME_KINDS.map((k, i) => `${k} ${national[i]}`).join(", ")}`);
    return { byTown, names, national, years: `${years[0]}-${years[years.length - 1]}` };
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
  places: { geonameId: number; cityName: string; countryCode: string; lat: number; lng: number; population: number }[],
  /** The place's outline (its border, or its built-up area), if any. */
  outlineOf: (i: number) => EncodedBoundary | null
): Promise<(PlaceCrime | null)[]> {
  return cached(`crime-v15-${pointsKey(places)}`, async () => {
    // Each place's official local code (GeoNames admin4: the INSEE commune code in France).
    const admin4 = new Map<number, string>();
    const nlMunicipality = new Map<number, string>();
    const usNames = new Map<number, { state: string; names: string[] }>();
    const stateNames = new Map<string, string>();
    const provinceNames = new Map<string, string>();
    const caNames = new Map<number, { province: string; names: string[] }>();
    for (const line of readFileSync(path.join(RAW_DIR, "admin1CodesASCII.txt"), "utf8").split("\n")) {
      const [code, name] = line.split("\t");
      if (code?.startsWith("US.")) stateNames.set(code.slice(3), usPlain(name));
      if (code?.startsWith("CA.")) provinceNames.set(code.slice(3), usPlain(name));
    }
    for (const line of readFileSync(path.join(WORK_DIR, "geonames", "cities1000.txt"), "utf8").split("\n")) {
      const c = line.split("\t");
      if (FR_COUNTRIES.has(c[8]) && c[13]) admin4.set(Number(c[0]), c[13]);
      // The Netherlands: GeoNames' admin2 is CBS's municipality code.
      if (c[8] === "NL" && c[11]) nlMunicipality.set(Number(c[0]), `GM${c[11]}`);
      if (c[8] === "CA" && provinceNames.has(c[10])) caNames.set(Number(c[0]), { province: provinceNames.get(c[10])!, names: [...new Set([c[1], c[2]].map(usPlain))] });
      if (c[8] === "US" && stateNames.has(c[10])) usNames.set(Number(c[0]), { state: stateNames.get(c[10])!, names: [...new Set([c[1], c[2]].map(usPlain))] });
    }
    const fr = places.some((p) => FR_COUNTRIES.has(p.countryCode)) ? await loadFrance() : null;
    const ew = places.some((p) => p.countryCode === "GB") ? await loadEnglandWales() : null;
    const us = places.some((p) => p.countryCode === "US") ? await loadUnitedStates() : null;
    const nl = places.some((p) => p.countryCode === "NL") ? await loadNetherlands() : null;
    const ca = places.some((p) => p.countryCode === "CA") ? await loadCanada() : null;
    // A Canadian town's police service: same province, same name (hyphens
    // as spaces - "St. Hyacinthe" is "Saint-Hyacinthe"; "Halifax
    // Metropolitan Area" is Halifax); the largest place of that name.
    const caKeyOf = new Map<number, string>();
    const caRegionalOf = new Map<number, string>();
    if (ca) {
      const caLoose = (k: string) => k.replace(/-/g, " ").replace(/ metropolitan area$/, "");
      const byLoose = new Map(Object.keys(ca.byTown).map((k) => [caLoose(k), k]));
      const owner = new Map<string, { i: number; pop: number }>();
      places.forEach((p, i) => {
        if (p.countryCode !== "CA") return;
        const names = caNames.get(p.geonameId);
        const key = names?.names.map((n) => byLoose.get(caLoose(`${names.province}|${n}`))).find((k) => k != null);
        if (!key) return;
        const prev = owner.get(key);
        if (!prev || p.population > prev.pop) owner.set(key, { i, pop: p.population });
      });
      for (const [key, { i }] of owner) caKeyOf.set(i, key);
      // A regional service lists its towns: "Peel Region (Mississauga/Brampton)".
      const regional = new Map<string, string>();
      for (const key of Object.keys(ca.byTown)) {
        const [province, name] = key.split("|");
        const listed = name.match(/\(([^)]+)\)$/)?.[1];
        if (!listed) continue;
        for (const town of listed.split(/[/,]/)) regional.set(caLoose(`${province}|${town.trim()}`), key);
      }
      // The other towns of the regional services (their police boards' own lists).
      for (const [key, towns] of Object.entries(CA_REGIONAL_TOWNS))
        if (ca.byTown[key]) for (const town of towns) regional.set(caLoose(`${key.split("|")[0]}|${usPlain(town)}`), key);
      places.forEach((p, i) => {
        if (p.countryCode !== "CA" || caKeyOf.has(i)) return;
        const names = caNames.get(p.geonameId);
        const key = names?.names.map((n) => regional.get(caLoose(`${names.province}|${n}`))).find((k) => k != null);
        if (key) caRegionalOf.set(i, key);
      });
    }
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
      if (ca && p.countryCode === "CA") {
        const own = caKeyOf.get(i);
        const key = own ?? caRegionalOf.get(i);
        if (!key) return null;
        found++;
        return { rates: ca.byTown[key], national: ca.national, years: ca.years, source: "CA", ...(own ? {} : { area: ca.names[key].replace(/ \(.*\)$/, "") }) };
      }
      if (nl && p.countryCode === "NL") {
        const code = nlMunicipality.get(p.geonameId) ?? "";
        const rates = nl.byMunicipality[code];
        if (!rates) return null;
        found++;
        // A municipality's figure is its main town's (30%+ of its residents);
        // its villages get it marked as the municipality's.
        const main = p.population >= 0.3 * nl.residents[code];
        return { rates, national: nl.national, years: nl.years, source: "NL", ...(main ? {} : { area: `the municipality of ${nl.names[code] ?? code}` }) };
      }
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
    // A place inside another's outline with figures of its own (a city's
    // district or neighbourhood - Brooklyn, Etobicoke, Amsterdam-Zuid) gets
    // that city's, marked as such: the smallest such city around it.
    const figured: number[] = [];
    out.forEach((r, i) => {
      if (r && !r.area && outlineOf(i)) figured.push(i);
    });
    const cityGrid = new Map<string, number[]>();
    for (const i of figured) {
      const key = `${Math.floor(places[i].lng * 2)},${Math.floor(places[i].lat * 2)}`;
      if (!cityGrid.has(key)) cityGrid.set(key, []);
      cityGrid.get(key)!.push(i);
    }
    const decoded = new Map<number, number[][][][]>();
    let contained = 0;
    places.forEach((p, i) => {
      if (out[i] || !CRIME_COUNTRIES[p.countryCode]) return;
      let best: number | null = null;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of cityGrid.get(`${Math.floor(p.lng * 2) + dx},${Math.floor(p.lat * 2) + dy}`) ?? []) {
            const c = places[j];
            if (c.countryCode !== p.countryCode || c.population <= p.population) continue;
            if (best != null && places[best].population <= c.population) continue;
            if (!decoded.has(j)) decoded.set(j, decodeBoundary(outlineOf(j)!));
            if (inside(p.lng, p.lat, decoded.get(j)!)) best = j;
          }
      if (best == null) return;
      out[i] = { ...out[best]!, area: places[best].cityName };
      contained++;
    });
    log("crime", `${found} places with local crime figures, ${contained} more with those of the city they're part of`);
    return out;
  });
}
