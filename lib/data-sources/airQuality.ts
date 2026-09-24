/**
 * Open-Meteo Air Quality — free, no key required, same provider family as
 * openmeteo.ts's weather archive but a separate host/dataset (CAMS
 * atmospheric composition reanalysis, not weather reanalysis). Verified
 * live 2026-09-24 for global coverage (London, remote Pacific Nauru,
 * McMurdo Station/Antarctica all returned real data) and a full 1-year
 * historical window.
 * Docs: https://open-meteo.com/en/docs/air-quality-api
 */

import { fetchWithTimeout } from "./fetchWithTimeout";

export interface AirQualityAverages {
  /** PM2.5 (fine particulate matter), µg/m³ - the standard WHO-referenced
   *  air quality metric. Hourly reanalysis averaged across the trailing
   *  365 days (no daily-aggregation endpoint for this variable - unlike
   *  the weather archive, computed from the raw hourly series here). */
  avgAnnualPm25: number;
  /** Average of each day's maximum UV index over the trailing 365 days -
   *  a daily max, not a raw hourly average, since night-time zeros would
   *  otherwise dilute it into a meaningless number. */
  avgAnnualUvIndexMax: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function getAirQualityAverages(lat: number, lng: number): Promise<AirQualityAverages> {
  const start = isoDaysAgo(370);
  const end = isoDaysAgo(5);
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}` +
    `&start_date=${start}&end_date=${end}` +
    `&hourly=pm2_5&daily=uv_index_max&timezone=auto`;

  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo Air Quality request failed: ${res.status}`);
  const json = await res.json();

  const pm25: number[] = (json?.hourly?.pm2_5 ?? []).filter((v: number | null) => v !== null);
  const uvMax: number[] = (json?.daily?.uv_index_max ?? []).filter((v: number | null) => v !== null);
  if (pm25.length === 0 || uvMax.length === 0) throw new Error("Open-Meteo Air Quality response missing data");

  const avgPm25 = pm25.reduce((a, b) => a + b, 0) / pm25.length;
  const avgUvMax = uvMax.reduce((a, b) => a + b, 0) / uvMax.length;

  return {
    avgAnnualPm25: Number(avgPm25.toFixed(1)),
    avgAnnualUvIndexMax: Number(avgUvMax.toFixed(1)),
  };
}
