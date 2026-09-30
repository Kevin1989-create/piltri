/**
 * Every page address in one place (2026-09-30 clean-up: flat addresses, no
 * /explore prefix, and a city named by its id alone - /city?id=lyon-fr
 * instead of seven parameters). The older /explore/... addresses redirect
 * to these (next.config.js), and each page still reads an older link's
 * parameters (readCityRef) before tidying the address.
 *
 *   /                      home: search
 *   /city?id=…             a city's score, map and sections
 *   /report?id=…           a city's full data (printable)
 *   /compare?id=…&id=…     places side by side
 *   /search                Advanced search; /search/results?scope=…&filters=…
 *   /country?code=FR       a country's full data (from Advanced search)
 *   /settings              units and language
 *   /score-settings        section weights
 *   /sources               data sources
 *
 * `from=<city id>` on Advanced search, Score settings and Sources is only
 * there so their Back link can return to that city.
 */

function withQuery(path: string, query: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) qs.set(key, value);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export const HOME_URL = "/";
export const SETTINGS_URL = "/settings";

export const cityUrl = (id: string) => withQuery("/city", { id });
export const reportUrl = (id: string) => withQuery("/report", { id });
export const countryUrl = (code: string) => withQuery("/country", { code });
export const searchUrl = (from?: string | null) => withQuery("/search", { from });
export const scoreSettingsUrl = (from?: string | null) => withQuery("/score-settings", { from });
export const sourcesUrl = (from?: string | null) => withQuery("/sources", { from });

export function compareUrl(ids: string[]): string {
  const qs = new URLSearchParams();
  for (const id of ids) qs.append("id", id);
  return `/compare?${qs.toString()}`;
}

/** "lyon-fr" -> "FR": a city id ends in its country code (cityIdFor). */
export function countryCodeOfCityId(id: string): string {
  return id.slice(id.lastIndexOf("-") + 1).toUpperCase();
}

/** Which city a page is about: `id`, or an older link's cityId, with its
 *  countryCode / lat / lng (used to find the nearest city when an old id
 *  no longer matches). Null when neither is there. `legacy` says the
 *  address is an old one, so the page can swap in the clean one. */
export interface CityRef {
  id: string | null;
  countryCode: string;
  lat: number | null;
  lng: number | null;
  legacy: boolean;
}

export function readCityRef(params: URLSearchParams): CityRef | null {
  const id = params.get("id");
  if (id) return { id, countryCode: countryCodeOfCityId(id), lat: null, lng: null, legacy: false };
  const cityId = params.get("cityId") || null;
  const lat = params.get("lat") ? Number(params.get("lat")) : NaN;
  const lng = params.get("lng") ? Number(params.get("lng")) : NaN;
  const countryCode = (params.get("countryCode") || (cityId ? countryCodeOfCityId(cityId) : "")).toUpperCase();
  const hasPoint = !Number.isNaN(lat) && !Number.isNaN(lng);
  if (!countryCode || (!cityId && !hasPoint)) return null;
  return { id: cityId, countryCode, lat: hasPoint ? lat : null, lng: hasPoint ? lng : null, legacy: true };
}

/** The city a Back link should return to: `from`, or an older link's cityId. */
export function readFrom(params: URLSearchParams): string | null {
  return params.get("from") || params.get("cityId") || null;
}
