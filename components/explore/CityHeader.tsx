"use client";

import Link from "next/link";
import { PiltriScoreDisplay } from "@/components/ui/ScoreBadge";
import { EyeIcon, PlusIcon, PrecisionCityIcon, PrecisionCountryIcon } from "@/components/ui/icons";
import { isCustomWeights } from "@/lib/scoreWeights";
import { normalise } from "@/lib/aggregation/scoring";
import { PRECISION_LABEL } from "@/lib/kpiRows";
import { formatAreaKm2Compact, formatDensityPerKm2, useUnitPreferences } from "@/lib/unitPreferences";
import type { DemographicsFields, SectionKey } from "@/lib/types";

// Demographics never uses "pinned" today - only these two tiers are
// possible here (see DemographicStat below), unlike the full PrecisionTier
// union used elsewhere in the app.
type DemographicsPrecision = "city" | "country";

const PRECISION_ICON: Record<DemographicsPrecision, typeof PrecisionCountryIcon> = {
  country: PrecisionCountryIcon,
  city: PrecisionCityIcon,
};

interface CityHeaderProps {
  cityName: string;
  region: string | null;
  country: string;
  piltriScore: number;
  /** Population/language snapshot — shown as a compact stat grid next to
   *  the name rather than a scored section (see lib/types.ts SectionKey).
   *  Optional so CityHeader still works read-only without it (e.g. inside a
   *  Compare column). */
  demographics?: DemographicsFields;
  /** If provided, shows a small "+" next to the name linking to the Compare
   *  Data page, with this place pre-loaded as its first column. */
  compareHref?: string;
  /** If provided, shows a small "view all data" eye icon just to the left
   *  of the "+" button, linking to the full data report for this city -
   *  that page itself offers a "Download as PDF" action, so this is framed
   *  as viewing, not downloading. Same optional-and-independent pattern as
   *  compareHref — only shown where a parent page actually has somewhere
   *  useful for it to go. */
  reportHref?: string;
  /** Current section weights (whole percentages) driving `piltriScore`, used
   *  only to show the "(custom)" label when they differ from default.
   *  Editing lives solely on /explore/weights now — kept out of this page
   *  to avoid the confusion of a per-city-looking control that's actually a
   *  global, shared preference. Optional so CityHeader can still be used
   *  read-only (e.g. inside a Compare column) without this label. */
  weights?: Record<SectionKey, number>;
}

/** Abbreviates large counts (population, density) to a short, glanceable
 *  form — "1.2M" / "8.9k" — since the full comma-separated number ("8,982,000")
 *  is too wide for a stat grid in a narrow column. */
function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toLocaleString();
}

/** Same 3-tier colour language used for section scores elsewhere in the app
 *  (text-score-strong/moderate/weak) — reused here purely as a "where does
 *  this sit on a typical global range: high, middle, or low" indicator, not
 *  a judgement (e.g. an older average age isn't "worse"). Population and
 *  Main Language are left uncoloured — there's no meaningful spectrum to
 *  place a raw headcount or a language name on. */
function tierColorClass(value0to100: number): string {
  if (value0to100 >= 67) return "text-score-strong";
  if (value0to100 >= 34) return "text-score-moderate";
  return "text-score-weak";
}

/** Non-breaking space (as a   escape, not a literal character, so it
 *  can't get silently normalised back to a plain space by any editing
 *  step) between "5" and "yr" — makes "(5 yr)" wrap as one whole unit onto
 *  its own line instead of splitting mid-bracket. */
const TREND_LABEL = "Population Trend (5\u00A0yr)";

/** City name + Piltri score. Sits at the top of the floating left column on
 *  the results page, so it's sized for a narrow column rather than a full
 *  width panel — score stacks below the name instead of sitting beside it.
 *  Kept deliberately compact (tight padding/margins) so the section list
 *  below it in the same scrollable panel gets more visible room. */
