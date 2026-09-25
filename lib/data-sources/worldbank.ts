/**
 * World Bank Open Data API — free, no key required.
 * Docs: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
 *
 * World Bank data is country-level, not city-level. Per the locked data
 * model this is intentional — Demographics/Economy/Safety fields represent
 * the country the city sits in.
 */

import { fetchWithTimeout } from "./fetchWithTimeout";
import { ISO2_TO_ISO3 } from "./country-codes";
import type { GdpSector, GdpSectorShare, TrendDirection } from "@/lib/types";

const BASE = "https://api.worldbank.org/v2";
// The full set of genuine ISO3 country codes this app already tracks (see
// country-codes.ts) - used to filter World Bank's "country/all" bulk
// results down to real countries, since that endpoint also returns
// aggregate regions ("World", "OECD members", "Euro area", ...) mixed in
// with actual countries, with no field distinguishing them from this
// endpoint alone (confirmed live 2026-09-25 - had to cross-reference
// against the separate /country list endpoint, which does carry a
// region.value of "Aggregates" for those rows, to filter cleanly).
const REAL_ISO3_CODES = new Set(Object.values(ISO2_TO_ISO3));

interface WBObservation {
  date: string;
  value: number | null;
}

async function fetchIndicator(countryCode: string, indicator: string, years = 6): Promise<WBObservation[]> {
  const url = `${BASE}/country/${countryCode}/indicator/${indicator}?format=json&per_page=${years}&mrnev=${years}`;
  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`World Bank request failed: ${res.status}`);
  const json = await res.json();
  const rows: WBObservation[] = json?.[1] ?? [];
  return rows.filter((r) => r.value !== null).sort((a, b) => a.date.localeCompare(b.date));
}

function latest(obs: WBObservation[]): number | null {
  return obs.length ? obs[obs.length - 1].value : null;
}

function pctChange(obs: WBObservation[]): number | null {
  if (obs.length < 2) return null;
  const first = obs[0].value as number;
  const last = obs[obs.length - 1].value as number;
  if (!first) return null;
  return Number((((last - first) / Math.abs(first)) * 100).toFixed(1));
}

/** Ranks the 3 broad GDP-composition sectors largest-share-first - see
 *  lib/types.ts's GdpSectorShare for why this exists alongside
 *  mainEconomyType. Only includes whichever of the 3 actually resolved
 *  (0-3 entries) - never padded with a guess for a sector that didn't. */
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

/** Turns a multi-year % change into a plain trend label — used for Safety's
 *  political-stability trend. ±5% over the ~6-year window fetched by
 *  fetchIndicator is treated as a real move; anything smaller reads as
 *  noise around a stable baseline. */
function trendFromPctChange(pct: number | null): TrendDirection {
  if (pct == null) return "Stable";
  if (pct >= 5) return "Improving";
  if (pct <= -5) return "Worsening";
  return "Stable";
}

