/**
 * Country median age — from the UN Population Division's World Population
 * Prospects 2024 (medium variant), the "Demographic Indicators" bulk CSV:
 * https://population.un.org/wpp/downloads (free, no login, no API key -
 * the Data Portal API's live query endpoints require a bearer token, which
 * would break this project's "no keys anywhere" rule, so this bakes the
 * one column actually needed (MedianAgePop, Time=2024, real countries
 * only - UN's regional aggregate rows excluded) into a static JSON the
 * same way data/static/country-languages.json bakes down GeoNames'
 * countryInfo.txt. Generated via a one-off script (not committed, same
 * pattern as discover-cities.json/country-languages.json).
 *
 * Added 2026-09-22 to replace `averageAge` / `medianAgeProxy`, which had
 * no real source at all before this - World Bank doesn't publish median
 * age directly, so the field was hardcoded to 38 for every single city,
 * unconditionally. Covers 233 countries/territories; on this project's
 * ~171-country shortlist that's 168 - missing only Taiwan, Hong Kong and
 * Macau, which UN's dataset reports as part of China rather than
 * separately (a political/statistical choice on UN's part, not a gap in
 * this file).
 */

import countryMedianAge from "@/data/static/country-median-age.json";

const DATA: Record<string, number> = countryMedianAge;

export function getCountryMedianAge(countryCode: string): number | null {
  return DATA[countryCode.toUpperCase()] ?? null;
}
