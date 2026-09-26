"use client";

import { useState } from "react";
import Link from "next/link";
import { PiltriScoreDisplay } from "@/components/ui/ScoreBadge";
import { EyeIcon, PlusIcon } from "@/components/ui/icons";
import { isCustomWeights } from "@/lib/scoreWeights";
import { formatUtcOffset } from "@/lib/timezone";
import { formatAreaKm2Compact, formatDensityPerKm2, useUnitPreferences } from "@/lib/unitPreferences";
import type { DemographicsFields, SectionKey } from "@/lib/types";

interface CityHeaderProps {
  cityName: string;
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
  /** World rank at the default weighting (see CityExploreData.ranks) -
   *  hidden when custom weights are active, since the rank was computed
   *  for the default score, not the customised one. */
  rank?: { position: number; outOf: number };
}

/** Abbreviates large counts (population, density) to a short, glanceable
 *  form — "1.2M" / "8.9k" — since the full comma-separated number ("8,982,000")
 *  is too wide for a stat grid in a narrow column. */
function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  // Below 1000 this used to fall through to a plain toLocaleString(), which
  // passes raw World Bank density precision straight through unrounded
  // (e.g. "283.247/km²") - capped at 1 decimal (2026-09-24, on request:
  // no field shows more than 1 decimal place).
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** A demographics stat: value over label, one line each; hover shows the
 *  full text, and a tap expands it in place (phones have no hover). */