export interface WorldBankIndicators {
  population: number | null;
  populationDensityPerKm2: number | null;
  populationTrend5yrPct: number | null;
  /** Country land area, km² (AG.LND.TOTL.K2) — added 2026-09-22 alongside
   *  the country/city demographics split (see lib/types.ts). */
  landAreaKm2: number | null;
  /** Cumulative real GDP growth over the ~6-year window (from NY.GDP.MKTP.KD,
   *  GDP at constant 2015 US$ — a LEVEL series, not a rate), same pctChange
   *  pattern already used correctly for population above. Fixed 2026-09-24:
   *  this used to take a % change of NY.GDP.MKTP.KD.ZG, the annual growth
   *  RATE itself — mathematically unstable once that window's base year is
   *  small or negative (every current window includes 2020's COVID crash),
   *  which is what produced a nonsensical "+113.8%" for the UK. A % change
   *  of a % is not a meaningful number; % change of the actual GDP level is. */
  gdpGrowth5yrPct: number | null;
  gniPerCapitaUsd: number | null; // used as average salary proxy
  unemploymentRatePct: number | null;
  purchasingPowerParityGdpPerCapita: number | null;
  /** Price Level Index for household consumption (PA.NUS.PRVT.PLI) — ~100
   *  tracks roughly US price levels; a genuine, free, globally-covered cost
   *  of living proxy (verified: Switzerland ~127, Portugal ~60, India ~23). */
  priceLevelIndex: number | null;
  /** Worldwide Governance Indicators — both already published on a 0-100
   *  "governance score" scale (GOV_WGI_PV.SC / GOV_WGI_RL.SC), free and
   *  keyless via this same API. */
  politicalStabilityScore: number | null;
  ruleOfLawScore: number | null;
  /** Derived from politicalStabilityScore's own multi-year trend — not a
   *  separate placeholder (see trendFromPctChange above). */
  politicalStabilityTrend: TrendDirection;
  /** Intentional homicides per 100,000 people (VC.IHR.PSRC.P5, sourced from
   *  UNODC via the same World Bank API) — added 2026-09-23 alongside the
   *  Safety & Stability data review. A hard crime statistic, complementing
   *  WGI's two perception-based governance scores above. */
  homicideRatePer100k: number | null;
  /** Agriculture/Industry/Services (NV.AGR/IND/SRV.TOTL.ZS, value added %
   *  of GDP), ranked largest-share-first — see lib/types.ts's
   *  GdpSectorShare. Added 2026-09-24 as a country-level companion to
   *  Economy's city-level mainEconomyType. */
  gdpSectorRanking: GdpSectorShare[];
  /** GDP in current US$ (NY.GDP.MKTP.CD - the "headline" figure people
   *  recognise, e.g. "$4.0 trillion"), NOT the same series as
   *  gdpGrowth5yrPct above (that one deliberately uses constant 2015 US$
   *  to isolate real growth from inflation/exchange-rate noise - this one
   *  wants the actual current-dollar size). Added 2026-09-25. */
  gdpCurrentUsd: number | null;
  /** Tax revenue, % of GDP (GC.TAX.TOTL.GD.ZS) - a standard, widely-used
   *  measure of a country's overall taxation level. Added 2026-09-25. */
  taxRevenuePctGdp: number | null;
  /** Life expectancy at birth, years (SP.DYN.LE00.IN) - added 2026-09-26
   *  as a Quality of Life field that doesn't depend on Overpass (verified
   *  live: UK 81.4, US 78.9, India 72.2 - globally covered, unlike
   *  SE.ADT.LITR.ZS literacy rate, which came back empty for both the UK
   *  and US - most developed countries simply don't report it, so it was
   *  ruled out despite also being considered). */
  lifeExpectancyYears: number | null;
  /** Individuals using the Internet, % of population (IT.NET.USER.ZS) -
   *  added 2026-09-26 alongside lifeExpectancyYears, same reasoning: a
   *  real, globally-covered Quality of Life signal from the same API
   *  already used everywhere else in this file, zero new integration. */
  internetUsersPct: number | null;
}

/**
 * Pulls the World Bank indicators that feed Demographics + Economy +
 * Safety & Stability. Indicator codes: https://data.worldbank.org/indicator
 * (governance indicators specifically live under source=3, "Worldwide
 * Governance Indicators" — verified via https://api.worldbank.org/v2/sources).
 */
