/**
 * Notre Dame Global Adaptation Initiative (ND-GAIN) country index,
 * refreshed with pipeline/generateClimateReadiness.mjs into
 * pipeline/static/climate-readiness.json. A country's capacity to adapt
 * to climate change - national by nature, like the governance scores.
 */

import climateReadinessJson from "../static/climate-readiness.json";

export interface ClimateReadiness {
  /** ND-GAIN composite, 0-100 - higher is more resilient and ready. */
  gainScore: number;
  readinessScore: number | null;
  vulnerabilityScore: number | null;
}

const CLIMATE_READINESS = climateReadinessJson as Record<string, ClimateReadiness>;

export function getClimateReadiness(countryCode: string): ClimateReadiness | null {
  return CLIMATE_READINESS[countryCode.toUpperCase()] ?? null;
}
