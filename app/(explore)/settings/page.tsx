"use client";

import { SegmentedControl, SettingRow, SettingsLayout, SettingsSection } from "@/components/explore/SettingsLayout";
import { UnitPreferencesEditor } from "@/components/explore/UnitPreferencesEditor";
import { useUnitPreferences } from "@/lib/unitPreferences";

/**
 * Settings (/settings), reached from the home page: how figures are shown
 * (currency, temperature, measurement - lib/unitPreferences.ts) and the
 * site's language. Saved as you change them. The score weighting has its
 * own page, /score-settings, reached from a city page (2026-09-30, on
 * request).
 *
 * Language: the site is English only for now, so it just shows English
 * (no explanatory lines, on request). A real language switch needs the
 * interface text translated first.
 */
export default function SettingsPage() {
  const { prefs, setPrefs } = useUnitPreferences();

  return (
    <SettingsLayout title="Settings">
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
