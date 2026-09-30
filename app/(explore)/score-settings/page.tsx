"use client";

import { SettingsLayout, SettingsSection } from "@/components/explore/SettingsLayout";
import { WeightEditor } from "@/components/explore/WeightEditor";
import { useScoreWeights, isCustomWeights } from "@/lib/scoreWeights";

/**
 * Score settings (/score-settings): the persisted score-weight preference
 * (lib/scoreWeights.ts), reached from a city page - whose id arrives as
 * `from`, so Back returns there. Deliberately separate from Advanced
 * search's filters — this is "how should the Piltri Score be calculated,"
 * not "which cities match my criteria." Saved as you adjust each slider,
 * no separate save step. Display units and language live on /settings.
 */
export default function ScoreSettingsPage() {
  const { weights, setWeights, resetWeights } = useScoreWeights();
  const customised = isCustomWeights(weights);

  return (
    <SettingsLayout title="Score settings">
      <SettingsSection
        title="Weight of each section"
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
    </SettingsLayout>
  );
}
