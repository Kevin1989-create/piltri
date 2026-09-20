import { SECTION_WEIGHTS, type SectionScores } from "@/lib/types";

/** Clamp any raw value into the 0-100 score range. */
export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Min-max normalise a raw metric into 0-100. `invert` flips the scale for
 * metrics where lower-is-better (e.g. unemployment rate, crime).
 */
export function normalise(value: number, min: number, max: number, invert = false): number {
  if (max === min) return 50;
  const pct = ((value - min) / (max - min)) * 100;
  const clamped = clampScore(pct);
  return invert ? 100 - clamped : clamped;
}

/** Weighted Piltri score from the 4 scored sections (Demographics is
 *  supplementary info, and Real Estate is "Coming soon" — see
 *  lib/types.ts SectionKey — neither is part of this). Uses the locked
 *  default weighting unless custom weights are passed (Discover mode
 *  filters, or the score-weights settings page). */
export function computePiltriScore(sections: SectionScores, weights: SectionScores = SECTION_WEIGHTS): number {
  const total =
    sections.economy * weights.economy +
    sections.safetyStability * weights.safetyStability +
    sections.climate * weights.climate +
    sections.liveability * weights.liveability;
  return Number(total.toFixed(1));
}

/** Fills in any missing section weights with the locked defaults, then
 *  normalises the full set so they sum to exactly 1 — lets callers pass
 *  partial or not-quite-100%-total weights (e.g. from % inputs in the UI)
 *  without the resulting score being under/over-scaled. */
export function normaliseWeights(weights: Partial<SectionScores> | undefined): SectionScores {
  const filled: SectionScores = { ...SECTION_WEIGHTS, ...weights };
  const sum = filled.economy + filled.safetyStability + filled.climate + filled.liveability;
  if (!sum || sum <= 0) return SECTION_WEIGHTS;
  return {
    economy: filled.economy / sum,
    safetyStability: filled.safetyStability / sum,
    climate: filled.climate / sum,
    liveability: filled.liveability / sum,
  };
}

/** Simple average of a list of 0-100 sub-scores — used within each section. */
export function averageScores(scores: (number | null | undefined)[]): number {
  const valid = scores.filter((s): s is number => s != null && !Number.isNaN(s));
  if (valid.length === 0) return 50; // neutral default when no data available yet
  return Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1));
}
