/**
 * WHO Global Health Observatory OData API — free, no key required.
 * Docs: https://www.who.int/data/gho/info/gho-odata-api
 *
 * Uses the UHC Service Coverage Index (indicator UHC_INDEX_REPORTED) as the
 * 0-100 healthcare quality score.
 */

import { fetchWithTimeout } from "./fetchWithTimeout";

export async function getHealthcareQualityScore(countryCode3: string): Promise<number | null> {
  const url = `https://ghoapi.azureedge.net/api/UHC_INDEX_REPORTED?$filter=SpatialDim eq '${countryCode3}'&$orderby=TimeDim desc&$top=1`;
  // WHO's OData API is one of the slower free sources — a shorter timeout
  // here (it's non-critical, healthcareQualityScore has a sane fallback).
  const res = await fetchWithTimeout(url, { next: { revalidate: 60 * 60 * 24 * 30 } }, 4000);
  if (!res.ok) return null;
  const json = await res.json();
  const value = json?.value?.[0]?.NumericValue;
  return value != null ? Math.round(value) : null;
}
