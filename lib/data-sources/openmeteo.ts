/**
 * Open-Meteo — free, no key required.
 * Uses the historical Archive API over the trailing 365 days to derive
 * annual temperature / rainfall / sunshine / snowfall averages.
 * Docs: https://open-meteo.com/en/docs/historical-weather-api
 */

import { fetchWithTimeout } from "./fetchWithTimeout";

export interface ClimateAverages {
  avgAnnualTemperatureC: number;
  avgAnnualRainfallMm: number;
  avgAnnualSunshineHrs: number;
  avgAnnualSnowfallCm: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function getClimateAverages(lat: number, lng: number): Promise<ClimateAverages> {
  const start = isoDaysAgo(370);
  const end = isoDaysAgo(5); // archive has a few days' lag
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
    `&start_date=${start}&end_date=${end}` +
    `&daily=temperature_2m_mean,precipitation_sum,sunshine_duration,snowfall_sum` +
    `&timezone=auto`;

  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`);
  const json = await res.json();
  const daily = json?.daily;
  if (!daily) throw new Error("Open-Meteo response missing daily data");

  const temps: number[] = (daily.temperature_2m_mean ?? []).filter((v: number | null) => v !== null);
  const precip: number[] = daily.precipitation_sum ?? [];
  const sunshineSeconds: number[] = daily.sunshine_duration ?? [];
  const snowfall: number[] = daily.snowfall_sum ?? [];

  const avgTemp = temps.reduce((a, b) => a + b, 0) / (temps.length || 1);
  const totalRain = precip.reduce((a: number, b: number) => a + (b ?? 0), 0);
  const totalSunshineHrs = sunshineSeconds.reduce((a: number, b: number) => a + (b ?? 0), 0) / 3600;
  const totalSnowCm = snowfall.reduce((a: number, b: number) => a + (b ?? 0), 0) * 100; // metres -> cm

  return {
    avgAnnualTemperatureC: Number(avgTemp.toFixed(1)),
    avgAnnualRainfallMm: Math.round(totalRain),
    avgAnnualSunshineHrs: Math.round(totalSunshineHrs),
    avgAnnualSnowfallCm: Math.round(totalSnowCm),
  };
}
