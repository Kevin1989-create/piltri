import { readFileSync } from "fs";
import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { CRIME_COUNTRIES, CRIME_KINDS, CRIME_SOURCES, CRIME_TOO_FEW } from "@/lib/dataset/schema";
import { cached, downloadOnce, fetchJson, log, pointsKey, WORK_DIR } from "./util";

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

// ---- All countries --------------------------------------------------------

export async function sampleCrime(places: { geonameId: number; countryCode: string; lat: number; lng: number }[]): Promise<(PlaceCrime | null)[]> {
  return cached(`crime-v2-${pointsKey(places)}`, async () => {
    // Each place's official local code (GeoNames admin4: the INSEE commune code in France).
    const admin4 = new Map<number, string>();
    for (const line of readFileSync(path.join(WORK_DIR, "geonames", "cities1000.txt"), "utf8").split("\n")) {
      const c = line.split("\t");
      if (FR_COUNTRIES.has(c[8]) && c[13]) admin4.set(Number(c[0]), c[13]);
    }
    const fr = places.some((p) => FR_COUNTRIES.has(p.countryCode)) ? await loadFrance() : null;
    let found = 0;
    const out = places.map((p) => {
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
