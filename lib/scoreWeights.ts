"use client";

import { useEffect, useState } from "react";
import { SECTION_WEIGHTS, type SectionKey, type SectionScores } from "@/lib/types";

const STORAGE_KEY = "piltri:score-weights";
const SECTION_KEY_ORDER = Object.keys(SECTION_WEIGHTS) as SectionKey[];

/** Default weights as whole percentages — the UI works in whole percent,
 *  converted to fractions only when actually computing a score. Single
 *  source of truth — Discover mode, the results page, and the dedicated
 *  weights page all import this. */
export const DEFAULT_WEIGHT_PERCENTAGES: Record<SectionKey, number> = SECTION_KEY_ORDER.reduce(
  (acc, key) => ({ ...acc, [key]: Math.round(SECTION_WEIGHTS[key] * 100) }),
  {} as Record<SectionKey, number>
);

/** Proportionally scales weights down to sum to exactly 100 if they add up
 *  to more than that. Exists as a safety net for weights saved to
 *  localStorage before the 100%-total cap existed in the slider UI itself —
 *  without this, an old over-100 save would make every slider look "stuck"
 *  (their max is `100 - everyone else`, which comes out negative/zero when
 *  the stored total is already over budget). */
function clampToBudget(weights: Record<SectionKey, number>): Record<SectionKey, number> {
  const total = SECTION_KEY_ORDER.reduce((sum, key) => sum + (weights[key] ?? 0), 0);
  if (total <= 100) return weights;
  if (total <= 0) return DEFAULT_WEIGHT_PERCENTAGES;

  const scaled = {} as Record<SectionKey, number>;
  for (const key of SECTION_KEY_ORDER) {
    scaled[key] = Math.floor(((weights[key] ?? 0) / total) * 100);
  }
  const scaledTotal = SECTION_KEY_ORDER.reduce((sum, key) => sum + scaled[key], 0);
  const remainder = 100 - scaledTotal;
  if (remainder > 0) {
    const largestKey = SECTION_KEY_ORDER.reduce((a, b) => (scaled[b] > scaled[a] ? b : a));
    scaled[largestKey] += remainder;
  }
  return scaled;
}

function readStoredWeights(): Record<SectionKey, number> {
  if (typeof window === "undefined") return DEFAULT_WEIGHT_PERCENTAGES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WEIGHT_PERCENTAGES;
    const parsed = JSON.parse(raw) as Partial<Record<SectionKey, number>>;
    return clampToBudget({ ...DEFAULT_WEIGHT_PERCENTAGES, ...parsed });
  } catch {
    return DEFAULT_WEIGHT_PERCENTAGES;
  }
}

/** Non-reactive read — used server-side-request-time in Discover mode's
 *  search call (it doesn't need to re-render when weights change, just
 *  needs the current value at the moment the user hits "Find matching
 *  cities"). */
export function getScoreWeights(): Record<SectionKey, number> {
  return readStoredWeights();
}

export function saveScoreWeights(weights: Record<SectionKey, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clampToBudget(weights)));
  } catch {
    // Storage unavailable (private browsing etc.) — weights just won't persist.
  }
}

export function isCustomWeights(weights: Record<SectionKey, number>): boolean {
  return (Object.keys(DEFAULT_WEIGHT_PERCENTAGES) as SectionKey[]).some(
    (key) => weights[key] !== DEFAULT_WEIGHT_PERCENTAGES[key]
  );
}

/** Converts whole-percentage weights (as edited in the UI) into the
 *  SectionScores-shaped fractions computePiltriScore expects. Doesn't need
 *  to sum to exactly 1 — normaliseWeights (lib/aggregation/scoring.ts)
 *  handles that at the point of use. */
export function weightPercentagesToScores(weights: Record<SectionKey, number>): SectionScores {
  return {
    economy: weights.economy ?? DEFAULT_WEIGHT_PERCENTAGES.economy,
    safetyStability: weights.safetyStability ?? DEFAULT_WEIGHT_PERCENTAGES.safetyStability,
    climate: weights.climate ?? DEFAULT_WEIGHT_PERCENTAGES.climate,
    liveability: weights.liveability ?? DEFAULT_WEIGHT_PERCENTAGES.liveability,
  };
}

/**
 * React hook for reading/updating the persisted score-weight preference.
 * Backed by localStorage so it's a single, shared setting across the whole
 * app (the results page's score display, and Discover mode's ranking both
 * use it) rather than a value that resets every time you look at a
 * different city or reopen Discover mode.
 */
export function useScoreWeights() {
  const [weights, setWeightsState] = useState<Record<SectionKey, number>>(DEFAULT_WEIGHT_PERCENTAGES);

  useEffect(() => {
    setWeightsState(readStoredWeights());
  }, []);

  function setWeights(next: Record<SectionKey, number>) {
    const safe = clampToBudget(next);
    setWeightsState(safe);
    saveScoreWeights(safe);
  }

  function resetWeights() {
    setWeights(DEFAULT_WEIGHT_PERCENTAGES);
  }

  return { weights, setWeights, resetWeights };
}
