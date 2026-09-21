/**
 * Country official/primary languages — from GeoNames' countryInfo.txt
 * (https://download.geonames.org/export/dump/countryInfo.txt), the same
 * free, keyless, public-domain-licensed dataset already used to build
 * data/static/discover-cities.json (see HANDOFF.md). Its "Languages"
 * column lists each country's language codes in order, first = most
 * widely spoken/official - resolved to English names via a static
 * ISO 639 lookup table at build time (see the generator notes below).
 *
 * This used to call the free REST Countries API (v3.1) directly at
 * request time. That API was fully sunset - as of testing this in
 * production, every v1-v4 request now returns HTTP 200 with a body like
 * `{ "success": false, "data": null, "errors": [...] }` instead of an
 * error status, so the old code's `!res.ok` check never caught it: it
 * silently parsed an empty `languages` object and returned
 * `{ officialLanguages: [], mostWidelySpokenLanguage: "Unknown" }` for
 * every single city. The replacement (v5) requires a free account and an
 * API key, which breaks this project's "no keys anywhere" design - so
 * this switched to a source that's still genuinely keyless.
 *
 * data/static/country-languages.json is generated (not fetched live) via
 * a one-off script - fetch countryInfo.txt, split its Languages column,
 * map each base language code through a hand-built ISO 639-1 (plus a
 * handful of ISO 639-3) name table, one JSON object keyed by ISO alpha-2
 * country code. Covers 249 countries. Every code that is ever the FIRST
 * (most-widely-spoken) language for some country is mapped to a real
 * name; a handful of rare secondary/tertiary language codes deep in some
 * countries' full list (e.g. minority languages in India, France, the
 * Philippines) fall back to their raw code since they're not otherwise
 * used - officialLanguages isn't rendered anywhere in the UI today, only
 * mostWidelySpokenLanguage is, and that one is always a real name.
 */

import countryLanguages from "@/data/static/country-languages.json";

export interface CountryLanguagesInfo {
  officialLanguages: string[];
  mostWidelySpokenLanguage: string;
}

const DATA: Record<string, CountryLanguagesInfo> = countryLanguages;

export async function getCountryLanguages(countryCode: string): Promise<CountryLanguagesInfo> {
  const entry = DATA[countryCode.toUpperCase()];
  return entry ?? { officialLanguages: [], mostWidelySpokenLanguage: "Unknown" };
}
