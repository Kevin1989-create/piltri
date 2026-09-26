/**
 * Country languages from GeoNames' countryInfo.txt "Languages" column
 * (first = most widely spoken), resolved to English names with an
 * ISO 639 table and baked into pipeline/static/country-languages.json.
 * Covers 249 countries; only mostWidelySpokenLanguage is shown in the UI.
 */

import countryLanguages from "../static/country-languages.json";

export interface CountryLanguagesInfo {
  officialLanguages: string[];
  mostWidelySpokenLanguage: string;
}

const DATA: Record<string, CountryLanguagesInfo> = countryLanguages;

export function getCountryLanguages(countryCode: string): CountryLanguagesInfo {
  return DATA[countryCode.toUpperCase()] ?? { officialLanguages: [], mostWidelySpokenLanguage: "Unknown" };
}
