"use client";

import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { UnitPreferencesEditor } from "@/components/explore/UnitPreferencesEditor";
import { useUnitPreferences } from "@/lib/unitPreferences";

/**
 * Settings, reached from the landing page: how figures are shown (currency,
 * temperature, measurement - lib/unitPreferences.ts) and the site's
 * language. Saved as you change them. The score weighting has its own page,
 * /explore/score-settings, reached from a city's results (2026-09-30, on
 * request).
 *
 * Language: the site is English only for now, so this says so and points
 * to the browser's own translate option, which works on every page at no
 * cost. A real language switch needs the interface text translated first.
 */
export default function SettingsPage() {
  const { prefs, setPrefs } = useUnitPreferences();

  return (
    <main className="min-h-dvh flex flex-col">
      <NavBar logoSide="left" border={false} />

      <div className="px-6 pt-8">
        <div className="max-w-xl mx-auto">
          <Link href="/explore" className="text-xs text-ink-500 hover:text-ink-900">
            ← Back to Explore
          </Link>
          <h1 className="font-serif text-2xl text-ink-900 mt-1">Settings</h1>
          <p className="text-sm text-ink-500 mt-1">How figures are shown across Piltri; saved automatically as you change them.</p>
        </div>
      </div>

      {/* Same placement as Score settings: the block sits a little above
       *  the middle of the remaining height. */}
      <div className="flex-1 flex flex-col justify-center px-6 pt-6 pb-24">
        <div className="max-w-xl mx-auto w-full">
          <h2 className="text-sm font-medium text-ink-900 mb-4">Units &amp; currency</h2>
          <UnitPreferencesEditor prefs={prefs} onChange={setPrefs} />

          <div className="mt-10 pt-6 border-t border-surface-border">
            <h2 className="text-sm font-medium text-ink-900 mb-4">Language</h2>
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-700 w-36 flex-shrink-0">Site language</span>
              <span className="rounded-pill bg-piltri-amber text-white text-xs px-4 py-1.5">English</span>
            </div>
            <p className="mt-3 text-xs text-ink-500 leading-relaxed">
              Piltri is in English for now; more languages are on the way. Meanwhile, your browser&apos;s translate option
              works on every page.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
