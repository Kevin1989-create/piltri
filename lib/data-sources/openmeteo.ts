/**
 * Open-Meteo — free, no key required.
 * Uses the historical Archive API over the trailing 365 days to derive
 * annual temperature / rainfall / sunshine / snowfall averages.
 * Docs: https://open-meteo.com/en/docs/historical-weather-api
 */

import { fetchWithTimeout } from "./fetchWithTimeout";
import { classifyKoppen } from "./koppen";

export interface ClimateAverages {
  avgAnnualTemperatureC: number;
  avgAnnualRainfallMm: number;
  avgAnnualSunshineHrs: number;
  avgAnnualSnowfallCm: number;
}

/** Buckets daily values by calendar month (Jan=0) and averages
 *  (temperature) or sums (precipitation) each bucket - Köppen
 *  classification needs monthly figures, not a daily series or an annual
 *  total. */
function monthlyBuckets(dates: string[], values: (number | null)[], reducer: "mean" | "sum"): (number | null)[] {
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  dates.forEach((date, i) => {
    const v = values[i];
    if (v == null) return;
    const month = Number(date.slice(5, 7)) - 1;
    if (month >= 0 && month < 12) buckets[month].push(v);
  });
  return buckets.map((vals) => {
    if (vals.length === 0) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return reducer === "mean" ? sum / vals.length : sum;
  });
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

// Deliberately a separate call from getClimateAverages above, on a much
// wider date range - Köppen classification is meant to run on long-term
// climate normals, not one year's actual weather, and a single year
// produces real, wrong misclassifications at the margins (tested live:
// London -> "Csa" instead of "Cfb", Phoenix -> "BSh" instead of "BWh" on a
// 1-year window; both corrected with 10 years). 10 years is a genuine
// tradeoff, not an arbitrary constant - shorter reintroduces single-year
// noise, and Open-Meteo's archive only goes back reliably so far; measured
// live at ~0.3s/83KB for a 10-year daily pull, so this isn't a latency
// concern on its own.
const KOPPEN_YEARS = 10;

export async function getKoppenClimateType(lat: number, lng: number): Promise<string | null> {
  const start = isoDaysAgo(365 * KOPPEN_YEARS + 5);
  const end = isoDaysAgo(5);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
    `&start_date=${start}&end_date=${end}` +
    `&daily=temperature_2m_mean,precipitation_sum` +
    `&timezone=auto`;

  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`);
  const json = await res.json();
  const daily = json?.daily;
  if (!daily) throw new Error("Open-Meteo response missing daily data");

  const dates: string[] = daily.time ?? [];
  const dailyTemps: (number | null)[] = daily.temperature_2m_mean ?? [];
  const dailyPrecip: (number | null)[] = daily.precipitation_sum ?? [];

  const years = dates.length / 365.25;
  const monthlyTemps = monthlyBuckets(dates, dailyTemps, "mean");
  // Precipitation buckets sum every day across all 10 years, not average -
  // divide by the real year count to get a typical single year's monthly
  // total, which is what the classification formula expects.
  const monthlyPrecip = monthlyBuckets(dates, dailyPrecip, "sum").map((v) => (v == null ? null : v / years));

  return classifyKoppen(monthlyTemps, monthlyPrecip, lat);
}
