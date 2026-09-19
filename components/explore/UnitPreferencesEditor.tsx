"use client";

import { cn } from "@/lib/cn";
import {
  CURRENCY_LABEL,
  DISTANCE_LABEL,
  TEMPERATURE_LABEL,
  type CurrencyCode,
  type DistanceUnit,
  type TemperatureUnit,
  type UnitPreferences,
} from "@/lib/unitPreferences";

interface UnitPreferencesEditorProps {
  prefs: UnitPreferences;
  onChange: (next: UnitPreferences) => void;
}

const CURRENCY_OPTIONS: CurrencyCode[] = ["GBP", "USD", "EUR"];
const TEMPERATURE_OPTIONS: TemperatureUnit[] = ["C", "F"];
const DISTANCE_OPTIONS: DistanceUnit[] = ["metric", "imperial"];

function PillGroup<T extends string>({
  options,
  value,
  labels,
  onSelect,
}: {
  options: T[];
  value: T;
  labels: Record<T, string>;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex items-center rounded-pill border border-surface-border overflow-hidden text-xs">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onSelect(opt)}
          className={cn(
            "w-16 py-1.5 text-center transition-colors",
            opt === value ? "bg-piltri-amber text-white" : "bg-surface text-ink-500 hover:bg-surface-muted"
          )}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

/** Currency / temperature / distance display-unit picker — saved
 *  automatically, same pattern as the score-weight sliders above it on the
 *  /explore/weights page. Only changes how values are *shown*; see
 *  lib/unitPreferences.ts for the disclosed limitation around Advanced
 *  search's filter inputs, which stay in the base units (GBP/°C/km²). */
export function UnitPreferencesEditor({ prefs, onChange }: UnitPreferencesEditorProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-700 w-36 flex-shrink-0">Currency</span>
        <PillGroup
          options={CURRENCY_OPTIONS}
          value={prefs.currency}
          labels={CURRENCY_LABEL}
          onSelect={(currency) => onChange({ ...prefs, currency })}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-700 w-36 flex-shrink-0">Temperature</span>
        <PillGroup
          options={TEMPERATURE_OPTIONS}
          value={prefs.temperature}
          labels={TEMPERATURE_LABEL}
          onSelect={(temperature) => onChange({ ...prefs, temperature })}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-700 w-36 flex-shrink-0">Measurement</span>
        <PillGroup
          options={DISTANCE_OPTIONS}
          value={prefs.distance}
          labels={DISTANCE_LABEL}
          onSelect={(distance) => onChange({ ...prefs, distance })}
        />
      </div>
    </div>
  );
}
