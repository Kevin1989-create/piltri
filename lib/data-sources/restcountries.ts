/**
 * REST Countries API — free, no key required.
 * Docs: https://restcountries.com/
 */

import { fetchWithTimeout } from "./fetchWithTimeout";

export interface RestCountriesInfo {
  officialLanguages: string[];
  mostWidelySpokenLanguage: string;
}

export async function getCountryLanguages(countryCode: string): Promise<RestCountriesInfo> {
  const url = `https://restcountries.com/v3.1/alpha/${countryCode}?fields=languages`;
  const res = await fetchWithTimeout(url, { next: { revalidate: 60 * 60 * 24 * 30 } });
  if (!res.ok) throw new Error(`REST Countries request failed: ${res.status}`);
  const json = await res.json();
  const languages: string[] = Object.values(json?.languages ?? {});
  return {
    officialLanguages: languages,
    // REST Countries doesn't rank by speaker count — first listed is used as
    // a reasonable default; override manually for edge cases if needed.
    mostWidelySpokenLanguage: languages[0] ?? "Unknown",
  };
}
