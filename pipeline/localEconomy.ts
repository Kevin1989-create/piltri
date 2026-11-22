import { readFileSync } from "fs";
import path from "path";
import { haversineKm } from "@/lib/geo";
import { cached, downloadOnce, log, pointsKey, unzipOnce, WORK_DIR } from "./util";

/**
 * Is the local economy thriving? (2026-11-22, owner: "a succession of
 * elements which would help us flagging whether the economy is thriving in
 * the city or not"). Country by country from each one's official open
 * figures, like recorded crime - never estimated; where a town has no figure
 * of its own, the closest area that has one, named as such.
 *
 *   - Unemployment rate, %, beside the country's.
 *   - Median household income, beside the country's (% of it).
 */

export interface LocalEconomy {
  unemploymentPct: number | null;
  unemploymentNationalPct: number | null;
  unemploymentYear: string | null;
  /** The area of the figure when it isn't the town itself. */
  unemploymentArea: string | null;
  incomeMedian: number | null;
  incomeVsNationalPct: number | null;
  incomeYear: string | null;
  incomeArea: string | null;
  /** Whose figures (lib/dataset/schema.ts ECONOMY_SOURCES). */
  source: string | null;
}

const EMPTY: LocalEconomy = {
  unemploymentPct: null,
  unemploymentNationalPct: null,
  unemploymentYear: null,
  unemploymentArea: null,
  incomeMedian: null,
  incomeVsNationalPct: null,
  incomeYear: null,
  incomeArea: null,
  source: null,
};

// ---- United States ---------------------------------------------------------

/**
 * Unemployment: the Bureau of Labor Statistics' Local Area Unemployment
 * Statistics, the latest full year's average, for every city of 25,000+
 * and every county (public domain). Income: the Census Bureau's American
 * Community Survey, 5-year estimates, median household income of every
 * place and county (table B19013, public domain). A town is the Census
 * place of its name nearest to it (the Census gazetteer); otherwise its
 * county's figures.
 */
const BLS = "https://download.bls.gov/pub/time.series/la";
/** BLS asks automated downloads to say who they are. */
const BLS_HEADERS = { "User-Agent": "PiltriDataBuilder/1.0 (https://www.piltri.me)" };
const ACS_YEARS = [2025, 2024, 2023];

const usPlain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bst\.? /g, "saint ")
    .replace(/\bft\.? /g, "fort ")
    .replace(/\bmt\.? /g, "mount ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "Knoxville city" -> "knoxville"; the Census's legal descriptions away. */
const placeName = (s: string) =>
  usPlain(s.replace(/ (city|town|village|borough|CDP|municipality|city and borough|unified government|consolidated government|metropolitan government|urban county|zona urbana|comunidad)( \(balance\))?$/i, ""));

/** Series id -> the latest year's annual average (period M13), for the
 *  series ending in one of `measures` (03 rate, 04 unemployed, 06 labour force). */
async function blsAnnual(file: string, measures = ["03"]): Promise<Map<string, { year: number; value: number }>> {
  const local = await downloadOnce(`${BLS}/${file}`, `bls/${file}.txt`);
  const out = new Map<string, { year: number; value: number }>();
  for (const line of readFileSync(local, "utf8").split("\n")) {
    const [id, year, period, value] = line.split("\t").map((s) => s.trim());
    if (period !== "M13" || !measures.includes(id?.slice(-2) ?? "")) continue;
    const v = Number(value);
    const y = Number(year);
    if (!Number.isFinite(v)) continue;
    const prev = out.get(id);
    if (!prev || y > prev.year) out.set(id, { year: y, value: v });
  }
  return out;
}

async function acsMedianIncome(): Promise<{ year: number; byGeo: Map<string, number> } | null> {
  for (const year of ACS_YEARS) {
    try {
      const file = await downloadOnce(`https://www2.census.gov/programs-surveys/acs/summary_file/${year}/table-based-SF/data/5YRData/acsdt5y${year}-b19013.dat`, `acs/acsdt5y${year}-b19013.dat`);
      const byGeo = new Map<string, number>();
      for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
        const [geo, value] = line.split("|");
        const v = Number(value);
        if (geo && v > 0) byGeo.set(geo, v);
      }
      return { year, byGeo };
    } catch {
      // Not out yet: the year before.
    }
  }
  return null;
}

