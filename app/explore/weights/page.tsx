"use client";

import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { WeightEditor } from "@/components/explore/WeightEditor";
import { UnitPreferencesEditor } from "@/components/explore/UnitPreferencesEditor";
import { useScoreWeights, isCustomWeights } from "@/lib/scoreWeights";
import { useUnitPreferences } from "@/lib/unitPreferences";

/**
 * Dedicated page for the persisted score-weight preference (lib/scoreWeights.ts).
 * Deliberately separate from Discover mode's filters — this is "how should
 * the Piltri Score be calculated," not "which cities match my criteria."
 * Saved as you adjust each slider, no separate save step.
 */
export default function ScoreWeightsPage() {
  const { weights, setWeights, resetWeights } = useScoreWeights();
  const customised = isCustomWeights(weights);
  const { prefs, setPrefs } = useUnitPreferences();

  return (
    <main className="min-h-screen flex flex-col">
      <NavBar logoSide="left" border={false} />

      <div className="px-6 pt-8">
        <div className="max-w-xl mx-auto">
          <Link href="/explore" className="text-xs text-ink-500 hover:text-ink-900">
            ← Back to Explore
          </Link>
          <h1 className="font-serif text-2xl text-ink-900 mt-1">Customise score settings</h1>
          <p className="text-sm text-ink-500 mt-1">
            Choose how much each section counts toward the overall Piltri Score ; saved automatically as you adjust it.
          </p>
        </div>
      </div>

      {/* flex-1 + justify-center: lets this block sit in the middle of the
       *  remaining page height rather than clinging to the top. Padding is
       *  intentionally asymmetric (more bottom than top) so the visual
       *  centre sits a little above dead-centre rather than perfectly
       *  mid-page. */}
      <div className="flex-1 flex flex-col justify-center px-6 pt-6 pb-24">
        <div className="max-w-xl mx-auto w-full">
          <WeightEditor weights={weights} onChange={setWeights} />

          <div className="mt-4 flex items-center gap-3">
            {customised ? (
              <button
                onClick={resetWeights}
                className="text-sm text-ink-500 hover:text-piltri-amber underline underline-offset-2"
              >
                Reset to default weighting
              </button>
            ) : (
              <p className="text-sm text-ink-300">Default weighting in place</p>
            )}
          </div>

          <div className="mt-10 pt-6 border-t border-surface-border">
            <h2 className="text-sm font-medium text-ink-900 mb-4">Units & Currency</h2>
            <UnitPreferencesEditor prefs={prefs} onChange={setPrefs} />
          </div>
        </div>
      </div>
    </main>
  );
}
