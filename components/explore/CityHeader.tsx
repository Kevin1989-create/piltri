"use client";

import { useState } from "react";
import Link from "next/link";
import { EyeIcon, IconResources, PlusIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { Collapse } from "@/components/ui/Collapse";
import { SaveHeart } from "@/components/explore/SaveHeart";
import { PlaceSummaryLine } from "@/components/explore/PlaceSummaryLine";
import { hasSource } from "@/lib/kpiRows";
import { isCustomWeights } from "@/lib/scoreWeights";
import { formatUtcOffset } from "@/lib/timezone";
import { SETTINGS_URL } from "@/lib/urls";
import { formatAreaKm2Compact, formatDensityPerKm2, useUnitPreferences } from "@/lib/unitPreferences";
import type { CityExploreData, DemographicsFields, SectionKey } from "@/lib/types";

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
   *  Editing lives solely on /settings now — kept out of this page
   *  to avoid the confusion of a per-city-looking control that's actually a
   *  global, shared preference. Optional so CityHeader can still be used
   *  read-only (e.g. inside a Compare column) without this label. */
  weights?: Record<SectionKey, number>;
  /** Where "manage weights" goes (Settings) - the results page passes a
   *  link that carries this city along, so Settings can offer a way back. */
  settingsHref?: string;
  /** World rank at the default weighting (see CityExploreData.ranks) -
   *  hidden when custom weights are active, since the rank was computed
   *  for the default score, not the customised one. */
  rank?: { position: number; outOf: number };
  /** Leaves out the country's block - a phone with a section open
   *  (2026-11-06, owner): the score and the city's own figures stay. */
  hideCountry?: boolean;
  /** Shows the heart that saves this place (2026-11-08, owner), before
   *  the eye and the "+". */
  savePlace?: { id: string; name: string; country: string; lat: number; lng: number };
  /** The place in a few plain words under its name - strengths, things to
   *  watch, who it suits (2026-11-14, BACKLOG P1). */
  summaryOf?: CityExploreData;
  /** The Resources button, between the heart and the eye (2026-11-15,
   *  owner: Resources isn't a section) - it opens the country's links. */
  onResources?: () => void;
  resourcesOpen?: boolean;
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

/** `span`: columns of the 3-column grid it takes (default 1). */
type Stat = { label: string; value: string; colorClass: string; title?: string; span?: 2 | 3 };
const STAT_GRID = "mt-0.5 grid grid-cols-3 items-start gap-x-3 gap-y-0.5";
const SPAN_CLASS = { 1: "", 2: "col-span-2", 3: "col-span-3" } as const;

/** A demographics stat: value over label. The label is always shown in
 *  full (wrapping if it must); a long value is cut short - hover shows it,
 *  and a tap expands it in place (phones have no hover). */
function StatCell({ stat }: { stat: Stat }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className={`block w-full min-w-0 text-left cursor-default ${SPAN_CLASS[stat.span ?? 1]}`}
    >
      <p className={`text-[11px] font-medium leading-snug ${open ? "break-words" : "truncate"} ${stat.colorClass}`} title={stat.title ?? stat.value}>
        {stat.value}
      </p>
      <p className="text-[9px] text-ink-500 uppercase tracking-wide leading-snug break-words">{stat.label}</p>
      {open && stat.title && <p className="text-[9px] text-ink-300 leading-snug break-words">{stat.title}</p>}
    </button>
  );
}

/** Non-breaking space (as a   escape, not a literal character, so it
 *  can't get silently normalised back to a plain space by any editing
 *  step) between "5" and "yr" — makes "(5 yr)" wrap as one whole unit onto
 *  its own line instead of splitting mid-bracket. */
const TREND_LABEL = "Population growth (5\u00A0yrs)";
/** The town's own (2026-11-14, owner): GHS-POP's 2025 grid is a projection
 *  from census trends, not a count - said so. */
