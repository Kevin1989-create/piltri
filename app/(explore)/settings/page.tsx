"use client";

import { SegmentedControl, SettingRow, SettingsLayout, SettingsSection } from "@/components/explore/SettingsLayout";
import { UnitPreferencesEditor } from "@/components/explore/UnitPreferencesEditor";
import { WeightEditor } from "@/components/explore/WeightEditor";
import { isCustomWeights, useScoreWeights } from "@/lib/scoreWeights";
import { useUnitPreferences } from "@/lib/unitPreferences";

/**
 * Settings (/settings), from the home page and a city page (whose id
 * arrives as `from`, so Back returns there): how much each section counts
 * in the Piltri score (lib/scoreWeights.ts - its own page until
 * 2026-10-14), how figures are shown (currency, temperature, measurement -
 * lib/unitPreferences.ts) and the site's language. Saved as you change
 * them.
 *
 * Language: the site is English only for now, so it just shows English
 * (no explanatory lines, on request). A real language switch needs the
 * interface text translated first.
 */
export default function SettingsPage() {
  const { prefs, setPrefs } = useUnitPreferences();
  const { weights, setWeights, resetWeights } = useScoreWeights();
  const customised = isCustomWeights(weights);

  return (
    <SettingsLayout title="Settings">
      <SettingsSection
        title="Piltri score: weight of each section"
        footer={
          <div className="flex justify-end">
            {customised ? (
              <button onClick={resetWeights} className="text-xs text-ink-500 hover:text-piltri-amber underline underline-offset-2">
                Reset to default weighting
              </button>
            ) : (
              <p className="text-xs text-ink-300">Default weighting</p>
            )}
          </div>
        }
      >
        <WeightEditor weights={weights} onChange={setWeights} />
      </SettingsSection>

      <SettingsSection title="Units & currency">
        <UnitPreferencesEditor prefs={prefs} onChange={setPrefs} />
      </SettingsSection>

      <SettingsSection title="Language">
        <SettingRow label="Site language">
          <SegmentedControl options={["en"]} value="en" labels={{ en: "English" }} onSelect={() => {}} />
        </SettingRow>
      </SettingsSection>
    </SettingsLayout>
  );
}
