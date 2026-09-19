/**
 * World Bank Open Data API — free, no key required.
 * Docs: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
 *
 * World Bank data is country-level, not city-level. Per the locked data
 * model this is intentional — Demographics/Economy fields represent the
 * country the city sits in.
 */

import { fetchWithTimeout } from "./fetchWithTimeout";

const BASE = "https://api.worldbank.org/v2";

interface WBObservation {
  date: string;
  value: number | null;
}

async function fetchIndicator(countryCode: string, indicator: string, years = 6): Promise<WBObservation[]> {
  const url = `${BASE}/country/${countryCode}/indicator/${indicator}?format=json&per_page=${years}&mrnev=${years}`;
  const res = await fetchWithTimeout(url, { next: { revalidate: 60 * 60 * 24 } });
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

export interface WorldBankIndicators {
  population: number | null;
  populationDensityPerKm2: number | null;
  populationTrend5yrPct: number | null;
  medianAgeProxy: number | null; // WB doesn't expose median age directly; treated as a proxy
  gdpGrowth5yrPct: number | null;
  gniPerCapitaUsd: number | null; // used as average salary proxy
  unemploymentRatePct: number | null;
  purchasingPowerParityGdpPerCapita: number | null;
}

/**
 * Pulls the World Bank indicators that feed Demographics + Economy sections.
 * Indicator codes: https://data.worldbank.org/indicator
 */
export async function getWorldBankIndicators(countryCode: string): Promise<WorldBankIndicators> {
  const [population, density, gdpGrowth, gni, unemployment, ppp] = await Promise.all([
    fetchIndicator(countryCode, "SP.POP.TOTL"),
    fetchIndicator(countryCode, "EN.POP.DNST"),
    fetchIndicator(countryCode, "NY.GDP.MKTP.KD.ZG"),
    fetchIndicator(countryCode, "NY.GNP.PCAP.CD"),
    fetchIndicator(countryCode, "SL.UEM.TOTL.ZS"),
    fetchIndicator(countryCode, "NY.GDP.PCAP.PP.CD"),
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
  };
}