async function loadUnitedStates() {
  const gazZip = await downloadOnce("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip", "census-gaz-place-2024.zip");
  const gazDir = path.join(WORK_DIR, "census-gaz-2024");
  unzipOnce(gazZip, gazDir, "2024_Gaz_place_national.txt");
  const cities = await blsAnnual("la.data.65.City");
  const counties = await blsAnnual("la.data.64.County", ["03", "04", "06"]);
  const income = await acsMedianIncome();
  return cached(`economy-us-v2-${[...cities.values()][0]?.year}-${income?.year}`, async () => {
    // Census places by state: name, code, point.
    const places: Record<string, { name: string; geoid: string; lat: number; lng: number }[]> = {};
    for (const line of readFileSync(path.join(gazDir, "2024_Gaz_place_national.txt"), "utf8").split("\n").slice(1)) {
      const c = line.split("\t").map((s) => s.trim());
      if (!c[1]) continue;
      (places[c[0]] ??= []).push({ name: placeName(c[3]), geoid: c[1], lat: Number(c[10]), lng: Number(c[11]) });
    }
    // The nation's: every county's unemployed over every county's labour force, the same year.
    const year = Math.max(...[...counties.values()].map((v) => v.year));
    let unemployed = 0;
    let labourForce = 0;
    for (const [id, v] of counties) {
      if (v.year !== year) continue;
      if (id.endsWith("04")) unemployed += v.value;
      else if (id.endsWith("06")) labourForce += v.value;
    }
    const national = labourForce ? { year, value: Math.round((unemployed / labourForce) * 1000) / 10 } : null;
    return {
      places,
      cityRate: Object.fromEntries([...cities].map(([id, v]) => [id.slice(5, 12), v])),
      countyRate: Object.fromEntries([...counties].filter(([id]) => id.endsWith("03")).map(([id, v]) => [id.slice(5, 10), v])),
      nationalRate: national,
      income: income ? { year: income.year, byGeo: Object.fromEntries(income.byGeo) } : null,
    };
  });
}

// ---- All countries ----------------------------------------------------------

export async function sampleLocalEconomy(places: { geonameId: number; cityName: string; countryCode: string; lat: number; lng: number; population: number }[]): Promise<LocalEconomy[]> {
  return cached(`local-economy-v2-${pointsKey(places)}`, async () => {
    const usAdmin = new Map<number, { state: string; county: string }>();
    const countyNames = new Map<string, string>();
    for (const line of readFileSync(await downloadOnce("https://download.geonames.org/export/dump/admin2Codes.txt", "admin2Codes.txt"), "utf8").split("\n")) {
      const [code, name] = line.split("\t");
      if (code?.startsWith("US.")) countyNames.set(code.slice(3), name);
    }
    const stateFips = new Map<string, string>();
    for (const line of readFileSync(path.join(WORK_DIR, "geonames", "cities1000.txt"), "utf8").split("\n")) {
      const c = line.split("\t");
      if (c[8] === "US") usAdmin.set(Number(c[0]), { state: c[10], county: c[11] });
    }
    const us = places.some((p) => p.countryCode === "US") ? await loadUnitedStates() : null;
    if (us) {
      // State postal code -> FIPS, from the gazetteer's codes.
      for (const [state, list] of Object.entries(us.places)) if (list[0]) stateFips.set(state, list[0].geoid.slice(0, 2));
    }
    let own = 0;
    let area = 0;
    const out = places.map((p) => {
      if (us && p.countryCode === "US") {
        const admin = usAdmin.get(p.geonameId);
        if (!admin) return EMPTY;
        const fips = stateFips.get(admin.state);
        const countyFips = fips && admin.county ? `${fips}${admin.county}` : null;
        // "Boise City city" is Boise: a trailing "city" aside on both sides; big
        // cities' Census points can sit far from their centres (30 km).
        const name = placeName(p.cityName).replace(/ city$/, "");
        const place = (us.places[admin.state] ?? [])
          .filter((c) => c.name.replace(/ city$/, "") === name)
          .map((c) => ({ c, km: haversineKm(p.lat, p.lng, c.lat, c.lng) }))
          .filter((x) => x.km < 30)
          .sort((a, b) => a.km - b.km)[0]?.c;
        const cityU = place ? us.cityRate[place.geoid] : undefined;
        const countyU = countyFips ? us.countyRate[countyFips] : undefined;
        const unemployment = cityU ?? countyU;
        const placeIncome = place ? us.income?.byGeo[`1600000US${place.geoid}`] : undefined;
        const countyIncome = countyFips ? us.income?.byGeo[`0500000US${countyFips}`] : undefined;
        const incomeValue = placeIncome ?? countyIncome;
        const nationalIncome = us.income?.byGeo["0100000US"];
        if (unemployment == null && incomeValue == null) return EMPTY;
        if (cityU || placeIncome) own++;
        else area++;
        const countyName = countyNames.get(`${admin.state}.${admin.county}`) ?? "the county";
        return {
          unemploymentPct: unemployment?.value ?? null,
          unemploymentNationalPct: us.nationalRate?.value ?? null,
          unemploymentYear: unemployment ? String(unemployment.year) : null,
          unemploymentArea: unemployment && !cityU ? countyName : null,
          incomeMedian: incomeValue ?? null,
          incomeVsNationalPct: incomeValue && nationalIncome ? Math.round((incomeValue / nationalIncome) * 100) : null,
          incomeYear: incomeValue && us.income ? `${us.income.year - 4}-${us.income.year}` : null,
          incomeArea: incomeValue && !placeIncome ? countyName : null,
          source: "US",
        };
      }
      return EMPTY;
    });
    log("economy", `local economy: ${own} places with their own figures, ${area} with their county's`);
    return out;
  });
}

export const LOCAL_ECONOMY_SOURCE = "US: Bureau of Labor Statistics, Local Area Unemployment Statistics; Census Bureau, American Community Survey 5-year estimates (public domain)";
