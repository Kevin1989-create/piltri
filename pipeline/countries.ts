import { ISO2_TO_ISO3 } from "./sources/countryCodes";
import { getCountryLanguages } from "./sources/languages";
import { getCountryMedianAge } from "./sources/medianAge";
import { getClimateReadiness } from "./sources/climateReadiness";
import { normalise } from "@/lib/aggregation/scoring";
import { RANGES } from "@/lib/dataset/assemble";
import type { CountryRecord } from "@/lib/dataset/schema";
import type { GdpSector, GdpSectorShare, TrendDirection } from "@/lib/types";
import type { CountryInfo } from "./shortlist";
import { cached, fetchJson, log, round, sleep } from "./util";

/** Every World Bank indicator the site uses, fetched ONCE for all
 *  countries at the same time (country/all bulk endpoint) instead of
 *  ~21 calls per city at request time. Same indicator codes and the same
 *  "6 most recent non-null values" window the old live client used, so
 *  values and trend calculations are identical. */
const INDICATORS = {
  population: "SP.POP.TOTL",
  density: "EN.POP.DNST",
  landArea: "AG.LND.TOTL.K2",
  gdpLevel: "NY.GDP.MKTP.KD", // constant 2015 US$ - growth
  gni: "NY.GNP.PCAP.CD",
  unemployment: "SL.UEM.TOTL.ZS",
  ppp: "NY.GDP.PCAP.PP.CD",
  priceLevel: "PA.NUS.PRVT.PLI",
  politicalStability: "GOV_WGI_PV.SC",
  ruleOfLaw: "GOV_WGI_RL.SC",
  homicideRate: "VC.IHR.PSRC.P5",
  agriculture: "NV.AGR.TOTL.ZS",
  industry: "NV.IND.TOTL.ZS",
  services: "NV.SRV.TOTL.ZS",
  gdpCurrent: "NY.GDP.MKTP.CD",
  taxRevenue: "GC.TAX.TOTL.GD.ZS",
  lifeExpectancy: "SP.DYN.LE00.IN",
  internetUsers: "IT.NET.USER.ZS",
  pisaMath: "LO.PISA.MAT",
  pisaReading: "LO.PISA.REA",
  pisaScience: "LO.PISA.SCI",
} as const;

type IndicatorKey = keyof typeof INDICATORS;
type Series = { date: string; value: number }[];

async function fetchIndicatorAllCountries(code: string): Promise<Record<string, Series>> {
  const json = await fetchJson<any[]>(`https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=20000&date=2000:2026`);
  const rows: { countryiso3code: string; date: string; value: number | null }[] = json?.[1] ?? [];
  const out: Record<string, Series> = {};
  for (const r of rows) {
    if (r.value == null || !r.countryiso3code) continue;
    (out[r.countryiso3code] ??= []).push({ date: r.date, value: r.value });
  }
  // Same window the old per-country call used (mrnev=6): the 6 most recent
  // non-null observations, oldest first.
  for (const iso3 of Object.keys(out)) {
    out[iso3] = out[iso3].sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  }
  return out;
}

const latest = (s: Series | undefined) => (s && s.length ? s[s.length - 1].value : null);

function pctChange(s: Series | undefined): number | null {
  if (!s || s.length < 2) return null;
  const first = s[0].value;
  const last = s[s.length - 1].value;
  if (!first) return null;
  return Number((((last - first) / Math.abs(first)) * 100).toFixed(1));
}

function trendFromPctChange(pct: number | null): TrendDirection {
  if (pct == null) return "Stable";
  if (pct >= 5) return "Improving";
  if (pct <= -5) return "Worsening";
  return "Stable";
}

function rankGdpSectors(agriculture: number | null, industry: number | null, services: number | null): GdpSectorShare[] {
  const entries: [GdpSector, number | null][] = [
    ["Agriculture", agriculture],
    ["Industry", industry],
    ["Services", services],
  ];
  return entries
    .filter((e): e is [GdpSector, number] => e[1] != null)
    .map(([sector, sharePct]) => ({ sector, sharePct: Number(sharePct.toFixed(1)) }))
    .sort((a, b) => b.sharePct - a.sharePct);
}

/** WHO UHC service coverage index (data.who.int, CC BY 4.0 - attribution:
 *  "World Health Organization, data.who.int, UHC service coverage index"). */
async function fetchWhoUhc(): Promise<Record<string, number>> {
  const json = await fetchJson<{ value: { SpatialDim: string; TimeDim: number; NumericValue: number | null }[] }>(
    "https://ghoapi.azureedge.net/api/UHC_INDEX_REPORTED"
  );
  const best: Record<string, { year: number; value: number }> = {};
  for (const r of json.value ?? []) {
    if (r.NumericValue == null) continue;
    const prev = best[r.SpatialDim];
    if (!prev || r.TimeDim > prev.year) best[r.SpatialDim] = { year: r.TimeDim, value: r.NumericValue };
  }
  return Object.fromEntries(Object.entries(best).map(([iso3, v]) => [iso3, Math.round(v.value)]));
}

/** WHO's modelled national PM2.5 (2023, total population; data.who.int,
 *  CC BY 4.0), by ISO3. */