const CITY_TREND_LABEL = "Projected growth (2020-25)";

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
  settingsHref = SETTINGS_URL,
  rank,
  hideCountry = false,
  savePlace,
  summaryOf,
  onResources,
  resourcesOpen = false,
}: CityHeaderProps) {
  const isCustomised = weights != null && isCustomWeights(weights);
  const { prefs } = useUnitPreferences();
  const score = Math.round(piltriScore);
  // The world rank (at the default weighting) - on hover only since
  // 2026-11-15 (owner: its line went to make room).
  const rankTitle = rank && !isCustomised ? `Piltri score - #${rank.position.toLocaleString()} of ${rank.outOf.toLocaleString()} places in the world` : "Piltri score";

  const NOT_AVAILABLE = "No data";

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
          label: "Density",
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
          label: TREND_LABEL,
          value:
            demographics.countryPopulationTrend5yrPct != null
              ? `${demographics.countryPopulationTrend5yrPct > 0 ? "+" : ""}${demographics.countryPopulationTrend5yrPct}%`
              : NOT_AVAILABLE,
          colorClass: demographics.countryPopulationTrend5yrPct != null ? "text-ink-900" : "text-ink-500",
          span: 2,
        },
        // Its own full-width line: the list is the point. Alphabetical - an
        // order of importance would be a political statement.
        (() => {
          const languages = demographics.countryOfficialLanguages ?? [];
          // In the first column beside the main religion (2026-11-17, owner:
          // every field on the same three columns): two names at most there.
          const narrow = hasSource("mainReligion");
          const most = narrow ? 2 : 3;
          const official = languages.length === 1 ? "Official language" : "Official languages";
          return {
            // "Languages" in the narrow column, so it stays on one line.
            label: narrow ? (languages.length === 1 ? "Language" : "Languages") : official,
            value: !languages.length
              ? NOT_AVAILABLE
              : languages.length <= most
                ? languages.join(", ")
                : `${languages.slice(0, most - 1).join(", ")} +${languages.length - most + 1} more`,
            colorClass: languages.length ? "text-ink-900" : "text-ink-500",
            title: languages.length ? `${official}: ${languages.join(", ")}${languages.length > 1 ? " (alphabetical)" : ""}` : undefined,
            span: narrow ? undefined : (3 as const),
          };
        })(),
        // The largest religious group (2026-11-14, owner) - from datasets
        // built since then.
        ...(hasSource("mainReligion")
          ? [
              (() => {
                const religion = demographics.countryMainReligion;
                return {
                  label: "Main religion",
                  value: religion ? `${religion.name}${religion.pct != null ? `, ${religion.pct}%` : ""}` : NOT_AVAILABLE,
                  colorClass: religion ? "text-ink-900" : "text-ink-500",
                  title: religion
                    ? `The largest religious group${religion.pct != null ? `: ${religion.pct}% of people` : ""} - CIA World Factbook${religion.year ? `, ${religion.year} estimate` : ""}`
                    : undefined,
                  // From the second column, under Density (2026-11-17).
                  span: 2 as const,
                };
              })(),
            ]
          : []),
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
        // Shown when the dataset has them (hasSource), "No data" where
        // fewer than 1,000 people live within the 5 km.
        ...(hasSource("age")
          ? [
              {
                label: "Average Age",
                value: demographics.cityMedianAge != null ? `${Math.round(demographics.cityMedianAge)}` : NOT_AVAILABLE,
                colorClass: demographics.cityMedianAge != null ? "text-ink-900" : "text-ink-500",
                title: "Median age of the people living within 5 km of the centre (WorldPop, 2025)",
              },
            ]
          : []),
        ...(hasSource("populationGrowth")
          ? [
              {
                label: CITY_TREND_LABEL,
                value:
                  demographics.cityPopulationGrowth5yrPct != null
                    ? `${demographics.cityPopulationGrowth5yrPct > 0 ? "+" : ""}${demographics.cityPopulationGrowth5yrPct}%`
                    : NOT_AVAILABLE,
                colorClass: demographics.cityPopulationGrowth5yrPct != null ? "text-ink-900" : "text-ink-500",
                title: "Projected change in the number of people living within 5 km of the centre, 2020 to 2025 - GHS-POP's 2025 figure is projected from census trends, not counted",
                span: 2 as const,
              },
            ]
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
        <h1 lang="en" className="min-w-0 break-words hyphens-auto leading-tight">
          {/* Region/country eyebrow line removed (2026-09-23, on request) -
           *  the city name is now the only thing in the title, sized up
           *  since it no longer has to share the block with a second line;
           *  "United Kingdom" is still fully available just below, in the
           *  stat group's own header. */}
          {/* A size down for long names, so most stay on one line beside
           *  the buttons (2026-11-15); a very long word breaks with a hyphen. */}
          <span className={cn("font-serif text-ink-900", cityName.length <= 9 ? "text-3xl" : cityName.length <= 12 ? "text-2xl" : "text-xl")}>
            {cityName}
          </span>
        </h1>
        <div className="flex-shrink-0 flex items-start gap-2.5">
        {(reportHref || compareHref || savePlace || onResources) && (
          <div className="mt-0.5 flex items-center gap-1.5">
            {savePlace && <SaveHeart place={savePlace} />}
            {onResources && (
              <button
                type="button"
                onClick={onResources}
                aria-pressed={resourcesOpen}
                title="Resources: useful links for this country"
                aria-label="Resources: useful links for this country"
                className={cn(
                  "w-6 h-6 flex items-center justify-center rounded-full border transition-colors",
                  resourcesOpen
                    ? "border-piltri-amber text-piltri-amber bg-piltri-amber-light/40"
                    : "border-surface-border text-ink-500 hover:text-piltri-amber hover:border-piltri-amber"
                )}
              >
                <IconResources className="w-3.5 h-3.5" />
              </button>
            )}
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
          {/* On a phone the score sits on the name's line (2026-11-15: room
           *  for the country's figures); the side column keeps its own line. */}
          <div className="md:hidden land:hidden flex flex-col items-center" title={rankTitle}>
            <span className="font-serif text-2xl leading-none text-piltri-amber tabular-nums">{score}</span>
            <span className="mt-0.5 text-[9px] uppercase tracking-wide leading-none text-ink-500">{isCustomised ? "Custom" : "Score"}</span>
          </div>
        </div>
      </div>

      {summaryOf && <PlaceSummaryLine data={summaryOf} />}

      {/* Demographics - reference info, not scored. City first, then its
       *  country; each block's header says which tier it is. */}
      {cityStats && (
        <div className="mt-1 rounded-lg bg-surface-muted px-2.5 py-0.5 border-l-2 border-piltri-amber">
          <p className="font-serif text-sm text-piltri-amber-dark leading-tight">{cityName}</p>
          {/* Labels are kept short so each fits on one line; longer ones
           *  span more columns (Stat.span) rather than being cut. */}
          <div className={STAT_GRID}>
            {cityStats.map((stat) => (
              <StatCell key={stat.label} stat={stat} />
            ))}
          </div>
        </div>
      )}

      {countryStats && (
        // Folds away smoothly rather than vanishing (2026-11-07).
        // Always open (2026-11-15, owner: no tap to see the country) - the
        // room comes from the slimmer score line below.
        <Collapse open={!hideCountry}>
          <div className="mt-1 rounded-lg bg-surface-muted px-2.5 py-0.5 border-l-2 border-piltri-amber">
            <p className="font-serif text-sm text-piltri-amber-dark leading-tight">{country}</p>
            <div className={STAT_GRID}>
              {countryStats.map((stat) => (
                <StatCell key={stat.label} stat={stat} />
              ))}
            </div>
          </div>
        </Collapse>
      )}

      {/* Label and score on one slim line (2026-11-15, owner: the world rank
       *  line went to make room - it's in the score's hover text now). */}
      <div className="mt-1 hidden md:flex land:flex items-center justify-between gap-2" title={rankTitle}>
        <p className="text-[11px] uppercase tracking-wide text-ink-500">Piltri score{isCustomised ? " (custom)" : ""}</p>
        <span className="font-serif text-2xl leading-none text-piltri-amber tabular-nums">{score}</span>
      </div>

      {isCustomised && (
        <p className="mt-1.5 text-[11px] text-ink-500">
          Using a custom weighting —{" "}
          <Link href={settingsHref} className="underline underline-offset-2 hover:text-piltri-amber">
            manage weights
          </Link>
        </p>
      )}
    </div>
  );
}
