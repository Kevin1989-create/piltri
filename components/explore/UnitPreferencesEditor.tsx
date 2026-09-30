"use client";

import { SegmentedControl, SettingRow } from "@/components/explore/SettingsLayout";
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

/** Currency / temperature / distance display-unit picker — saved
 *  automatically, same pattern as the score-weight sliders on
 *  /score-settings; shown on the /settings page, as rows of a
 *  SettingsSection. Only changes how values are *shown*; see
 *  lib/unitPreferences.ts for the disclosed limitation around Advanced
 *  search's filter inputs, which stay in the base units (GBP/°C/km²). */
export function UnitPreferencesEditor({ prefs, onChange }: UnitPreferencesEditorProps) {
  return (
    <>
      <SettingRow label="Currency">
        <SegmentedControl
          options={CURRENCY_OPTIONS}
          value={prefs.currency}
          labels={CURRENCY_LABEL}
          onSelect={(currency) => onChange({ ...prefs, currency })}
        />
      </SettingRow>
      <SettingRow label="Temperature">
        <SegmentedControl
          options={TEMPERATURE_OPTIONS}
          value={prefs.temperature}
          labels={TEMPERATURE_LABEL}
          onSelect={(temperature) => onChange({ ...prefs, temperature })}
        />
      </SettingRow>
      <SettingRow label="Measurement">
        <SegmentedControl
          options={DISTANCE_OPTIONS}
          value={prefs.distance}
          labels={DISTANCE_LABEL}
          onSelect={(distance) => onChange({ ...prefs, distance })}
        />
      </SettingRow>
    </>
  );
}
