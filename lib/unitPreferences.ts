"use client";

import { useEffect, useState } from "react";

/**
 * Persisted display-unit preference — currency, temperature, and
 * area/density units. Same localStorage-hook pattern as lib/scoreWeights.ts
 * (single shared setting across the whole app, editable from the
 * /explore/weights page).
 *
 * Important, disclosed limitation: this only affects how values are
 * *displayed*. The underlying data is stored in GBP / Celsius / km² (see
 * lib/types.ts field names like averageSalaryGbp), and Advanced search's
 * filter inputs still operate in those base units regardless of this
 * preference — converting the filter UI too would risk a user typing a
 * number in what they assume is their chosen currency while the server
 * silently compares it against GBP-stored data. That's a bigger, separate
 * piece of work if wanted later.
 *
 * Currency conversion uses a fixed rate table, not a live FX API — good
 * enough for comparing cities against each other, not for anything needing
 * exact, up-to-the-minute rates. Update GBP_RATES below if they drift too
 * far from reality.
 */

export type CurrencyCode = "GBP" | "USD" | "EUR";
export type TemperatureUnit = "C" | "F";
export type DistanceUnit = "metric" | "imperial";

export interface UnitPreferences {
  currency: CurrencyCode;
  temperature: TemperatureUnit;
  distance: DistanceUnit;
}

const STORAGE_KEY = "piltri:unit-preferences";

export const DEFAULT_UNIT_PREFERENCES: UnitPreferences = {
  currency: "GBP",
  temperature: "C",
  distance: "metric",
};

// Fixed, approximate, last set August 2026 — not live. See module doc above.
const GBP_RATES: Record<CurrencyCode, number> = {
  GBP: 1,
  USD: 1.27,
  EUR: 1.17,
};

const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
};

// Short, fixed-width-friendly labels — deliberately terse (not "GBP (£)" /
// "Celsius (°C)") so every pill across Currency/Temperature/Measurement
// renders at the same compact size instead of the widest option (e.g. a
// spelled-out currency name) stretching its whole row wider than the others.
export const CURRENCY_LABEL: Record<CurrencyCode, string> = {
  GBP: "GBP",
  USD: "USD",
  EUR: "EUR",
};

export const TEMPERATURE_LABEL: Record<TemperatureUnit, string> = {
  C: "°C",
  F: "°F",
};

export const DISTANCE_LABEL: Record<DistanceUnit, string> = {
  metric: "Metric",
  imperial: "Imperial",
};

function readStored(): UnitPreferences {
  if (typeof window === "undefined") return DEFAULT_UNIT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UNIT_PREFERENCES;
    return { ...DEFAULT_UNIT_PREFERENCES, ...(JSON.parse(raw) as Partial<UnitPreferences>) };
  } catch {
    return DEFAULT_UNIT_PREFERENCES;
  }
}

export function getUnitPreferences(): UnitPreferences {
  return readStored();
}

export function saveUnitPreferences(prefs: UnitPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable (private browsing etc.) — preference just won't persist.
  }
}

/** React hook for reading/updating the persisted unit preference. Mirrors
 *  useScoreWeights' shape (lib/scoreWeights.ts). */
export function useUnitPreferences() {
  const [prefs, setPrefsState] = useState<UnitPreferences>(DEFAULT_UNIT_PREFERENCES);

  useEffect(() => {
    setPrefsState(readStored());
  }, []);

  function setPrefs(next: UnitPreferences) {
    setPrefsState(next);
    saveUnitPreferences(next);
  }

  return { prefs, setPrefs };
}

/** amountGbp -> formatted string in the chosen currency, e.g. "$63,500". */
export function formatCurrency(amountGbp: number, prefs: Pick<UnitPreferences, "currency">): string {
  const converted = amountGbp * GBP_RATES[prefs.currency];
  return `${CURRENCY_SYMBOL[prefs.currency]}${Math.round(converted).toLocaleString()}`;
}

/** celsius -> formatted string in the chosen temperature unit, e.g. "68°F". */
export function formatTemperature(celsius: number, prefs: Pick<UnitPreferences, "temperature">): string {
  if (prefs.temperature === "F") {
    return `${Math.round(celsius * 9 / 5 + 32)}°F`;
  }
  return `${Math.round(celsius * 10) / 10}°C`;
}

/** km² -> formatted string in the chosen distance unit, e.g. "482 sq mi". */
export function formatAreaKm2(km2: number, prefs: Pick<UnitPreferences, "distance">): string {
  if (prefs.distance === "imperial") {
    const sqMi = km2 * 0.386102;
    return `${sqMi.toLocaleString(undefined, { maximumFractionDigits: sqMi < 10 ? 1 : 0 })} sq mi`;
  }
  // maximumFractionDigits capped at 1 (2026-09-24, on request: no field
  // shows more than 1 decimal place) - a plain toLocaleString() here used
  // to pass OSM's real-valued polygon area straight through unrounded,
  // e.g. "1,589.23 km²".
  return `${km2.toLocaleString(undefined, { maximumFractionDigits: km2 < 10 ? 1 : 0 })} km²`;
}

/** Compact (abbreviated) km² -> imperial/metric string, e.g. "3.2k sq mi" /
 *  "8.9k km²" — used where space is tight (CityHeader's stat grid). */
export function formatAreaKm2Compact(km2: number, prefs: Pick<UnitPreferences, "distance">, compact: (n: number) => string): string {
  if (prefs.distance === "imperial") {
    return `${compact(km2 * 0.386102)} sq mi`;
  }
  return `${compact(km2)} km²`;
}

/** people-per-km² -> formatted string in the chosen distance unit, e.g.
 *  "1,200/sq mi" / "463/km²". */
export function formatDensityPerKm2(perKm2: number, prefs: Pick<UnitPreferences, "distance">, compact: (n: number) => string): string {
  if (prefs.distance === "imperial") {
    return `${compact(perKm2 / 0.386102)}/sq mi`;
  }
  return `${compact(perKm2)}/km²`;
}
