/**
 * Country median age - UN World Population Prospects 2024 (medium variant,
 * MedianAgePop, 2024), baked into pipeline/static/country-median-age.json.
 * Covers 233 countries/territories; Taiwan, Hong Kong and Macau are
 * reported by the UN as part of China, so they have no value here.
 */

import countryMedianAge from "../static/country-median-age.json";

const DATA: Record<string, number> = countryMedianAge;

export function getCountryMedianAge(countryCode: string): number | null {
  return DATA[countryCode.toUpperCase()] ?? null;
}