export async function getWorldBankIndicators(countryCode: string): Promise<WorldBankIndicators> {
  const [
    population,
    density,
    landArea,
    gdpLevel,
    gni,
    unemployment,
    ppp,
    priceLevel,
    politicalStability,
    ruleOfLaw,
    homicideRate,
    agriculture,
    industry,
    services,
    gdpCurrent,
    taxRevenue,
    lifeExpectancy,
    internetUsers,
  ] = await Promise.all([
    fetchIndicator(countryCode, "SP.POP.TOTL"),
    fetchIndicator(countryCode, "EN.POP.DNST"),
    fetchIndicator(countryCode, "AG.LND.TOTL.K2"),
    fetchIndicator(countryCode, "NY.GDP.MKTP.KD"),
    fetchIndicator(countryCode, "NY.GNP.PCAP.CD"),
    fetchIndicator(countryCode, "SL.UEM.TOTL.ZS"),
    fetchIndicator(countryCode, "NY.GDP.PCAP.PP.CD"),
    fetchIndicator(countryCode, "PA.NUS.PRVT.PLI"),
    fetchIndicator(countryCode, "GOV_WGI_PV.SC"),
    fetchIndicator(countryCode, "GOV_WGI_RL.SC"),
    fetchIndicator(countryCode, "VC.IHR.PSRC.P5"),
    fetchIndicator(countryCode, "NV.AGR.TOTL.ZS"),
    fetchIndicator(countryCode, "NV.IND.TOTL.ZS"),
    fetchIndicator(countryCode, "NV.SRV.TOTL.ZS"),
    fetchIndicator(countryCode, "NY.GDP.MKTP.CD"),
    fetchIndicator(countryCode, "GC.TAX.TOTL.GD.ZS"),
    fetchIndicator(countryCode, "SP.DYN.LE00.IN"),
    fetchIndicator(countryCode, "IT.NET.USER.ZS"),
  ]);

  return {
    population: latest(population),
    populationDensityPerKm2: latest(density),
    populationTrend5yrPct: pctChange(population),
    landAreaKm2: latest(landArea),
    gdpGrowth5yrPct: pctChange(gdpLevel),
    gniPerCapitaUsd: latest(gni),
    unemploymentRatePct: latest(unemployment),
    purchasingPowerParityGdpPerCapita: latest(ppp),
    priceLevelIndex: latest(priceLevel),
    politicalStabilityScore: latest(politicalStability),
    ruleOfLawScore: latest(ruleOfLaw),
    politicalStabilityTrend: trendFromPctChange(pctChange(politicalStability)),
    homicideRatePer100k: latest(homicideRate),
    gdpSectorRanking: rankGdpSectors(latest(agriculture), latest(industry), latest(services)),
    gdpCurrentUsd: latest(gdpCurrent),
    taxRevenuePctGdp: latest(taxRevenue),
    lifeExpectancyYears: latest(lifeExpectancy),
    internetUsersPct: latest(internetUsers),
  };
}

interface WBBulkRow {
  countryiso3code: string;
  value: number | null;
}

/** GDP world ranking (1 = largest economy) - one bulk World Bank request
 *  for every country's GDP at once, not 190+ individual calls. Verified
 *  live 2026-09-25: 248ms, 214 real countries after filtering out
 *  aggregate regions World Bank mixes into this same endpoint (see
 *  REAL_ISO3_CODES's comment) - top of the list matched known reality
 *  (US #1 ~$30.8tn, China #2 ~$19.5tn, ..., UK #5 ~$4.0tn). Callers should
 *  wrap this in memoize() with a shared key (see aggregate.ts) - it's the
 *  same result for every city, no reason to refetch per-country. */
export async function getGdpWorldRanking(): Promise<Map<string, number>> {
  const url = `${BASE}/country/all/indicator/NY.GDP.MKTP.CD?format=json&per_page=20000&mrnev=1`;
  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`World Bank bulk GDP request failed: ${res.status}`);
  const json = await res.json();
  const rows: WBBulkRow[] = json?.[1] ?? [];

  const ranked = rows
    .filter((r) => r.value != null && REAL_ISO3_CODES.has(r.countryiso3code))
    .sort((a, b) => (b.value as number) - (a.value as number));

  const rankByIso3 = new Map<string, number>();
  ranked.forEach((row, i) => rankByIso3.set(row.countryiso3code, i + 1));
  return rankByIso3;
}
