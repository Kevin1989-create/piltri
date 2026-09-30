"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { NavBar } from "@/components/ui/NavBar";
import { WeightEditor } from "@/components/explore/WeightEditor";
import { useScoreWeights, isCustomWeights } from "@/lib/scoreWeights";

/**
 * Score settings: the persisted score-weight preference
 * (lib/scoreWeights.ts), reached from a city's results page. Deliberately
 * separate from Discover mode's filters — this is "how should the Piltri
 * Score be calculated," not "which cities match my criteria." Saved as you
 * adjust each slider, no separate save step. Display units and language
 * live on /explore/settings, reached from the landing page.
 */
export default function ScoreSettingsPage() {
  return (
    <Suspense fallback={null}>
      <ScoreSettingsContent />
    </Suspense>
  );
}

function ScoreSettingsContent() {
  const { weights, setWeights, resetWeights } = useScoreWeights();
  const customised = isCustomWeights(weights);
  // Opened from a city (the results page passes its query along): "Back"
  // returns to that city rather than the generic landing page.
  const params = useSearchParams();
  const fromCity = params.get("city");
  const backHref = fromCity ? `/explore/results?${params.toString()}` : "/explore";
  const backLabel = fromCity ? "← Back to results" : "← Back to Explore";

  return (
    <main className="min-h-dvh flex flex-col">
      <NavBar logoSide="left" border={false} />

      <div className="px-6 pt-8">
        <div className="max-w-xl mx-auto">
          <Link href={backHref} className="text-xs text-ink-500 hover:text-ink-900">
            {backLabel}
          </Link>
          <h1 className="font-serif text-2xl text-ink-900 mt-1">Score settings</h1>
          <p className="text-sm text-ink-500 mt-1">
            Choose how much each section counts toward the overall Piltri Score; saved automatically as you adjust it.
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
        </div>
      </div>
    </main>
  );
}
