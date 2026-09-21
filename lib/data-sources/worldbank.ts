/**
 * World Bank Open Data API — free, no key required.
 * Docs: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
 *
 * World Bank data is country-level, not city-level. Per the locked data
 * model this is intentional — Demographics/Economy/Safety fields represent
 * the country the city sits in.
 */

import { fetchWithTimeout } from "./fetchWithTimeout";
import type { TrendDirection } from "@/lib/types";

const BASE = "https://api.worldbank.org/v2";

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
  medianAgeProxy: number | null; // WB doesn't expose median age directly; treated as a proxy
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
}

/**
 * Pulls the World Bank indicators that feed Demographics + Economy +
 * Safety & Stability. Indicator codes: https://data.worldbank.org/indicator
 * (governance indicators specifically live under source=3, "Worldwide
 * Governance Indicators" — verified via https://api.worldbank.org/v2/sources).
 */
export async function getWorldBankIndicators(countryCode: string): Promise<WorldBankIndicators> {
  const [population, density, gdpGrowth, gni, unemployment, ppp, priceLevel, politicalStability, ruleOfLaw] = await Promise.all([
    fetchIndicator(countryCode, "SP.POP.TOTL"),
    fetchIndicator(countryCode, "EN.POP.DNST"),
    fetchIndicator(countryCode, "NY.GDP.MKTP.KD.ZG"),
    fetchIndicator(countryCode, "NY.GNP.PCAP.CD"),
    fetchIndicator(countryCode, "SL.UEM.TOTL.ZS"),
    fetchIndicator(countryCode, "NY.GDP.PCAP.PP.CD"),
    fetchIndicator(countryCode, "PA.NUS.PRVT.PLI"),
    fetchIndicator(countryCode, "GOV_WGI_PV.SC"),
    fetchIndicator(countryCode, "GOV_WGI_RL.SC"),
  ]);

  return {
    population: latest(population),
    populationDensityPerKm2: latest(density),
    populationTrend5yrPct: pctChange(population),
    medianAgeProxy: null, // no direct WB indicator; left null unless overridden upstream
    gdpGrowth5yrPct: pctChange(gdpGrowth) ?? latest(gdpGrowth),
    gniPerCapitaUsd: latest(gni),
    unemploymentRatePct: latest(unemployment),
    purchasingPowerParityGdpPerCapita: latest(ppp),
    priceLevelIndex: latest(priceLevel),
    politicalStabilityScore: latest(politicalStability),
    ruleOfLawScore: latest(ruleOfLaw),
    politicalStabilityTrend: trendFromPctChange(pctChange(politicalStability)),
  };
}