export async function fetchWhoNationalPm25(): Promise<Record<string, number>> {
  return cached("who-pm25-national", async () => {
    const json = await fetchJson<{ value: { SpatialDim: string; TimeDim: number; NumericValue: number | null; Dim1: string }[] }>(
      "https://ghoapi.azureedge.net/api/SDGPM25?$filter=Dim1%20eq%20%27RESIDENCEAREATYPE_TOTL%27"
    );
    const best: Record<string, { year: number; value: number }> = {};
    for (const r of json.value ?? []) {
      if (r.NumericValue == null) continue;
      if (!best[r.SpatialDim] || r.TimeDim > best[r.SpatialDim].year) best[r.SpatialDim] = { year: r.TimeDim, value: r.NumericValue };
    }
    return Object.fromEntries(Object.entries(best).map(([iso3, v]) => [iso3, round(v.value, 1)!]));
  });
}

/** One record per country in the shortlist (name, currency and capital come
 *  from GeoNames via the shortlist step). */
export async function buildCountries(countryInfo: Record<string, CountryInfo>): Promise<Record<string, CountryRecord>> {
  const series = await cached("worldbank-series", async () => {
    const out: Partial<Record<IndicatorKey, Record<string, Series>>> = {};
    for (const [key, code] of Object.entries(INDICATORS) as [IndicatorKey, string][]) {
      log("worldbank", `${code}`);
      out[key] = await fetchIndicatorAllCountries(code);
      await sleep(300);
    }
    return out as Record<IndicatorKey, Record<string, Series>>;
  });
  const who = await cached("who-uhc", fetchWhoUhc);

  // GDP world rank among real countries only (the bulk endpoint also returns
  // aggregates like "World"/"Euro area" - filtered via the ISO map).
  const realIso3 = new Set(Object.values(ISO2_TO_ISO3));
  const gdpRanked = Object.entries(series.gdpCurrent)
    .filter(([iso3]) => realIso3.has(iso3))
    .map(([iso3, s]) => [iso3, latest(s)] as const)
    .filter((e): e is readonly [string, number] => e[1] != null)
    .sort((a, b) => b[1] - a[1]);
  const gdpRank = new Map(gdpRanked.map(([iso3], i) => [iso3, i + 1]));

  const countries: Record<string, CountryRecord> = {};
  for (const [cc, info] of Object.entries(countryInfo)) {
    const iso3 = ISO2_TO_ISO3[cc];
    const get = (key: IndicatorKey) => (iso3 ? series[key][iso3] : undefined);
    const priceLevel = latest(get("priceLevel"));
    const gni = latest(get("gni"));
    const politicalStability = latest(get("politicalStability"));
    const ruleOfLaw = latest(get("ruleOfLaw"));
    const languages = getCountryLanguages(cc);

    countries[cc] = {
      name: info.name,
      demographics: {
        countryPopulation: latest(get("population")),
        countryPopulationDensityPerKm2: latest(get("density")),
        countryLandAreaKm2: latest(get("landArea")),
        countryAverageAge: getCountryMedianAge(cc),
        countryPopulationTrend5yrPct: pctChange(get("population")),
        countryMostWidelySpokenLanguage: languages.mostWidelySpokenLanguage,
      },
      economy: {
        economicGrowth5yrGdpPct: pctChange(get("gdpLevel")) ?? 0,
        averageSalaryGbp: Math.round((gni ?? 0) * 0.79),
        unemploymentRatePct: latest(get("unemployment")) ?? 0,
        gdpSectorRanking: rankGdpSectors(latest(get("agriculture")), latest(get("industry")), latest(get("services"))),
        costOfLivingIndex: priceLevel != null ? normalise(priceLevel, RANGES.priceLevel.min, RANGES.priceLevel.max) : 50,
        purchasingPowerIndex: normalise(latest(get("ppp")) ?? 0, RANGES.ppp.min, RANGES.ppp.max),
        gdpUsd: latest(get("gdpCurrent")),
        gdpWorldRank: iso3 ? gdpRank.get(iso3) ?? null : null,
        taxRevenuePctGdp: latest(get("taxRevenue")),
        currency: info.currencyCode ? { code: info.currencyCode, name: info.currencyName ?? info.currencyCode } : null,
      },
      safetyStability: {
        politicalStabilityScore: politicalStability != null ? Math.round(politicalStability) : 50,
        ruleOfLawScore: ruleOfLaw != null ? Math.round(ruleOfLaw) : 50,
        safetyTrend: trendFromPctChange(pctChange(get("politicalStability"))),
        homicideRatePer100k: latest(get("homicideRate")) ?? RANGES.homicideRate.min,
      },
      climateReadinessScore: getClimateReadiness(cc)?.gainScore ?? null,
      healthcareQualityScore: iso3 ? who[iso3] ?? null : null,
      lifeExpectancyYears: round(latest(get("lifeExpectancy")), 1),
      internetUsersPct: round(latest(get("internetUsers")), 1),
      pisaMathScore: round(latest(get("pisaMath")), 0),
      pisaReadingScore: round(latest(get("pisaReading")), 0),
      pisaScienceScore: round(latest(get("pisaScience")), 0),
      gniPerCapitaUsd: gni,
      capital: info.capital,
      pm25NationalEstimate: null, // filled in by build.ts where needed
    };
  }
  log("countries", `${Object.keys(countries).length} countries built`);
  return countries;
}
