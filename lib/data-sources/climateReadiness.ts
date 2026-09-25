/**
 * Notre Dame Global Adaptation Initiative (ND-GAIN) country index — a
 * static, static-JSON, country-level lookup, not a live API. ND-GAIN
 * publishes an annually-updated dataset, not a queryable endpoint - see
 * scripts/generateClimateReadiness.mjs for the (re-runnable) ingestion.
 *
 * Unlike every other Environment field, this is inherently country-level,
 * not a city-level gap: it measures a country's institutional/economic
 * capacity to adapt to climate change, the same category as Safety's WGI
 * governance scores - not a workaround for missing city data.
 */

import climateReadinessJson from "@/data/static/climate-readiness.json";

export interface ClimateReadiness {
  /** ND-GAIN's own composite score, 0-100 - higher means more resilient
   *  to climate change AND more ready to act on it. */
  gainScore: number;
  /** 0-1 sub-score: economic/governance/social readiness to leverage
   *  investment for adaptation. Higher is better. */
  readinessScore: number | null;
  /** 0-1 sub-score: exposure + sensitivity to climate hazards, minus
   *  adaptive capacity. Higher means MORE vulnerable (worse). */
  vulnerabilityScore: number | null;
}

const CLIMATE_READINESS = climateReadinessJson as Record<string, ClimateReadiness>;

export function getClimateReadiness(countryCode: string): ClimateReadiness | null {
  return CLIMATE_READINESS[countryCode.toUpperCase()] ?? null;
}