export function CityHeader({
  cityName,
  region,
  country,
  piltriScore,
  demographics,
  compareHref,
  reportHref,
  weights,
}: CityHeaderProps) {
  const isCustomised = weights != null && isCustomWeights(weights);
  const { prefs } = useUnitPreferences();

  type Stat = { label: string; value: string; colorClass: string; precision: DemographicsPrecision };
  // `null` is a deliberate empty grid cell (see the row3/row4 alignment
  // comment below) - rendered as a blank placeholder, not skipped, so
  // everything after it still lands in the intended row/column.
  const demographicStats: (Stat | null)[] | null = demographics
    ? [
        {
          label: "Population",
          value: formatCompactNumber(demographics.population),
          colorClass: "text-ink-900",
          // Always "city" - genuinely attempted at city level via Wikidata
          // (see lib/data-sources/wikidata.ts getCityPopulationAndArea),
          // same honest-attempt convention as Land Area below even on the
          // rare miss that falls back to the country figure.
          precision: "city",
        },
        {
          label: "Population Density",
          value: formatDensityPerKm2(demographics.populationDensityPerKm2, prefs, formatCompactNumber),
          // Inverted: lower density reads as "spacious" (strong/green),
          // higher density as "crowded" (weak/rust) — same 5-15,000/km²
          // reference range used elsewhere in the aggregation pipeline.
          colorClass: tierColorClass(normalise(demographics.populationDensityPerKm2, 5, 15000, true)),
          precision: "city",
        },
        {
          label: "Land Area",
          value: demographics.areaKm2 != null ? formatAreaKm2Compact(demographics.areaKm2, prefs, formatCompactNumber) : "Not available",
          colorClass: "text-ink-900",
          precision: "city",
        },
        // Deliberate gap: leaves Main Language to drop to the next row
        // rather than sit beside Land Area, so it lines up with Population
        // Avg Age one row down (per explicit request - the empty cell here
        // is intentional, not a bug).
        null,
        {
          label: "Population Avg Age",
          value: `${demographics.averageAge}`,
          colorClass: tierColorClass(normalise(demographics.averageAge, 20, 50)),
          precision: "country",
        },
        {
          label: "Main Language",
          value: demographics.mostWidelySpokenLanguage,
          colorClass: "text-ink-900",
          precision: "country",
        },
        {
          label: TREND_LABEL,
          value: `${demographics.populationTrend5yrPct > 0 ? "+" : ""}${demographics.populationTrend5yrPct}%`,
          colorClass: tierColorClass(normalise(demographics.populationTrend5yrPct, -2, 5)),
          precision: "country",
        },
      ]
    : null;

  return (
    <div className="px-4 pt-3 pb-2 sticky top-0 z-10 rounded-t-card bg-surface/95 backdrop-blur border-b border-surface-border">
      <div className="flex items-start justify-between gap-2">
        <h1 className="font-serif text-xl text-ink-900 leading-tight">
          {cityName}
          <span className="block text-ink-500 text-sm font-sans">
            {region ? `${region}, ` : ""}
            {country}
          </span>
        </h1>
        {(reportHref || compareHref) && (
          <div className="flex-shrink-0 mt-0.5 flex items-center gap-1.5">
            {reportHref && (
              <Link
                href={reportHref}
                target="_blank"
                rel="noopener noreferrer"
                title="View all data"
                aria-label="View all data"
                className="w-6 h-6 flex items-center justify-center rounded-full border border-surface-border text-ink-500 hover:text-piltri-amber hover:border-piltri-amber transition-colors"
              >
                <EyeIcon className="w-3.5 h-3.5" />
              </Link>
            )}
            {compareHref && (
              <Link
                href={compareHref}
                title="Compare Data"
                aria-label="Compare this place's data with others"
                className="w-6 h-6 flex items-center justify-center rounded-full border border-surface-border text-ink-500 hover:text-piltri-amber hover:border-piltri-amber transition-colors"
              >
                {/* SVG plus rather than a text "+" glyph — text characters can
                 *  sit slightly off-centre within their own box depending on
                 *  the font's metrics, whereas this is centred by construction. */}
                <PlusIcon className="w-3 h-3" />
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Demographics — supplementary reference info, not a scored section
       *  (a population count doesn't really have a "good/bad" score).
       *  2 columns rather than 3 — the full-word labels ("Population Trend
       *  (5 yr)", "English Proficiency") need more width per cell than a
       *  3-column layout could give them to comfortably wrap onto 2 lines
       *  instead of 3. Population is the only label short enough to sit on
       *  one line; everything else is a 2-line label by design now.
       *  Made smaller still (mt-1.5, smaller text, tighter gaps/padding) and
       *  pulled closer to the name above it, on request to shrink this
       *  block further and free up more room for the section list below. */}
      {demographicStats && (
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-surface-muted px-2.5 py-1.5">
          {demographicStats.map((stat, i) => {
            if (!stat) return <div key={`gap-${i}`} />;
            const Icon = PRECISION_ICON[stat.precision];
            return (
              <div key={stat.label} className="min-w-0">
                <div className="flex items-center justify-between gap-1">
                  {/* Population/Population Density/Land Area are always
                   *  tagged city-level - genuinely attempted per search via
                   *  Wikidata (see lib/data-sources/wikidata.ts
                   *  getCityPopulationAndArea), same honest-attempt
                   *  convention used elsewhere even on a rare miss. The
                   *  other 4 stats are always country-level today (World
                   *  Bank / REST Countries / manual-sources.ts). Icon sits
                   *  at the cell's right edge (not glued to the value) so
                   *  icons line up in a clean column regardless of value
                   *  length. */}
                  <p className={`text-[11px] font-medium leading-snug ${stat.colorClass}`}>{stat.value}</p>
                  <span className="inline-flex flex-shrink-0" title={PRECISION_LABEL[stat.precision]}>
                    <Icon className="w-2.5 h-2.5 text-ink-300" />
                  </span>
                </div>
                <p className="text-[9px] text-ink-500 uppercase tracking-wide leading-snug">{stat.label}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Label and score on one line — saves the vertical space the label
       *  used to take as its own row above the big number. */}
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-ink-500">
          Piltri score{isCustomised ? " (custom)" : ""}
        </p>
        <PiltriScoreDisplay score={piltriScore} />
      </div>

      {isCustomised && (
        <p className="mt-1.5 text-[11px] text-ink-500">
          Using a custom weighting —{" "}
          <Link href="/explore/weights" className="underline underline-offset-2 hover:text-piltri-amber">
            manage weights
          </Link>
        </p>
      )}
    </div>
  );
}