function StatCell({ stat }: { stat: { label: string; value: string; colorClass: string; title?: string } }) {
  const [open, setOpen] = useState(false);
  const wrap = open ? "break-words" : "truncate";
  return (
    <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="block w-full min-w-0 text-left cursor-default">
      <p className={`text-[11px] font-medium leading-snug ${wrap} ${stat.colorClass}`} title={stat.title ?? stat.value}>
        {stat.value}
      </p>
      <p className={`text-[9px] text-ink-500 uppercase tracking-wide leading-snug ${wrap}`} title={stat.label}>
        {stat.label}
      </p>
      {open && stat.title && <p className="text-[9px] text-ink-300 leading-snug break-words">{stat.title}</p>}
    </button>
  );
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
  country,
  piltriScore,
  demographics,
  compareHref,
  reportHref,
  weights,
  rank,
}: CityHeaderProps) {
  const isCustomised = weights != null && isCustomWeights(weights);
  const { prefs } = useUnitPreferences();

  type Stat = { label: string; value: string; colorClass: string; title?: string };
  const NOT_AVAILABLE = "Not available";

  // Country and City are two genuinely separate data tiers (see
  // lib/types.ts's DemographicsFields comment) - shown as two clearly
  // labelled groups rather than blended into one set of stats, so it's
  // never ambiguous which one a number belongs to. Every field is
  // nullable at the source; null renders as "Not available" rather than
  // being silently backfilled from the other tier.
  //
  // Deliberately uncoloured (2026-09-23, on request) - these are
  // informational facts, not judgements, and an earlier version's
  // green/amber/red tier colouring on density/age/trend implied a
  // "good vs bad" reading that doesn't actually apply to any of them
  // (a higher or lower average age isn't worse, neither is a denser or
  // sparser population). "Not available" is still shown in a muted
  // colour - that's a plain empty-state convention, not a value judgement.
  const countryStats: Stat[] | null = demographics
    ? [
        {
          label: "Population",
          value: demographics.countryPopulation != null ? formatCompactNumber(demographics.countryPopulation) : NOT_AVAILABLE,
          colorClass: demographics.countryPopulation != null ? "text-ink-900" : "text-ink-500",
        },
        {
          label: "Population Density",
          value:
            demographics.countryPopulationDensityPerKm2 != null
              ? formatDensityPerKm2(demographics.countryPopulationDensityPerKm2, prefs, formatCompactNumber)
              : NOT_AVAILABLE,
          colorClass: demographics.countryPopulationDensityPerKm2 != null ? "text-ink-900" : "text-ink-500",
        },
        {
          label: "Land Area",
          value:
            demographics.countryLandAreaKm2 != null
              ? formatAreaKm2Compact(demographics.countryLandAreaKm2, prefs, formatCompactNumber)
              : NOT_AVAILABLE,
          colorClass: demographics.countryLandAreaKm2 != null ? "text-ink-900" : "text-ink-500",
        },
        {
          label: "Average Age",
          value: demographics.countryAverageAge != null ? `${demographics.countryAverageAge}` : NOT_AVAILABLE,
          colorClass: demographics.countryAverageAge != null ? "text-ink-900" : "text-ink-500",
        },
        {
          label: "Main Language",
          value: demographics.countryMostWidelySpokenLanguage ?? NOT_AVAILABLE,
          colorClass: demographics.countryMostWidelySpokenLanguage != null ? "text-ink-900" : "text-ink-500",
        },
        {
          label: TREND_LABEL,
          value:
            demographics.countryPopulationTrend5yrPct != null
              ? `${demographics.countryPopulationTrend5yrPct > 0 ? "+" : ""}${demographics.countryPopulationTrend5yrPct}%`
              : NOT_AVAILABLE,
          colorClass: demographics.countryPopulationTrend5yrPct != null ? "text-ink-900" : "text-ink-500",
        },
      ]
    : null;

  // Density is people within 5 km of the centre (the same area for every
  // place); time zone shows the current UTC offset, IANA name on hover.
  const utcOffset = demographics?.timezone ? formatUtcOffset(demographics.timezone) : null;
  const cityStats: Stat[] | null = demographics
    ? [
        {
          label: "Population",
          value: demographics.cityPopulation != null ? formatCompactNumber(demographics.cityPopulation) : NOT_AVAILABLE,
          colorClass: demographics.cityPopulation != null ? "text-ink-900" : "text-ink-500",
        },
        ...(demographics.cityDensityPerKm2 != null
          ? [
              {
                label: "Density (5 km)",
                value: formatDensityPerKm2(demographics.cityDensityPerKm2, prefs, formatCompactNumber),
                colorClass: "text-ink-900",
                title: "People per km² within 5 km of the centre",
              },
            ]
          : []),
        ...(utcOffset
          ? [{ label: "Time Zone", value: utcOffset, colorClass: "text-ink-900", title: `${demographics.timezone} (${utcOffset} today)` }]
          : []),
      ]
    : null;

  return (
    // Sticky is desktop-only (2026-09-23, fixing a bug) - the left column
    // is its own `overflow-y-auto` box only at `md` and up (see
    // results/page.tsx), where "sticky top-0" keeps this pinned above the
    // section rows scrolling underneath it *inside that small box*, as
    // intended. Below `md`, the whole page scrolls instead (no scroll
    // container of its own here), so unconditional "sticky" was pinning
    // this entire block - name, both demographics stat boxes, score - to
    // the top of the screen the moment you scrolled past it, permanently
    // eating a few hundred px of a phone's viewport height and directly
    // contributing to "a lot of scrolling needed" once a section opened.
    <div className="px-4 pt-1.5 pb-1 md:sticky md:top-0 z-10 rounded-t-card bg-surface/95 backdrop-blur border-b border-surface-border">
      <div className="flex items-start justify-between gap-2">
        <h1 className="leading-tight">
          {/* Region/country eyebrow line removed (2026-09-23, on request) -
           *  the city name is now the only thing in the title, sized up
           *  since it no longer has to share the block with a second line;
           *  "United Kingdom" is still fully available just below, in the
           *  stat group's own header. */}
          <span className="font-serif text-3xl text-ink-900">{cityName}</span>
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

      {/* Demographics - reference info, not scored. City first, then its
       *  country; each block's header says which tier it is. */}
      {cityStats && (
        <div className="mt-1 rounded-lg bg-surface-muted px-2.5 py-0.5 border-l-2 border-piltri-amber">
          <p className="font-serif text-sm text-piltri-amber-dark leading-tight">{cityName}</p>
          {/* truncate on both lines (2026-09-26, on request - same fix as
           *  SectionDetail.tsx's StatCell): a longer label like
           *  "Population trend (5 yr)" wrapping to 2 lines made its whole
           *  grid row taller than a row of single-line labels, leaving
           *  uneven blank space below the shorter cells before the next
           *  row's fixed gap-y-0.5 started - every cell now has the same
           *  1-line footprint regardless of label length. */}
          <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
            {cityStats.map((stat) => (
              <StatCell key={stat.label} stat={stat} />
            ))}
          </div>
        </div>
      )}

      {countryStats && (
        <div className="mt-1 rounded-lg bg-surface-muted px-2.5 py-0.5 border-l-2 border-piltri-amber">
          <p className="font-serif text-sm text-piltri-amber-dark leading-tight">{country}</p>
          <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
            {countryStats.map((stat) => (
              <StatCell key={stat.label} stat={stat} />
            ))}
          </div>
        </div>
      )}

      {/* Label and score on one line — saves the vertical space the label
       *  used to take as its own row above the big number. */}
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-ink-500">
          Piltri score{isCustomised ? " (custom)" : ""}
        </p>
        <PiltriScoreDisplay score={piltriScore} />
      </div>
      {rank && !isCustomised && (
        <p className="text-[10px] text-ink-500 text-right -mt-0.5" title="World rank among every city in Piltri's dataset">
          #{rank.position.toLocaleString()} of {rank.outOf.toLocaleString()} cities
        </p>
      )}

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
