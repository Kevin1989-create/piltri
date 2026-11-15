/**
 * Each country's largest religious group - "No religion" where that's the
 * largest - from the CIA World Factbook (public domain), refreshed by hand
 * with scripts/build-main-religion.mjs into pipeline/static/main-religion.json
 * (2026-11-14, owner: "in demographic country, can we add a field for main
 * religion"). France's overseas departments and a few territories the
 * Factbook doesn't list on their own have none - France's figure would be
 * wrong for Mayotte, for one.
 */

import mainReligionJson from "../static/main-religion.json";

export interface MainReligion {
  name: string;
  /** Its share of the population, % (null when the Factbook gives none). */
  pct: number | null;
  /** The year of the Factbook's estimate. */
  year: string | null;
}

const MAIN_RELIGION = mainReligionJson as Record<string, MainReligion>;

export const MAIN_RELIGION_SOURCE = "CIA World Factbook, religions - the largest group, latest estimate (public domain)";

export function getMainReligion(countryCode: string): MainReligion | null {
  return MAIN_RELIGION[countryCode.toUpperCase()] ?? null;
}
